package library

import (
	"context"
	"sort"
	"sync"
	"time"

	"github.com/v0-0x/kumobox-movies/server/internal/catalog"
	"github.com/v0-0x/kumobox-movies/server/internal/db"
	"github.com/v0-0x/kumobox-movies/server/internal/history"
)

// Service builds the views the UI needs by combining the list, the local
// files, the episodes of TMDB's seasons and the watch history.
type Service struct {
	Store    *Store
	Scanner  *Scanner
	Platform *catalog.Platform
	History  *history.Store
	DB       *db.DB // items removed from "Continue watching"
	// Remote: the files other KumoBox apps on the network share with this one
	// (package share), shown with the local ones; nil without sharing.
	Remote func() []*LocalFile

	hiddenMu sync.Mutex
}

// EpisodeView is an episode of the title page (a movie has one). Key is
// the episode key (see catalog), Season and Number the episode it is.
type EpisodeView struct {
	Key      int            `json:"key"`
	Season   int            `json:"season"`
	Number   int            `json:"number"`
	Title    string         `json:"title"`
	Image    string         `json:"image"`
	Summary  string         `json:"summary"`
	AirDate  string         `json:"airDate"`
	Runtime  int            `json:"runtime"`
	Kind     string         `json:"kind"` // main | special | nc
	File     *LocalFile     `json:"file"`
	Watched  bool           `json:"watched"`
	Aired    bool           `json:"aired"`
	History  *history.Entry `json:"history"`
	ResumeAt float64        `json:"resumeAt"`
	HasFile  bool           `json:"hasFile"`
}

// Images is the artwork of a title page.
type Images struct {
	Banner    string `json:"banner"`
	Poster    string `json:"poster"`
	Fanart    string `json:"fanart"`
	Clearlogo string `json:"clearlogo"`
}

// Mappings are a title's ids on other sites.
type Mappings struct {
	TmdbID int    `json:"tmdbId"`
	ImdbID string `json:"imdbId,omitempty"`
	TvdbID int    `json:"tvdbId,omitempty"`
}

type EntryView struct {
	Media       *catalog.Media     `json:"media"`
	ListEntry   *catalog.ListEntry `json:"listEntry"`
	Episodes    []*EpisodeView     `json:"episodes"`
	Specials    []*EpisodeView     `json:"specials"`
	Others      []*EpisodeView     `json:"others"`
	NextEpisode *EpisodeView       `json:"nextEpisode"`
	LocalCount  int                `json:"localCount"`
	// SharedCount: files of it other KumoBox apps share with this one.
	SharedCount  int      `json:"sharedCount"`
	Images       Images   `json:"images"`
	Mappings     Mappings `json:"mappings"`
	MetadataNote string   `json:"metadataNote,omitempty"`
}

// Entry returns everything the title page needs.
func (s *Service) Entry(ctx context.Context, mediaID int, refresh bool) (*EntryView, error) {
	media, err := s.Platform.Media(ctx, mediaID, refresh)
	if err != nil {
		return nil, err
	}
	coll, _ := s.Platform.Collection(ctx, "", false)
	var entry *catalog.ListEntry
	if coll != nil {
		entry = coll.Find(mediaID)
	}
	files, _ := s.Store.ByMedia(mediaID)
	localCount := len(files)
	files = append(files, s.sharedFor(mediaID, files)...)

	v := &EntryView{
		Media: media, ListEntry: entry, LocalCount: localCount, SharedCount: len(files) - localCount,
		Images:   Images{Fanart: media.BannerImage, Poster: media.CoverImage.ExtraLarge},
		Mappings: Mappings{TmdbID: media.TMDBID, ImdbID: media.IMDbID, TvdbID: media.TVDBID},
	}
	details, err := s.seasonEpisodes(ctx, media, refresh)
	if err != nil {
		v.MetadataNote = "Episode details unavailable: " + err.Error()
	}
	s.fillEpisodes(v, media, entry, files, details)
	return v, nil
}

