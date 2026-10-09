package library

import (
	"context"
	"errors"
	"testing"

	"github.com/v0-0x/kumobox-movies/server/internal/catalog"
)

func testMovie(id int, title string, year int) *catalog.Media {
	m := &catalog.Media{ID: catalog.MovieID(id), TMDBID: id, Type: catalog.TypeMovie, Format: catalog.TypeMovie, SeasonYear: &year}
	m.Title.English, m.Title.UserPreferred = title, title
	return m
}

func testShow(id int, title string, seasons ...int) *catalog.Media {
	m := &catalog.Media{ID: catalog.ShowID(id), TMDBID: id, Type: catalog.TypeTV, Format: catalog.TypeTV, Status: "FINISHED"}
	m.Title.English, m.Title.UserPreferred = title, title
	for i, n := range seasons {
		m.Seasons = append(m.Seasons, catalog.Season{Number: i + 1, EpisodeCount: n})
	}
	return m
}

// A sequel whose title only adds "2" (or "II", "Final"…) to the first
// film's looks 0.95 alike: it must not be matched to the first film on the
// user's list without even searching TMDB for the sequel, nor the other
// way round.
func TestSequelsMatchTheirOwnEntry(t *testing.T) {
	ts1 := testMovie(862, "Toy Story", 1995)
	ts2 := testMovie(863, "Toy Story 2", 1999)
	score := func(g *group, pool ...*catalog.Media) candidateScore {
		return scoreCandidates(buildQueries(g), pool, g)
	}

	ts2Files := &group{title: "Toy Story 2", folderTitle: "Toy Story 2 (1999)", year: 1999, kind: "main"}
	if b := score(ts2Files, ts1); b.score >= 0.5 {
		t.Errorf("Toy Story 2 files vs Toy Story alone: %.2f, want below the match threshold (and a search of TMDB)", b.score)
	}
	if b := score(ts2Files, ts1, ts2); b.media != ts2 || b.score < 0.92 {
		t.Errorf("Toy Story 2 files matched %v (%.2f)", b.media.Title.English, b.score)
	}

	ts1Files := &group{title: "Toy Story", folderTitle: "Toy Story (1995)", year: 1995, kind: "main"}
	if b := score(ts1Files, ts1, ts2); b.media != ts1 {
		t.Errorf("Toy Story files matched %v", b.media.Title.English)
	}
	if b := score(ts1Files, ts2); b.score >= 0.92 {
		t.Errorf("Toy Story files vs the sequel alone: %.2f, want TMDB searched for a better match", b.score)
	}

	mi := testMovie(954, "Mission: Impossible", 1996)
	mi2 := testMovie(955, "Mission: Impossible II", 2000)
	if b := score(&group{title: "Mission Impossible II", kind: "main"}, mi, mi2); b.media != mi2 {
		t.Errorf("M:I-2 files matched %v", b.media.Title.English)
	}

	// The season of a show's files is no sequel marker: TMDB has every
	// season under the show.
	bb := testShow(1396, "Breaking Bad", 7, 13)
	elCamino := testMovie(559969, "El Camino: A Breaking Bad Movie", 2019)
	if b := score(&group{title: "Breaking Bad", folderTitle: "Breaking Bad Season 2", season: 2, kind: "main", episodic: true}, elCamino, bb); b.media != bb || b.score < 0.92 {
		t.Errorf("Breaking Bad S02 files matched %v (%.2f)", b.media.Title.English, b.score)
	}
}

// When two files are matched to one episode (two releases of a movie, say),
// the one played is the hand-matched one, then the surer match, then the
// bigger file.
func TestEpisodeFile(t *testing.T) {
	a := &LocalFile{Path: "/a/Heat (1995)/Heat.1995.1080p.mkv", Kind: "main", Episode: 1, MatchScore: 1, Size: 1}
	b := &LocalFile{Path: "/a/Heat.1995.2160p.mkv", Kind: "main", Episode: 1, MatchScore: 0.96, Size: 2}
	if f := EpisodeFile([]*LocalFile{b, a}, 1); f != a {
		t.Errorf("got %s, want the surer match", f.Path)
	}
	b.Locked = true
	if f := EpisodeFile([]*LocalFile{a, b}, 1); f != b {
		t.Errorf("got %s, want the match made by hand", f.Path)
	}
	if f := EpisodeFile([]*LocalFile{a, b}, 2); f != nil {
		t.Errorf("episode 2: %v", f)
	}
}

