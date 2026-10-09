// Package stream provides online streaming (via provider extensions), the
// HLS/media proxy used by the in-app player, and local-file direct play /
// transcoding.
package stream

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/v0-0x/kumobox-movies/server/internal/catalog"
	"github.com/v0-0x/kumobox-movies/server/internal/db"
	"github.com/v0-0x/kumobox-movies/server/internal/extensions"
	"github.com/v0-0x/kumobox-movies/server/internal/util"
)

type Service struct {
	db       *db.DB
	exts     *extensions.Manager
	platform *catalog.Platform
	mu       sync.Mutex
}

func NewService(d *db.DB, e *extensions.Manager, p *catalog.Platform) *Service {
	return &Service{db: d, exts: e, platform: p}
}

type ProviderInfo struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Icon        string   `json:"icon"`
	SupportsDub bool     `json:"supportsDub"`
	Servers     []string `json:"servers"`
	Builtin     bool     `json:"builtin"`
}

func (s *Service) Providers(ctx context.Context) []ProviderInfo {
	out := []ProviderInfo{}
	if s.exts == nil {
		return out
	}
	for _, p := range s.exts.OnlineStreamProviders() {
		st := p.Settings(ctx)
		info, _ := s.exts.Get(p.ID())
		icon := ""
		if info.Manifest != nil {
			icon = info.Manifest.Icon
		}
		out = append(out, ProviderInfo{ID: p.ID(), Name: p.Name(), Icon: icon, SupportsDub: st.SupportsDub, Servers: st.EpisodeServers})
	}
	return out
}

// Episode is a streamable episode of a title from a provider, numbered as
// the provider numbers them.
type Episode struct {
	Number float64 `json:"number"`
	ID     string  `json:"id"`
	Title  string  `json:"title"`
}

type Mapping struct {
	ID    string  `json:"id"` // provider-specific id
	Title string  `json:"title"`
	Score float64 `json:"score"`
	Query string  `json:"query,omitempty"`
	Index int     `json:"index,omitempty"`
}

type EpisodesResult struct {
	Provider string    `json:"provider"`
	Mapping  *Mapping  `json:"mapping"`
	Episodes []Episode `json:"episodes"`
	Dub      bool      `json:"dub"`
}

func modeOf(dub bool) string {
	if dub {
		return "dub"
	}
	return "sub"
}

func (s *Service) loadMapping(provider string, mediaID int, dub bool) *Mapping {
	var raw string
	if err := s.db.QueryRow(`SELECT value FROM stream_mappings WHERE provider = ? AND media_id = ? AND mode = ?`, provider, mediaID, modeOf(dub)).Scan(&raw); err != nil {
		return nil
	}
	var m Mapping
	if json.Unmarshal([]byte(raw), &m) != nil {
		return nil
	}
	return &m
}

func (s *Service) saveMapping(provider string, mediaID int, dub bool, m *Mapping) {
	raw, _ := json.Marshal(m)
	_, _ = s.db.Write(`INSERT INTO stream_mappings(provider, media_id, mode, value) VALUES(?, ?, ?, ?)
		ON CONFLICT(provider, media_id, mode) DO UPDATE SET value = excluded.value`, provider, mediaID, modeOf(dub), string(raw))
}

// SetMapping lets the user pick the right search result manually.
func (s *Service) SetMapping(provider string, mediaID int, dub bool, m Mapping) error {
	s.saveMapping(provider, mediaID, dub, &m)
	s.db.DeleteCachePrefix(fmt.Sprintf("os-eps:%s:%d:", provider, mediaID))
	return nil
}

// SearchResult is a manual-search result shown when the auto match is wrong.
type SearchResult struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	SubOrDub string `json:"subOrDub,omitempty"`
	Query    string `json:"query,omitempty"`
	Index    int    `json:"index,omitempty"`
	Episodes int    `json:"episodes,omitempty"`
}

func (s *Service) Search(ctx context.Context, provider, query string, dub bool) ([]SearchResult, error) {
	p, err := s.provider(provider)
	if err != nil {
		return nil, err
	}
	res, err := p.Search(ctx, nil, query, dub)
	if err != nil {
		return nil, err
	}
	out := make([]SearchResult, 0, len(res))
	for _, r := range res {
		out = append(out, SearchResult{ID: r.ID, Title: r.Title, SubOrDub: r.SubOrDub})
	}
	return out, nil
}

// Streaming providers number a show's episodes from its first one (1, 2, …
// 24), as streaming sites do, KumoBox by key (see catalog); a movie is
// episode 1.

// ProviderEpisode is a provider's number for the episode key of media.
func ProviderEpisode(media *catalog.Media, key int) float64 {
	if !media.IsShow() {
		return 1
	}
	if n := media.EpisodeIndex(key); n > 0 {
		return float64(n)
	}
	_, e := catalog.SplitKey(key)
	return float64(e)
}