// seasonEpisodes fetches the episodes of every season of a show (specials
// included), by key.
func (s *Service) seasonEpisodes(ctx context.Context, media *catalog.Media, refresh bool) (map[int]*catalog.Episode, error) {
	out := map[int]*catalog.Episode{}
	if !media.IsShow() || s.Platform == nil {
		return out, nil
	}
	var (
		mu       sync.Mutex
		firstErr error
		wg       sync.WaitGroup
		next     = make(chan int)
	)
	for range min(4, len(media.Seasons)) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for n := range next {
				sd, err := s.Platform.Season(ctx, media.ID, n)
				mu.Lock()
				if err != nil {
					if firstErr == nil {
						firstErr = err
					}
				} else {
					for _, e := range sd.Episodes {
						out[e.Key] = e
					}
				}
				mu.Unlock()
			}
		}()
	}
	for _, season := range media.Seasons {
		next <- season.Number
	}
	close(next)
	wg.Wait()
	return out, firstErr
}

// fillEpisodes lists the episodes of the title page: the regular ones (the
// movie, or the show's from its seasons, plus any its files have beyond
// them), the specials (season 0, and special files) and the extras.
func (s *Service) fillEpisodes(v *EntryView, media *catalog.Media, entry *catalog.ListEntry, files []*LocalFile, details map[int]*catalog.Episode) {
	progress := 0
	if entry != nil {
		progress = entry.Progress
	}
	hist := s.History.ForMedia(media.ID)
	latest := media.LatestAired()
	today := time.Now().UTC().Format(time.DateOnly)
	fallbackImage := firstNonEmpty(media.BannerImage, media.CoverImage.ExtraLarge)

	mainFiles := map[int]*LocalFile{}
	specialFiles := map[int]*LocalFile{}
	for _, f := range files {
		switch {
		case f.Kind == "main" && f.Episode > 0:
			if old, ok := mainFiles[f.Episode]; !ok || betterFile(f, old) {
				mainFiles[f.Episode] = f
			}
		case f.Kind == "nc":
			v.Others = append(v.Others, &EpisodeView{Key: f.Episode, Title: f.Name, Kind: "nc", File: f, HasFile: true, Aired: true})
		case f.Episode > 0 && f.Episode < 1000:
			specialFiles[f.Episode] = f
		default:
			sp := &EpisodeView{Key: f.Episode, Title: f.Name, Kind: "special", File: f, HasFile: true, Aired: true}
			if f.Parsed.EpisodeTitle != "" {
				sp.Title = f.Parsed.EpisodeTitle
			}
			v.Specials = append(v.Specials, sp)
		}
	}

	view := func(key int, kind string) *EpisodeView {
		season, number := catalog.SplitKey(key)
		ep := &EpisodeView{Key: key, Season: season, Number: number, Kind: kind, Image: fallbackImage}
		if !media.IsShow() {
			ep.Season, ep.Number = 0, 1
			ep.Title = media.PreferredTitle()
			ep.Aired = media.Status != "NOT_YET_RELEASED"
		} else if d := details[key]; d != nil {
			ep.Title, ep.Summary, ep.AirDate, ep.Runtime = d.Title, d.Overview, d.AirDate, d.Runtime
			if d.Still != "" {
				ep.Image = d.Still
			}
			ep.Aired = d.AirDate != "" && d.AirDate <= today
		} else {
			ep.Aired = latest == 0 && media.Status != "NOT_YET_RELEASED" || key <= latest
		}
		if ep.Runtime == 0 && media.Duration != nil {
			ep.Runtime = *media.Duration
		}
		if h, ok := hist[key]; ok {
			ep.History = h
			ep.ResumeAt = s.History.ResumePosition(media.ID, key)
		}
		return ep
	}

	keys := media.EpisodeKeys()
	known := map[int]bool{}
	for _, k := range keys {
		known[k] = true
	}
	for k := range mainFiles {
		if !known[k] {
			keys = append(keys, k)
		}
	}
	sort.Ints(keys)
	for _, k := range keys {
		ep := view(k, "main")
		ep.Watched = progress > 0 && k <= progress
		if f, ok := mainFiles[k]; ok {
			ep.File, ep.HasFile, ep.Aired = f, true, true
		}
		v.Episodes = append(v.Episodes, ep)
	}

	// Specials: TMDB's season 0, with the files matched to them, then the
	// special files it doesn't have.
	var specialKeys []int
	for k := range details {
		if k < 1000 {
			specialKeys = append(specialKeys, k)
		}
	}
	sort.Ints(specialKeys)
	for _, k := range specialKeys {
		ep := view(k, "special")
		if f, ok := specialFiles[k]; ok {
			ep.File, ep.HasFile, ep.Aired = f, true, true
			delete(specialFiles, k)
		}
		v.Specials = append(v.Specials, ep)
	}
	var rest []int
	for k := range specialFiles {
		rest = append(rest, k)
	}
	sort.Ints(rest)
	for _, k := range rest {
		ep := view(k, "special")
		ep.File, ep.HasFile, ep.Aired = specialFiles[k], true, true
		if ep.Title == "" {
			ep.Title = firstNonEmpty(ep.File.Parsed.EpisodeTitle, ep.File.Name)
		}
		v.Specials = append(v.Specials, ep)
	}

	// Next episode to watch: the first one after progress; the first one
	// again for a title watched to the end (a rewatch) or not on the list.
	next := media.NextEpisode(progress)
	for _, ep := range v.Episodes {
		if ep.Key == next {
			v.NextEpisode = ep
			break
		}
	}
	if v.NextEpisode == nil && (entry == nil || entry.Status == "COMPLETED") && len(v.Episodes) > 0 {
		v.NextEpisode = v.Episodes[0]
	}
}

