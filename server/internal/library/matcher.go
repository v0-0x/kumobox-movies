package library

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"sync"

	"github.com/v0-0x/kumobox-movies/server/internal/catalog"
	"github.com/v0-0x/kumobox-movies/server/internal/util"
)

// Matcher links parsed files to TMDB movies and shows.
type Matcher struct {
	platform    *catalog.Platform
	threshold   float64
	outsideList bool
	// searchFn searches TMDB, listFn gives the titles of the user's list,
	// detailFn a title with its seasons (tests replace them).
	searchFn func(ctx context.Context, q string) ([]*catalog.Media, error)
	listFn   func(ctx context.Context) []*catalog.Media
	detailFn func(ctx context.Context, id int) (*catalog.Media, error)

	mu          sync.Mutex
	searchCache map[string][]*catalog.Media
	detailCache map[int]*catalog.Media
	failed      int // TMDB searches that failed
}

func NewMatcher(p *catalog.Platform, threshold float64, outsideList bool) *Matcher {
	m := &Matcher{
		platform:    p,
		threshold:   threshold,
		outsideList: outsideList,
		searchCache: map[string][]*catalog.Media{},
		detailCache: map[int]*catalog.Media{},
	}
	m.searchFn = func(ctx context.Context, q string) ([]*catalog.Media, error) {
		page, err := p.Search(ctx, catalog.SearchParams{Search: q})
		if err != nil || page == nil {
			return nil, err
		}
		return page.Media, nil
	}
	m.listFn = func(ctx context.Context) []*catalog.Media {
		coll, err := p.Collection(ctx, "", false)
		if err != nil {
			return nil
		}
		var pool []*catalog.Media
		for _, e := range coll.Entries() {
			pool = append(pool, e.Media)
		}
		return pool
	}
	if p != nil {
		m.detailFn = func(ctx context.Context, id int) (*catalog.Media, error) { return p.MediaLite(ctx, id) }
	}
	return m
}

// SearchFailures is how many TMDB searches failed: matches that may be
// better when TMDB answers.
func (m *Matcher) SearchFailures() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.failed
}

type candidateScore struct {
	media *catalog.Media
	score float64
	// mismatch: the title differs from the file's in what tells sequels
	// apart (scored lower, see markerPenalty): "Toy Story" files and "Toy
	// Story 2".
	mismatch bool
}

type group struct {
	title, folderTitle string
	season, part, year int
	kind               string
	// episodic: the files have episode numbers (a show's).
	episodic bool
	files    []*LocalFile
}

// MatchFiles assigns MediaID/Episode on every file in place. progress is
// called after each group.
func (m *Matcher) MatchFiles(ctx context.Context, files []*LocalFile, progress func(done, total int, title string)) {
	if len(files) == 0 {
		return
	}
	pool := m.listFn(ctx)

	groups := map[string]*group{}
	var order []string
	for _, f := range files {
		p := f.Parsed
		key := fmt.Sprintf("%s|%s|%d", util.NormalizeTitle(p.Title), util.NormalizeTitle(p.FolderTitle), p.Part)
		g, ok := groups[key]
		if !ok {
			g = &group{title: p.Title, folderTitle: p.FolderTitle, season: p.Season, part: p.Part, year: p.Year, kind: p.Kind}
			groups[key] = g
			order = append(order, key)
		}
		g.episodic = g.episodic || p.Episode >= 0 && p.Kind == "main"
		g.files = append(g.files, f)
	}

	for i, key := range order {
		if ctx.Err() != nil {
			return
		}
		g := groups[key]
		best := m.bestMatch(ctx, g, pool)
		if progress != nil {
			progress(i+1, len(order), util.FirstNonEmpty(g.title, g.folderTitle))
		}
		if best.media == nil || best.score < m.threshold {
			for _, f := range g.files {
				f.MediaID, f.Episode, f.MatchScore = 0, 0, best.score
			}
			continue
		}
		media := best.media
		if d := m.detail(ctx, media.ID); d != nil {
			media = d // with its seasons
		}
		for _, f := range g.files {
			assign(f, media, best.score)
		}
	}
}

func (m *Matcher) bestMatch(ctx context.Context, g *group, pool []*catalog.Media) candidateScore {
	queries := buildQueries(g)
	if len(queries) == 0 {
		return candidateScore{}
	}
	best := scoreCandidates(queries, pool, g)
	// Good enough from the user's own list?
	if best.score >= 0.92 && !best.mismatch {
		return best
	}
	if !m.outsideList {
		return notAnotherTitle(best)
	}
	// Otherwise search TMDB.
	seen := map[int]bool{}
	searched := true
	var extra []*catalog.Media
	for _, q := range queries[:min(2, len(queries))] {
		res, ok := m.search(ctx, q.text)
		searched = searched && ok
		for _, r := range res {
			if !seen[r.ID] {
				seen[r.ID] = true
				extra = append(extra, r)
			}
		}
	}
	if alt := scoreCandidates(queries, extra, g); alt.score > best.score+0.02 {
		best = alt
	}
	if !searched {
		return notAnotherTitle(best)
	}
	return best
}

// notAnotherTitle keeps a match only if it isn't another title of the
// franchise than the file's (only its title tells: "2", "II", "Final"…),
// which is all an entry of the list can be when TMDB can't be asked for the
// right one. Rather unmatched: tried again at the next scan.
func notAnotherTitle(c candidateScore) candidateScore {
	if c.mismatch {
		return candidateScore{score: c.score}
	}
	return c
}