// EpisodeKeyOf is the key of a provider's episode n of media.
func EpisodeKeyOf(media *catalog.Media, n float64) int {
	if !media.IsShow() {
		return catalog.MovieEpisode
	}
	if k := media.KeyAtIndex(int(n)); k > 0 {
		return k
	}
	return catalog.EpisodeKey(1, max(int(n), 1))
}

// provider is an installed streaming extension.
func (s *Service) provider(id string) (*extensions.OnlineStreamProvider, error) {
	if s.exts == nil {
		return nil, fmt.Errorf("streaming provider %q is not installed", id)
	}
	return s.exts.OnlineStreamProvider(id)
}

// Episodes resolves which provider entry matches the title and lists its
// episodes.
func (s *Service) Episodes(ctx context.Context, provider string, media *catalog.Media, dub bool, refresh bool) (*EpisodesResult, error) {
	p, err := s.provider(provider)
	if err != nil {
		return nil, err
	}
	cacheKey := fmt.Sprintf("os-eps:%s:%d:%s", provider, media.ID, modeOf(dub))
	var cached EpisodesResult
	if !refresh && s.db.GetCache(cacheKey, &cached) {
		return &cached, nil
	}
	m := s.loadMapping(provider, media.ID, dub)
	if m == nil || refresh && m.Score < 1 {
		m, err = s.matchExtension(ctx, p, media, dub)
		if err != nil {
			return nil, err
		}
		if m == nil {
			return &EpisodesResult{Provider: provider, Episodes: []Episode{}, Dub: dub}, nil
		}
		s.saveMapping(provider, media.ID, dub, m)
	}
	eps, err := p.FindEpisodes(ctx, m.ID)
	if err != nil {
		return nil, err
	}
	res := &EpisodesResult{Provider: provider, Mapping: m, Dub: dub}
	for _, e := range eps {
		res.Episodes = append(res.Episodes, Episode{Number: e.Number, ID: e.ID, Title: e.Title})
	}
	sort.SliceStable(res.Episodes, func(i, j int) bool { return res.Episodes[i].Number < res.Episodes[j].Number })
	if len(res.Episodes) > 0 { // don't remember a temporary failure for an hour
		s.db.SetCache(cacheKey, res, time.Hour)
	}
	return res, nil
}

func (s *Service) matchExtension(ctx context.Context, p *extensions.OnlineStreamProvider, media *catalog.Media, dub bool) (*Mapping, error) {
	var queries []string
	for _, t := range []string{media.Title.Romaji, media.Title.English} {
		if t = strings.TrimSpace(t); t != "" && !containsFold(queries, t) {
			queries = append(queries, t)
		}
	}
	seen := map[string]bool{}
	var all []extensions.OSSearchResult
	var firstErr error
	for _, q := range queries {
		res, err := p.Search(ctx, media, q, dub)
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		for _, r := range res {
			if !seen[r.ID] {
				seen[r.ID] = true
				all = append(all, r)
			}
		}
	}
	if len(all) == 0 {
		return nil, firstErr
	}
	var best *Mapping
	for _, r := range all {
		score := 0.0
		for _, t := range media.AllTitles() {
			score = math.Max(score, util.Similarity(t, r.Title))
		}
		if dub && r.SubOrDub == "sub" {
			score -= 0.1
		}
		if best == nil || score > best.Score {
			best = &Mapping{ID: r.ID, Title: r.Title, Score: score}
		}
	}
	return best, nil
}

// Modes is which versions of a title a provider has: in the original
// language (sub) and dubbed.
type Modes struct {
	Sub bool `json:"sub"`
	Dub bool `json:"dub"`
}

// A match scoring less is taken for another title.
const goodMatch = 0.6

type availability int

const (
	unknown availability = iota
	present
	missing
)

// Modes tells whether a provider has a title subtitled and dubbed, for the
// title page to offer only those. A version is missing when the provider has
// no good match for it or no episode of it. One the provider couldn't be
// asked about counts as there, and so do both when neither was found: the
// page then offers both, to pick the title by hand.
func (s *Service) Modes(ctx context.Context, provider string, media *catalog.Media, refresh bool) Modes {
	if p, err := s.provider(provider); err == nil && !p.Settings(ctx).SupportsDub {
		return Modes{Sub: true}
	}
	key := fmt.Sprintf("os-eps:%s:%d:modes", provider, media.ID)
	var m Modes
	if !refresh && s.db.GetCache(key, &m) {
		return m
	}
	var sub availability
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		sub = s.available(ctx, provider, media, false)
	}()
	dub := s.available(ctx, provider, media, true)
	wg.Wait()
	m = Modes{Sub: sub != missing, Dub: dub != missing}
	if !m.Sub && !m.Dub {
		m = Modes{Sub: true, Dub: true}
	}
	if sub != unknown && dub != unknown {
		s.db.SetCache(key, m, 6*time.Hour)
	}
	return m
}