// EpisodesView is the episodes of a title page.
type EpisodesView struct {
	Episodes    []*EpisodeView `json:"episodes"`
	Specials    []*EpisodeView `json:"specials"`
	Others      []*EpisodeView `json:"others"`
	NextEpisode *EpisodeView   `json:"nextEpisode"`
}

// Episodes returns a title's episodes, with their files and history.
func (s *Service) Episodes(ctx context.Context, mediaID int) (*EpisodesView, error) {
	v, err := s.Entry(ctx, mediaID, false)
	if err != nil {
		return nil, err
	}
	return &EpisodesView{Episodes: v.Episodes, Specials: v.Specials, Others: v.Others, NextEpisode: v.NextEpisode}, nil
}

// shared are the files other KumoBox apps share with this one.
func (s *Service) shared() []*LocalFile {
	if s.Remote == nil {
		return nil
	}
	return s.Remote()
}

// sharedFor are a title's shared files, but its specials and extras this
// computer has too (same file name).
func (s *Service) sharedFor(mediaID int, local []*LocalFile) []*LocalFile {
	names := map[string]bool{}
	for _, f := range local {
		names[f.Name] = true
	}
	var out []*LocalFile
	for _, f := range s.shared() {
		if f.MediaID == mediaID && !f.Ignored && (f.Kind == "main" || !names[f.Name]) {
			out = append(out, f)
		}
	}
	return out
}

// ---------------------------------------------------------------------------
// Home / library collection view

type CollectionItem struct {
	Media      *catalog.Media     `json:"media"`
	ListEntry  *catalog.ListEntry `json:"listEntry"`
	LocalFiles int                `json:"localFiles"`
	// Downloaded are the keys of the episodes with a file.
	Downloaded []int `json:"downloaded"`
	// NextEpisode is the key of the episode to watch next (0: none).
	NextEpisode int   `json:"nextEpisode"`
	NextHasFile bool  `json:"nextHasFile"`
	LastWatched int64 `json:"lastWatched"`
}

type CollectionList struct {
	Status string            `json:"status"`
	Name   string            `json:"name"`
	Items  []*CollectionItem `json:"items"`
}