// The first film's files, with only the sequel on the list: TMDB finds the
// first film. When TMDB can't be searched (offline, rate limited), or
// matching is limited to the list, the sequel isn't taken instead:
// watching the first film would have marked the sequel watched.
func TestSequelNeverTakenForLackOfBetter(t *testing.T) {
	ts1 := testMovie(862, "Toy Story", 1995)
	ts2 := testMovie(863, "Toy Story 2", 1999)
	ts1Files := &group{title: "Toy Story", folderTitle: "Toy Story", kind: "main"}
	matcher := func(outsideList bool, search func(string) ([]*catalog.Media, error)) *Matcher {
		m := NewMatcher(nil, 0.5, outsideList)
		m.searchFn = func(_ context.Context, q string) ([]*catalog.Media, error) { return search(q) }
		return m
	}

	found := matcher(true, func(string) ([]*catalog.Media, error) { return []*catalog.Media{ts1, ts2}, nil })
	if b := found.bestMatch(context.Background(), ts1Files, []*catalog.Media{ts2}); b.media != ts1 {
		t.Errorf("TMDB answering: matched %v, want Toy Story", b.media)
	}

	down := matcher(true, func(string) ([]*catalog.Media, error) { return nil, errors.New("429 Too Many Requests") })
	if b := down.bestMatch(context.Background(), ts1Files, []*catalog.Media{ts2}); b.media != nil {
		t.Errorf("TMDB not answering: matched %s, want unmatched (tried again next scan)", b.media.Title.English)
	}
	if down.SearchFailures() == 0 {
		t.Error("the failed search isn't counted")
	}
	// A failure isn't remembered: the next file asks again.
	if _, ok := down.search(context.Background(), "Toy Story"); ok || len(down.searchCache) != 0 {
		t.Error("a failed search was cached")
	}

	listOnly := matcher(false, func(string) ([]*catalog.Media, error) {
		t.Error("searched TMDB with matching limited to the list")
		return nil, nil
	})
	if b := listOnly.bestMatch(context.Background(), ts1Files, []*catalog.Media{ts2}); b.media != nil {
		t.Errorf("list only: matched %s, want unmatched", b.media.Title.English)
	}
	// The sequel's own files still match it from the list, without a search.
	ts2Files := &group{title: "Toy Story 2", folderTitle: "Toy Story 2", kind: "main"}
	if b := listOnly.bestMatch(context.Background(), ts2Files, []*catalog.Media{ts1, ts2}); b.media != ts2 {
		t.Errorf("Toy Story 2 files: matched %v", b.media)
	}
}

func TestFileKey(t *testing.T) {
	show := testShow(1396, "Breaking Bad", 7, 13, 13)
	movie := testMovie(155, "The Dark Knight", 2008)
	file := func(kind string, season, ep int) *LocalFile {
		return &LocalFile{Kind: kind, Parsed: Parsed{Season: season, Episode: ep, Kind: kind}}
	}
	for _, c := range []struct {
		name  string
		f     *LocalFile
		media *catalog.Media
		want  int
	}{
		{"S02E05", file("main", 2, 5), show, 2005},
		{"no season", file("main", 0, 5), show, 1005},
		{"numbered across seasons", file("main", 0, 10), show, 2003},
		{"past the known ones", file("main", 0, 40), show, 1040},
		{"special", file("special", 0, 3), show, 3},
		{"no episode", file("main", 0, -1), show, 0},
		{"creditless", file("nc", 1, 1), show, 0},
		{"movie", file("main", 0, -1), movie, catalog.MovieEpisode},
		{"movie part", file("main", 0, 2), movie, catalog.MovieEpisode},
		{"movie extra", file("special", 0, -1), movie, 0},
		{"seasons unknown", file("main", 0, 30), testShow(1, "New Show"), 1030},
	} {
		if got := FileKey(c.f, c.media); got != c.want {
			t.Errorf("%s: %d, want %d", c.name, got, c.want)
		}
	}
}
