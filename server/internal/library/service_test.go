package library

import (
	"context"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/v0-0x/kumobox-movies/server/internal/catalog"
	"github.com/v0-0x/kumobox-movies/server/internal/db"
	"github.com/v0-0x/kumobox-movies/server/internal/history"
)

func newTestService(t *testing.T) *Service {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "kumobox.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	return &Service{Store: NewStore(d), History: history.NewStore(d), DB: d}
}

// show is the media id of test show n.
func show(n int) int { return catalog.ShowID(n) }

// watching is a list of shows of one 12-episode season being watched: show
// number → progress (episode of season 1).
func watching(progress map[int]int) *catalog.Collection {
	l := &catalog.List{Name: "Watching", Status: "CURRENT"}
	for n, p := range progress {
		m := testShow(n, "Show", 12)
		key := 0
		if p > 0 {
			key = catalog.EpisodeKey(1, p)
		}
		l.Entries = append(l.Entries, &catalog.ListEntry{MediaID: m.ID, Status: "CURRENT", Progress: key, Media: m})
	}
	return &catalog.Collection{Lists: []*catalog.List{l}}
}

func TestHideContinue(t *testing.T) {
	s := newTestService(t)
	ctx := context.Background()
	// offered returns the episode offered for each show (by number), as
	// the number of the episode in season 1.
	offered := func(progress map[int]int) map[int]int {
		out := map[int]int{}
		for _, it := range s.continueWatching(ctx, watching(progress), nil) {
			_, e := catalog.SplitKey(it.Episode)
			out[it.Media.TMDBID] = e
		}
		return out
	}
	hide := func(n, ep int) {
		t.Helper()
		if err := s.HideContinue(show(n), catalog.EpisodeKey(1, ep)); err != nil {
			t.Fatal(err)
		}
	}
	watch := func(n, ep int) {
		t.Helper()
		if err := s.History.Save(history.Entry{MediaID: show(n), Episode: catalog.EpisodeKey(1, ep), Position: 300, Duration: 1400}); err != nil {
			t.Fatal(err)
		}
	}

	list := map[int]int{1: 3, 2: 5}
	// Last watched of the first one: a rewatch of episode 2. Once hidden,
	// its history must not offer it again with that episode. (s has no
	// Platform, so even looking it up for that would panic.)
	watch(1, 2)
	if got := offered(list); len(got) != 2 || got[1] != 4 || got[2] != 6 {
		t.Fatalf("before hiding: %v", got)
	}
	hide(1, 4)
	if got := offered(list); len(got) != 1 || got[2] != 6 {
		t.Fatalf("hidden show still offered: %v", got)
	}

	// Progress made elsewhere (another device, marked by hand): it offers
	// another episode, so it is back.
	if got := offered(map[int]int{1: 4, 2: 5}); got[1] != 5 {
		t.Fatalf("not back for the next episode: %v", got)
	}

	// Watching another show doesn't bring it back, watching it does.
	watch(2, 6)
	if got := offered(list); got[1] != 0 {
		t.Fatalf("back after watching another show: %v", got)
	}
	// Hidden a minute ago: the history has whole seconds, and watching in
	// the same second as hiding counts as before.
	_ = s.updateHidden(func(items map[int]hiddenItem) {
		it := items[show(1)]
		it.HiddenAt -= 60
		items[show(1)] = it
	})
	watch(1, 4)
	if got := offered(list); got[1] != 4 {
		t.Fatalf("not back after watching it again: %v", got)
	}

	// Undo. Hiding also forgets the show that came back by being watched.
	hide(2, 6)
	if got := offered(list); got[2] != 0 {
		t.Fatalf("hidden show still offered: %v", got)
	}
	if _, ok := s.hiddenContinue()[show(1)]; ok {
		t.Fatalf("show watched again is still stored: %v", s.hiddenContinue())
	}
	if err := s.UnhideContinue(show(2)); err != nil {
		t.Fatal(err)
	}
	if got := offered(list); got[2] != 6 {
		t.Fatalf("not back after unhiding: %v", got)
	}
}

func TestHideContinueConcurrent(t *testing.T) {
	s := newTestService(t)
	var wg sync.WaitGroup
	for id := 1; id <= 20; id++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := s.HideContinue(id, 1); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if n := len(s.hiddenContinue()); n != 20 {
		t.Fatalf("%d of 20 hidden titles saved", n)
	}
}