// ContinueItem is a title of "Continue watching". Episode is the key of the
// episode to watch, Index its place among the regular episodes ("13 / 24").
type ContinueItem struct {
	Media       *catalog.Media `json:"media"`
	Episode     int            `json:"episode"`
	Index       int            `json:"index"`
	Total       int            `json:"total"`
	Title       string         `json:"title"`
	Image       string         `json:"image"`
	Runtime     int            `json:"runtime"`
	HasFile     bool           `json:"hasFile"`
	FilePath    string         `json:"filePath,omitempty"`
	ResumeAt    float64        `json:"resumeAt"`
	Duration    float64        `json:"duration"`
	LastWatched int64          `json:"lastWatched"`
	Source      string         `json:"source"`
}

type CollectionView struct {
	Lists            []*CollectionList `json:"lists"`
	ContinueWatching []*ContinueItem   `json:"continueWatching"`
	UnmatchedCount   int               `json:"unmatchedCount"`
	IgnoredCount     int               `json:"ignoredCount"`
	LocalOnly        []*CollectionItem `json:"localOnly"` // matched files not in the list
	Genres           []string          `json:"genres"`
}

var statusNames = map[string]string{
	"CURRENT": "Watching", "REPEATING": "Rewatching", "PLANNING": "Watchlist",
	"PAUSED": "Paused", "COMPLETED": "Watched", "DROPPED": "Dropped",
}

func (s *Service) Collection(ctx context.Context, refresh bool) (*CollectionView, error) {
	coll, err := s.Platform.Collection(ctx, "", refresh)
	if err != nil {
		return nil, err
	}
	all, _ := s.Store.All()
	all = append(all, s.shared()...)
	filesByMedia := map[int][]*LocalFile{}
	view := &CollectionView{}
	for _, f := range all {
		if f.Ignored {
			view.IgnoredCount++
			continue
		}
		if f.MediaID == 0 {
			view.UnmatchedCount++
			continue
		}
		filesByMedia[f.MediaID] = append(filesByMedia[f.MediaID], f)
	}
	last := s.History.LastWatched()

	makeItem := func(e *catalog.ListEntry, media *catalog.Media) *CollectionItem {
		it := &CollectionItem{Media: media, ListEntry: e, LastWatched: last[media.ID]}
		progress := 0
		if e != nil {
			progress = e.Progress
		}
		it.NextEpisode = media.NextEpisode(progress)
		seen := map[int]bool{}
		for _, f := range filesByMedia[media.ID] {
			if f.Kind == "main" && f.Episode > 0 && !seen[f.Episode] {
				seen[f.Episode] = true
				it.Downloaded = append(it.Downloaded, f.Episode)
				if f.Episode == it.NextEpisode {
					it.NextHasFile = true
				}
			}
		}
		sort.Ints(it.Downloaded)
		it.LocalFiles = len(filesByMedia[media.ID])
		return it
	}

	genres := map[string]int{}
	inList := map[int]bool{}
	byStatus := map[string]*CollectionList{}
	for _, e := range coll.Entries() {
		inList[e.MediaID] = true
		for _, g := range e.Media.Genres {
			genres[g]++
		}
		l, ok := byStatus[e.Status]
		if !ok {
			l = &CollectionList{Status: e.Status, Name: statusNames[e.Status]}
			byStatus[e.Status] = l
		}
		l.Items = append(l.Items, makeItem(e, e.Media))
	}
	for _, st := range catalog.Statuses {
		if l, ok := byStatus[st]; ok {
			sort.SliceStable(l.Items, func(i, j int) bool {
				a, b := l.Items[i], l.Items[j]
				if a.LastWatched != b.LastWatched {
					return a.LastWatched > b.LastWatched
				}
				if a.ListEntry != nil && b.ListEntry != nil && a.ListEntry.UpdatedAt != b.ListEntry.UpdatedAt {
					return a.ListEntry.UpdatedAt > b.ListEntry.UpdatedAt
				}
				return a.Media.PreferredTitle() < b.Media.PreferredTitle()
			})
			view.Lists = append(view.Lists, l)
		}
	}

	// Matched files whose title isn't in the list.
	var missing []int
	for id := range filesByMedia {
		if !inList[id] {
			missing = append(missing, id)
		}
	}
	if len(missing) > 0 {
		medias, _ := s.Platform.MediaBatch(ctx, missing)
		for _, id := range missing {
			if m, ok := medias[id]; ok {
				view.LocalOnly = append(view.LocalOnly, makeItem(nil, m))
			}
		}
		sort.Slice(view.LocalOnly, func(i, j int) bool {
			return view.LocalOnly[i].Media.PreferredTitle() < view.LocalOnly[j].Media.PreferredTitle()
		})
	}

	view.ContinueWatching = s.continueWatching(ctx, coll, filesByMedia)
	for g := range genres {
		view.Genres = append(view.Genres, g)
	}
	sort.Slice(view.Genres, func(i, j int) bool {
		if genres[view.Genres[i]] != genres[view.Genres[j]] {
			return genres[view.Genres[i]] > genres[view.Genres[j]]
		}
		return view.Genres[i] < view.Genres[j]
	})
	return view, nil
}