// search searches TMDB, and reports whether it could: a failure isn't
// kept, so the next file asks again.
func (m *Matcher) search(ctx context.Context, q string) ([]*catalog.Media, bool) {
	key := util.NormalizeTitle(q)
	m.mu.Lock()
	if r, ok := m.searchCache[key]; ok {
		m.mu.Unlock()
		return r, true
	}
	m.mu.Unlock()
	res, err := m.searchFn(ctx, q)
	m.mu.Lock()
	defer m.mu.Unlock()
	if err != nil {
		m.failed++
		return nil, false
	}
	m.searchCache[key] = res
	return res, true
}

type query struct {
	text   string
	weight float64
}

// buildQueries are the titles to look for: the file's and its folder's,
// without the season (TMDB has a show's seasons under the show).
func buildQueries(g *group) []query {
	var bases []string
	for _, t := range []string{g.title, g.folderTitle} {
		t = strings.TrimSpace(reSeasonAny.ReplaceAllString(t, ""))
		t = strings.Trim(t, " -:")
		if t != "" && !containsFold(bases, t) {
			bases = append(bases, t)
		}
	}
	var out []query
	for _, b := range bases {
		if g.part > 0 {
			out = append(out, query{fmt.Sprintf("%s Part %d", b, g.part), 1})
		}
		out = append(out, query{b, 1})
	}
	return out
}

func containsFold(list []string, s string) bool {
	for _, x := range list {
		if strings.EqualFold(x, s) {
			return true
		}
	}
	return false
}

func scoreCandidates(queries []query, pool []*catalog.Media, g *group) candidateScore {
	var best candidateScore
	titleMarkers := fileMarkers(g)
	for _, media := range pool {
		if media == nil {
			continue
		}
		var s float64
		mismatch := false
		for _, t := range media.AllTitles() {
			penalty := markerPenalty(titleMarkers, util.SequelMarkers(t))
			for _, q := range queries {
				if v := util.Similarity(q.text, t)*q.weight - penalty; v > s {
					s, mismatch = v, penalty > 0
				}
			}
		}
		if s == 0 {
			continue
		}
		if g.year > 0 {
			if y := media.Year(); y == g.year {
				s += 0.05
			} else if y > 0 && !g.episodic && abs(y-g.year) > 1 {
				// A show's files may carry the year of a later season.
				s -= 0.05
			}
		}
		// Files with episode numbers are a show's, others a movie's.
		if g.kind == "main" && g.episodic == media.IsShow() {
			s += 0.01
		}
		if s > best.score {
			best = candidateScore{media, s, mismatch}
		}
	}
	if best.score > 1 {
		best.score = 1
	}
	return best
}

// fileMarkers returns the sequel markers (util.SequelMarkers) in the
// group's own titles, like the "2" of "Toy Story 2".
func fileMarkers(g *group) []string {
	var out []string
	for _, t := range []string{g.title, g.folderTitle} {
		for _, m := range util.SequelMarkers(reSeasonAny.ReplaceAllString(t, "")) {
			if !slices.Contains(out, m) {
				out = append(out, m)
			}
		}
	}
	return out
}

// markerPenalty lowers the score of a candidate title whose sequel markers
// differ from the file's. Titles that differ only in those look almost the
// same to util.Similarity ("Toy Story" and "Toy Story 2"), but a file named
// after a sequel isn't the first film, and a file named after the first
// film is less likely a sequel.
func markerPenalty(fileTitle []string, candidate []string) float64 {
	for _, m := range fileTitle {
		if !slices.Contains(candidate, m) {
			return 0.5
		}
	}
	for _, m := range candidate {
		if !slices.Contains(fileTitle, m) {
			return 0.1
		}
	}
	return 0
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

func (m *Matcher) detail(ctx context.Context, id int) *catalog.Media {
	m.mu.Lock()
	if d, ok := m.detailCache[id]; ok {
		m.mu.Unlock()
		return d
	}
	m.mu.Unlock()
	if m.detailFn == nil {
		return nil
	}
	d, err := m.detailFn(ctx, id)
	if err != nil {
		return nil
	}
	m.mu.Lock()
	m.detailCache[id] = d
	m.mu.Unlock()
	return d
}

// assign sets the media and episode key of a file (see FileKey).
func assign(f *LocalFile, media *catalog.Media, score float64) {
	f.MediaID = media.ID
	f.MatchScore = score
	f.AiredEpisode = f.Parsed.Episode
	f.Episode = FileKey(f, media)
	if media.IsShow() && f.Kind == "main" && f.Parsed.Season == 0 && f.Parsed.Episode == 0 {
		f.Kind = "special"
	}
}

// FileKey is the episode key of a file of media: the movie's one episode,
// or for a show the season and episode its name gives (season 0 holds the
// specials). An episode number without a season counts from the first
// episode of the show ("One Piece - 1050"). 0 when unknown, and for
// creditless openings, a movie's extras and such.
func FileKey(f *LocalFile, media *catalog.Media) int {
	if f.Kind == "nc" {
		return 0
	}
	if !media.IsShow() {
		if f.Kind != "main" {
			return 0
		}
		return catalog.MovieEpisode
	}
	ep, season := f.Parsed.Episode, f.Parsed.Season
	switch {
	case ep <= 0:
		return 0
	case season > 0:
		return catalog.EpisodeKey(season, ep)
	case f.Kind == "special":
		return catalog.EpisodeKey(0, ep)
	case ep <= max(media.SeasonEpisodeCount(1), 1) || len(media.Seasons) == 0:
		return catalog.EpisodeKey(1, ep)
	}
	if k := media.KeyAtIndex(ep); k > 0 {
		return k
	}
	return catalog.EpisodeKey(1, ep)
}