// Files other KumoBox apps share fill in the episodes this computer doesn't
// have; its own always win.
func TestSharedFilesFillIn(t *testing.T) {
	s := newTestService(t)
	id := show(5)
	local := []*LocalFile{
		{Path: "/a/Show S01E01.mkv", Name: "Show S01E01.mkv", MediaID: id, Episode: 1001, Kind: "main", Size: 100},
		{Path: "/a/Show S00E01.mkv", Name: "Show S00E01.mkv", MediaID: id, Episode: 1, Kind: "special"},
	}
	shared := []*LocalFile{
		{Path: "kumobox://h//b/Show S01E01.mkv", Name: "Show S01E01.mkv", MediaID: id, Episode: 1001, Kind: "main", Size: 900, Host: "h", MatchScore: 1},
		{Path: "kumobox://h//b/Show S01E02.mkv", Name: "Show S01E02.mkv", MediaID: id, Episode: 1002, Kind: "main", Host: "h"},
		{Path: "kumobox://h//b/Show S00E01.mkv", Name: "Show S00E01.mkv", MediaID: id, Episode: 1, Kind: "special", Host: "h"},
		{Path: "kumobox://h//b/Show - Featurette.mkv", Name: "Show - Featurette.mkv", MediaID: id, Kind: "nc", Host: "h"},
		{Path: "kumobox://h//b/Other S01E01.mkv", Name: "Other S01E01.mkv", MediaID: show(6), Episode: 1001, Kind: "main", Host: "h"},
	}
	s.Remote = func() []*LocalFile { return shared }

	got := map[string]bool{}
	for _, f := range s.sharedFor(id, local) {
		got[f.Name] = true
	}
	if !got["Show S01E01.mkv"] || !got["Show S01E02.mkv"] || !got["Show - Featurette.mkv"] || got["Show S00E01.mkv"] || got["Other S01E01.mkv"] {
		t.Errorf("shared files of the show: %v", got)
	}

	all := append(append([]*LocalFile{}, local...), s.sharedFor(id, local)...)
	if f := EpisodeFile(all, 1001); f == nil || f.Host != "" {
		t.Errorf("S01E01 plays from %+v, want this computer's file", f)
	}
	if f := EpisodeFile(all, 1002); f == nil || f.Host != "h" {
		t.Errorf("S01E02 plays from %+v, want the shared file", f)
	}

	items := s.continueWatching(context.Background(), watching(map[int]int{5: 1}), map[int][]*LocalFile{id: all})
	if len(items) != 1 || items[0].Episode != 1002 || items[0].Index != 2 || items[0].Total != 12 || !items[0].HasFile || items[0].FilePath != "kumobox://h//b/Show S01E02.mkv" {
		t.Errorf("continue watching: %+v", items)
	}
}

// Continue watching follows the list: a show whose entry was just updated
// (watched on another device, marked by hand) comes before one watched here
// long ago.
func TestContinueWatchingFollowsTheList(t *testing.T) {
	s := newTestService(t)
	coll := watching(map[int]int{5: 3, 6: 7})
	for _, e := range coll.Entries() {
		e.UpdatedAt = 1000
		if e.MediaID == show(6) {
			e.UpdatedAt = time.Now().Unix()
		}
	}
	if err := s.History.Save(history.Entry{MediaID: show(5), Episode: 1004, Position: 100, Duration: 1400, Source: "local"}); err != nil {
		t.Fatal(err)
	}
	// Watched here, but before the other change.
	if _, err := s.DB.Write(`UPDATE watch_history SET updated_at = ?`, time.Now().Unix()-3600); err != nil {
		t.Fatal(err)
	}
	items := s.continueWatching(context.Background(), coll, nil)
	if len(items) != 2 || items[0].Media.ID != show(6) || items[0].Episode != 1008 || items[1].Media.ID != show(5) || items[1].Episode != 1004 {
		var got []int
		for _, it := range items {
			got = append(got, it.Episode)
		}
		t.Errorf("continue watching %v, want show 6 (S01E08) first", got)
	}
}