// finishedAt is how far into an episode it counts as watched.
const finishedAt = 0.85

func (s *Service) continueWatching(ctx context.Context, coll *catalog.Collection, files map[int][]*LocalFile) []*ContinueItem {
	var out []*ContinueItem
	seen := map[int]bool{}
	last := s.History.LastWatched()
	hidden := s.hiddenContinue()

	add := func(media *catalog.Media, ep int, src string) {
		if media == nil || seen[media.ID] || ep <= 0 {
			return
		}
		// Removed by the user: stays away until the episode to continue
		// with changes or the title is watched again.
		if h, ok := hidden[media.ID]; ok && h.Episode == ep && last[media.ID] <= h.HiddenAt {
			seen[media.ID] = true // not offered again from the history below
			return
		}
		// Not out yet.
		if media.Status == "NOT_YET_RELEASED" {
			return
		}
		if aired := media.LatestAired(); media.IsShow() && media.Status == "RELEASING" && aired > 0 && ep > aired {
			return
		}
		it := &ContinueItem{Media: media, Episode: ep, Index: media.EpisodeIndex(ep), Total: media.TotalEpisodes(), LastWatched: last[media.ID], Source: src}
		if f := EpisodeFile(files[media.ID], ep); f != nil {
			it.HasFile, it.FilePath = true, f.Path
		}
		if h := s.History.Get(media.ID, ep); h != nil {
			it.ResumeAt = s.History.ResumePosition(media.ID, ep)
			it.Duration = h.Duration
		}
		if media.Duration != nil {
			it.Runtime = *media.Duration
		}
		it.Image = firstNonEmpty(media.BannerImage, media.CoverImage.ExtraLarge)
		if !media.IsShow() {
			it.Title = media.PreferredTitle()
		} else if s.Platform != nil {
			season, _ := catalog.SplitKey(ep)
			if sd, err := s.Platform.Season(ctx, media.ID, season); err == nil {
				for _, e := range sd.Episodes {
					if e.Key == ep {
						it.Title = e.Title
						if e.Runtime > 0 {
							it.Runtime = e.Runtime
						}
						if e.Still != "" {
							it.Image = e.Still
						}
					}
				}
			}
		}
		seen[media.ID] = true
		out = append(out, it)
	}

	// 1) Titles being watched, ordered by most recent activity: on this
	// computer (or another KumoBox on the same account, whose history comes
	// over), or a change of the list (an episode marked by hand, a sync).
	var watching []*catalog.ListEntry
	for _, e := range coll.Entries() {
		if e.Status == "CURRENT" || e.Status == "REPEATING" {
			watching = append(watching, e)
			last[e.MediaID] = max(last[e.MediaID], e.UpdatedAt)
		}
	}
	sort.SliceStable(watching, func(i, j int) bool {
		li, lj := last[watching[i].MediaID], last[watching[j].MediaID]
		if li != lj {
			return li > lj
		}
		return watching[i].UpdatedAt > watching[j].UpdatedAt
	})
	for _, e := range watching {
		ep := e.Media.NextEpisode(e.Progress)
		// A partially watched episode takes priority over the next one.
		if h := s.History.Get(e.MediaID, ep); h == nil && e.Progress > 0 {
			if hc := s.History.Get(e.MediaID, e.Progress); hc != nil && hc.Percent() < finishedAt {
				ep = e.Progress
			}
		}
		add(e.Media, ep, "list")
		if len(out) >= 20 {
			break
		}
	}
	// 2) Recently played things not on the list (local-only, streams).
	for _, h := range s.History.Recent(30) {
		if seen[h.MediaID] || len(out) >= 24 || s.Platform == nil {
			continue
		}
		media, err := s.Platform.MediaLite(ctx, h.MediaID)
		if err != nil {
			continue
		}
		ep := h.Episode
		if h.Percent() >= finishedAt {
			ep = media.NextEpisode(h.Episode)
		}
		add(media, ep, h.Source)
	}
	// Most recently watched first, list-only items keep their order after.
	sort.SliceStable(out, func(i, j int) bool { return out[i].LastWatched > out[j].LastWatched })
	return out
}

