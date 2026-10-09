package app

import (
	"testing"

	"github.com/v0-0x/kumobox-movies/server/internal/catalog"
	"github.com/v0-0x/kumobox-movies/server/internal/library"
)

// A file holding two episodes played to the end has both watched.
func TestLastCovered(t *testing.T) {
	// No TMDB key (newTestApp's): nothing runs in the background.
	t.Setenv("XDG_RUNTIME_DIR", t.TempDir())
	t.Setenv("LOCALAPPDATA", t.TempDir())
	a, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(a.Shutdown)
	show := catalog.ShowID(1396)
	f := &library.LocalFile{Path: "/tv/Breaking Bad/Season 01/Breaking.Bad.S01E04E05.mkv", Dir: "/tv/Breaking Bad/Season 01",
		Name: "Breaking.Bad.S01E04E05.mkv", MediaID: show, Episode: 1004, EpisodeEnd: 1005, Kind: library.KindMain}
	if err := a.Files.Save(f); err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		media, key int
		source     string
		want       int
	}{
		{show, 1004, "local", 1005},
		{show, 1005, "local", 1005},
		{show, 1004, "stream", 1004}, // a stream of the episode alone
		{show, 1006, "local", 1006},  // no file
		{155, catalog.MovieEpisode, "local", catalog.MovieEpisode},
	}
	for _, tc := range cases {
		if got := a.lastCovered(tc.media, tc.key, tc.source); got != tc.want {
			t.Errorf("lastCovered(%d, %d, %s) = %d, want %d", tc.media, tc.key, tc.source, got, tc.want)
		}
	}
}