// Continue watching goes on to the next season, offers nothing after the
// last episode, and never an episode that hasn't aired.
func TestContinueWatchingSeasons(t *testing.T) {
	s := newTestService(t)
	ended := testShow(1, "Ended", 2, 3)
	airing := testShow(2, "Airing", 4, 4)
	airing.Status, airing.LatestEpisode = "RELEASING", 2002
	l := &catalog.List{Status: "CURRENT", Entries: []*catalog.ListEntry{
		{MediaID: ended.ID, Status: "CURRENT", Progress: 1002, Media: ended},
		{MediaID: airing.ID, Status: "CURRENT", Progress: 2001, Media: airing},
	}}
	got := map[int]int{}
	for _, it := range s.continueWatching(context.Background(), &catalog.Collection{Lists: []*catalog.List{l}}, nil) {
		got[it.Media.TMDBID] = it.Episode
	}
	if got[1] != 2001 || got[2] != 2002 {
		t.Errorf("offered %v", got)
	}
	l.Entries[0].Progress, l.Entries[1].Progress = 2003, 2002
	got = map[int]int{}
	for _, it := range s.continueWatching(context.Background(), &catalog.Collection{Lists: []*catalog.List{l}}, nil) {
		got[it.Media.TMDBID] = it.Episode
	}
	if len(got) != 0 {
		t.Errorf("offered %v after the last (aired) episodes", got)
	}
}

// The title page lists a show's episodes by season with TMDB's details,
// its specials (season 0 and special files) and its extras; a movie has
// one episode.
func TestFillEpisodes(t *testing.T) {
	s := newTestService(t)
	m := testShow(1396, "Breaking Bad", 2, 2)
	m.Seasons = append([]catalog.Season{{Number: 0, EpisodeCount: 1}}, m.Seasons...)
	details := map[int]*catalog.Episode{
		1001: {Key: 1001, Title: "Pilot", AirDate: "2008-01-20", Still: "/still.jpg", Runtime: 58},
		1002: {Key: 1002, Title: "Cat's in the Bag...", AirDate: "2008-01-27"},
		2001: {Key: 2001, Title: "Seven Thirty-Seven", AirDate: "2009-03-08"},
		2002: {Key: 2002, Title: "Grilled", AirDate: "2999-03-15"},
		1:    {Key: 1, Title: "Good Cop Bad Cop", AirDate: "2009-02-17"},
	}
	files := []*LocalFile{
		{Path: "/a/S01E02.mkv", Kind: "main", Episode: 1002},
		{Path: "/a/S03E01.mkv", Kind: "main", Episode: 3001},
		{Path: "/a/S00E01.mkv", Kind: "special", Episode: 1},
		{Path: "/a/S00E07.mkv", Name: "S00E07.mkv", Kind: "special", Episode: 7},
		{Path: "/a/Featurette.mkv", Name: "Featurette.mkv", Kind: "nc"},
	}
	v := &EntryView{}
	s.fillEpisodes(v, m, &catalog.ListEntry{Status: "CURRENT", Progress: 1002}, files, details)
	var keys []int
	for _, ep := range v.Episodes {
		keys = append(keys, ep.Key)
	}
	if len(keys) != 5 || keys[0] != 1001 || keys[4] != 3001 {
		t.Fatalf("episodes %v", keys)
	}
	e1, e2, e3, e4 := v.Episodes[0], v.Episodes[1], v.Episodes[2], v.Episodes[3]
	if e1.Title != "Pilot" || e1.Image != "/still.jpg" || e1.Runtime != 58 || !e1.Watched || !e1.Aired || e1.Season != 1 || e1.Number != 1 || e1.HasFile {
		t.Errorf("S01E01: %+v", e1)
	}
	if !e2.HasFile || !e2.Watched || e3.Watched || !e3.Aired || e4.Aired {
		t.Errorf("S01E02 %+v, S02E01 %+v, S02E02 %+v", e2, e3, e4)
	}
	if v.NextEpisode != e3 {
		t.Errorf("next episode %+v, want S02E01", v.NextEpisode)
	}
	if len(v.Specials) != 2 || v.Specials[0].Title != "Good Cop Bad Cop" || !v.Specials[0].HasFile || v.Specials[1].Key != 7 || v.Specials[1].Title != "S00E07.mkv" {
		t.Errorf("specials %+v", v.Specials)
	}
	if len(v.Others) != 1 || v.Others[0].File.Name != "Featurette.mkv" {
		t.Errorf("extras %+v", v.Others)
	}

	movie := testMovie(155, "The Dark Knight", 2008)
	movie.Status = "FINISHED"
	v = &EntryView{}
	s.fillEpisodes(v, movie, nil, []*LocalFile{{Path: "/m/tdk.mkv", Kind: "main", Episode: 1}}, nil)
	if len(v.Episodes) != 1 || v.Episodes[0].Key != catalog.MovieEpisode || v.Episodes[0].Title != "The Dark Knight" || !v.Episodes[0].HasFile || v.NextEpisode != v.Episodes[0] {
		t.Errorf("movie: %+v", v.Episodes)
	}
}