func (s *Service) available(ctx context.Context, provider string, media *catalog.Media, dub bool) availability {
	res, err := s.Episodes(ctx, provider, media, dub, false)
	if err != nil {
		return unknown
	}
	if res.Mapping == nil || res.Mapping.Score < goodMatch || len(res.Episodes) == 0 {
		return missing
	}
	return present
}

// Source is a playable video.
type Source struct {
	URL       string            `json:"url"`
	Type      string            `json:"type"` // m3u8 | mp4 | unknown
	Quality   string            `json:"quality"`
	Label     string            `json:"label,omitempty"`
	Headers   map[string]string `json:"headers"`
	Referrer  string            `json:"referrer,omitempty"`
	Subtitles []Subtitle        `json:"subtitles"`
	Server    string            `json:"server"`
}

type Subtitle struct {
	URL       string `json:"url"`
	Language  string `json:"language"`
	IsDefault bool   `json:"isDefault"`
}

type SourcesResult struct {
	Provider string   `json:"provider"`
	Episode  float64  `json:"episode"`
	Sources  []Source `json:"sources"`
	Errors   []string `json:"errors,omitempty"`
	Title    string   `json:"title"`
}

// Sources resolves the playable sources of an episode (as the provider
// numbers them).
func (s *Service) Sources(ctx context.Context, provider string, media *catalog.Media, episode float64, dub bool, server, quality string) (*SourcesResult, error) {
	p, err := s.provider(provider)
	if err != nil {
		return nil, err
	}
	eps, err := s.Episodes(ctx, provider, media, dub, false)
	if err != nil {
		return nil, err
	}
	var ep *Episode
	for i := range eps.Episodes {
		if eps.Episodes[i].Number == episode {
			ep = &eps.Episodes[i]
			break
		}
	}
	if ep == nil {
		return nil, fmt.Errorf("episode %s is not available on %s", trimFloat(episode), p.Name())
	}
	settings := p.Settings(ctx)
	servers := settings.EpisodeServers
	if server != "" {
		servers = []string{server}
	}
	res := &SourcesResult{Provider: provider, Episode: episode, Sources: []Source{}}
	type out struct {
		srv *extensions.OSServer
		err error
		idx int
	}
	ch := make(chan out, len(servers))
	for i, srv := range servers {
		go func(i int, srv string) {
			r, err := p.FindEpisodeServer(ctx, extensions.OSEpisode{ID: ep.ID, Number: ep.Number, Title: ep.Title}, srv)
			ch <- out{r, err, i}
		}(i, srv)
	}
	results := make([]out, len(servers))
	for range servers {
		o := <-ch
		results[o.idx] = o
	}
	for i, o := range results {
		if o.err != nil {
			res.Errors = append(res.Errors, servers[i]+": "+o.err.Error())
			continue
		}
		for _, vs := range o.srv.VideoSources {
			src := Source{URL: vs.URL, Type: vs.Type, Quality: vs.Quality, Label: vs.Label, Headers: o.srv.Headers, Server: o.srv.Server}
			if src.Headers == nil {
				src.Headers = map[string]string{}
			}
			if src.Type == "" || src.Type == "unknown" {
				src.Type = guessType(src.URL)
			}
			for _, sub := range vs.Subtitles {
				src.Subtitles = append(src.Subtitles, Subtitle{URL: sub.URL, Language: sub.Language, IsDefault: sub.IsDefault})
			}
			res.Sources = append(res.Sources, src)
		}
	}
	if len(res.Sources) == 0 {
		msg := "no sources found"
		if len(res.Errors) > 0 {
			msg += ": " + strings.Join(res.Errors, "; ")
		}
		return nil, errors.New(msg)
	}
	return res, nil
}

func guessType(u string) string {
	l := strings.ToLower(strings.Split(u, "?")[0])
	switch {
	case strings.HasSuffix(l, ".m3u8") || strings.Contains(l, "m3u8"):
		return "m3u8"
	case strings.HasSuffix(l, ".mp4") || strings.HasSuffix(l, ".webm") || strings.HasSuffix(l, ".mkv"):
		return "mp4"
	}
	return "unknown"
}

func trimFloat(f float64) string {
	if f == math.Trunc(f) {
		return fmt.Sprintf("%d", int(f))
	}
	return fmt.Sprintf("%g", f)
}

func containsFold(list []string, s string) bool {
	for _, x := range list {
		if strings.EqualFold(x, s) {
			return true
		}
	}
	return false
}