// continueHiddenKey holds the items removed from "Continue watching", by
// media id: the episode the item offered and when it was removed.
const continueHiddenKey = "continue-hidden"

type hiddenItem struct {
	Episode  int   `json:"episode"`
	HiddenAt int64 `json:"hiddenAt"` // unix seconds, like the watch history
}

func (s *Service) hiddenContinue() map[int]hiddenItem {
	out := map[int]hiddenItem{}
	_, _ = s.DB.GetKV(continueHiddenKey, &out)
	return out
}

// updateHidden changes the removed items under a lock, so requests at the
// same time can't overwrite each other's changes.
func (s *Service) updateHidden(fn func(items map[int]hiddenItem)) error {
	s.hiddenMu.Lock()
	defer s.hiddenMu.Unlock()
	items := map[int]hiddenItem{}
	if _, err := s.DB.GetKV(continueHiddenKey, &items); err != nil {
		return err
	}
	fn(items)
	if len(items) == 0 {
		return s.DB.DeleteKV(continueHiddenKey)
	}
	return s.DB.SetKV(continueHiddenKey, items)
}

// HideContinue removes a title from "Continue watching" for as long as it
// offers that episode: it comes back by itself once the episode changes
// (progress made elsewhere) or the title is watched again.
func (s *Service) HideContinue(mediaID, episode int) error {
	last := s.History.LastWatched()
	now := time.Now().Unix()
	return s.updateHidden(func(items map[int]hiddenItem) {
		for id, it := range items {
			if last[id] > it.HiddenAt {
				delete(items, id) // watched again since: back for good
			}
		}
		items[mediaID] = hiddenItem{Episode: episode, HiddenAt: now}
	})
}

// UnhideContinue puts a removed title back in "Continue watching".
func (s *Service) UnhideContinue(mediaID int) error {
	return s.updateHidden(func(items map[int]hiddenItem) { delete(items, mediaID) })
}

// EpisodeFile returns the file to play for an episode (by key) among a
// title's files, or nil (see betterFile).
func EpisodeFile(files []*LocalFile, episode int) *LocalFile {
	var best *LocalFile
	for _, f := range files {
		if f.Kind == "main" && f.Episode == episode && !f.Ignored && (best == nil || betterFile(f, best)) {
			best = f
		}
	}
	return best
}

// betterFile reports whether f is the one to play when it and old are
// matched to the same episode, e.g. two releases of a movie: a match made
// by hand wins, then the surer match, then the bigger file. A file on this
// computer always wins.
func betterFile(f, old *LocalFile) bool {
	// This computer's file, not one another KumoBox shares.
	if (f.Host == "") != (old.Host == "") {
		return f.Host == ""
	}
	if f.Locked != old.Locked {
		return f.Locked
	}
	if f.MatchScore != old.MatchScore {
		return f.MatchScore > old.MatchScore
	}
	return f.Size > old.Size
}
