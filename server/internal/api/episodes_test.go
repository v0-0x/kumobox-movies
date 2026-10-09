package api

import (
	"sort"
	"testing"

	"github.com/v0-0x/kumobox-movies/server/internal/catalog"
)

func TestMarkedProgress(t *testing.T) {
	show := func(status string, seasons ...int) *catalog.Media {
		m := &catalog.Media{ID: catalog.ShowID(1), Type: catalog.TypeTV, Status: status}
		for i, n := range seasons {
			m.Seasons = append(m.Seasons, catalog.Season{Number: i + 1, EpisodeCount: n})
		}
		return m
	}
	ended := show("FINISHED", 12)
	long := show("FINISHED", 10, 15)
	airing := show("RELEASING", 12, 4)
	unknown := show("RELEASING")
	movie := &catalog.Media{ID: 155, Type: catalog.TypeMovie, Status: "FINISHED"}
	for _, c := range []struct {
		name             string
		media            *catalog.Media
		status           string
		progress, repeat int
		ep               int
		watched          bool
		wantProg         int
		wantStatus       string
		wantRepeat       int
	}{
		{"not in list", ended, "", 0, 0, 1003, true, 1003, "CURRENT", 0},
		{"planned", ended, "PLANNING", 0, 0, 1001, true, 1001, "CURRENT", 0},
		{"never lowers when marking watched", long, "CURRENT", 1009, 0, 1001, true, 1009, "CURRENT", 0},
		{"never raises when marking unwatched", long, "CURRENT", 1003, 0, 1007, false, 1003, "CURRENT", 0},
		{"unwatch", long, "CURRENT", 1009, 0, 1009, false, 1008, "CURRENT", 0},
		{"unwatch an earlier one", long, "CURRENT", 1009, 0, 1004, false, 1003, "CURRENT", 0},
		{"unwatch the first of a season", long, "CURRENT", 2003, 0, 2001, false, 1010, "CURRENT", 0},
		{"finish", ended, "CURRENT", 1011, 0, 1012, true, 1012, "COMPLETED", 0},
		{"finish a rewatch", ended, "REPEATING", 1005, 1, 1012, true, 1012, "COMPLETED", 2},
		{"rewatch keeps repeating", ended, "REPEATING", 1005, 1, 1007, true, 1007, "REPEATING", 1},
		{"reopen a completed show", ended, "COMPLETED", 1012, 0, 1012, false, 1011, "CURRENT", 0},
		{"completed: already watched", ended, "COMPLETED", 1012, 0, 1003, true, 1012, "COMPLETED", 0},
		{"a show on the air never completes", airing, "CURRENT", 2003, 0, 2004, true, 2004, "CURRENT", 0},
		{"episodes unknown", unknown, "CURRENT", 1004, 0, 1006, true, 1006, "CURRENT", 0},
		{"paused resumes", long, "PAUSED", 1004, 0, 1005, true, 1005, "CURRENT", 0},
		{"movie watched", movie, "PLANNING", 0, 0, 1, true, 1, "COMPLETED", 0},
		{"movie unwatched", movie, "COMPLETED", 1, 0, 1, false, 0, "CURRENT", 0},
	} {
		p, st, r := markedProgress(c.status, c.progress, c.repeat, c.media, c.ep, c.watched)
		if p != c.wantProg || st != c.wantStatus || r != c.wantRepeat {
			t.Errorf("%s: got progress=%d status=%s repeat=%d, want %d %s %d", c.name, p, st, r, c.wantProg, c.wantStatus, c.wantRepeat)
		}
	}
}

func TestNaturalLess(t *testing.T) {
	names := []string{"Show - 10.mkv", "Show - 2.mkv", "Show - 1.mkv", "Show - 1v2.mkv", "Extras.mkv"}
	sort.SliceStable(names, func(i, j int) bool { return naturalLess(names[i], names[j]) })
	want := []string{"Extras.mkv", "Show - 1.mkv", "Show - 1v2.mkv", "Show - 2.mkv", "Show - 10.mkv"}
	for i := range want {
		if names[i] != want[i] {
			t.Fatalf("got %q", names)
		}
	}
}
