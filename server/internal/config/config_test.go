package config

import (
	"path/filepath"
	"testing"

	"github.com/v0-0x/kumobox-movies/server/internal/db"
)

func openTestDB(t *testing.T) *db.DB {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "kumobox.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	return d
}

// A first launch saves the defaults, at the current schema version.
func TestFirstLaunchSavesDefaults(t *testing.T) {
	d := openTestDB(t)
	s, err := NewStore(d)
	if err != nil {
		t.Fatal(err)
	}
	var saved Settings
	if ok, err := d.GetKV(settingsKey, &saved); !ok || err != nil {
		t.Fatalf("defaults not saved (%v)", err)
	}
	if saved.SchemaVersion != schemaVersion || s.Get().SchemaVersion != schemaVersion {
		t.Fatalf("schema version %d / %d, want %d", saved.SchemaVersion, s.Get().SchemaVersion, schemaVersion)
	}
	got := s.Get()
	if got.Playback.DefaultPlayer != "builtin" || got.OnlineStream.DefaultProvider != "archive" || got.Downloads.Downloader != "auto" {
		t.Fatalf("defaults: player %q, provider %q, downloader %q", got.Playback.DefaultPlayer, got.OnlineStream.DefaultProvider, got.Downloads.Downloader)
	}
	if got.TMDB.Language != "en-US" || got.TMDB.Region != "US" || got.TMDB.APIKey != "" {
		t.Fatalf("TMDB defaults: %+v", got.TMDB)
	}
	// Original audio, subtitles for foreign languages, nothing skipped.
	if p := got.Playback; p.PreferredAudioLang != "" || p.PreferredSubLang != "" || !p.SubtitlesForForeign || p.SkipIntro || p.SkipCredits {
		t.Fatalf("playback defaults: %+v", p)
	}
}

// Settings saved without some fields (by an older version, or edited by
// hand) get the defaults for them; the saved values stay.
func TestSavedSettingsKeepTheirValues(t *testing.T) {
	d := openTestDB(t)
	if err := d.SetKV(settingsKey, map[string]any{
		"schemaVersion": 1,
		"library":       map[string]any{"dir": "/mnt/big/Movies"},
		"playback":      map[string]any{"defaultPlayer": "mpv"},
		"tmdb":          map[string]any{"apiKey": "  0123456789abcdef  ", "region": "fr"},
		"letterboxd":    map[string]any{"username": "@dave/", "syncMinutes": 1},
		"downloads":     map[string]any{"dir": "/mnt/big/Downloads", "downloader": "aria2c"},
		"torrent":       map[string]any{"defaultProvider": "nyaa"}, // Kumo's
	}); err != nil {
		t.Fatal(err)
	}
	s, err := NewStore(d)
	if err != nil {
		t.Fatal(err)
	}
	got := s.Get()
	for _, c := range []struct{ name, got, want string }{
		{"library", got.Library.Dir, "/mnt/big/Movies"},
		{"player", got.Playback.DefaultPlayer, "mpv"},
		{"api key", got.TMDB.APIKey, "0123456789abcdef"},
		{"region", got.TMDB.Region, "FR"},
		{"language", got.TMDB.Language, "en-US"},
		{"letterboxd", got.Letterboxd.Username, "dave"},
		{"download dir", got.Downloads.Dir, "/mnt/big/Downloads"},
		{"downloader", got.Downloads.Downloader, "auto"},
		{"provider", got.OnlineStream.DefaultProvider, "archive"},
		{"torrent source", got.Torrent.DefaultProvider, "all"},
	} {
		if c.got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, c.got, c.want)
		}
	}
	if got.Letterboxd.SyncMinutes != Defaults().Letterboxd.SyncMinutes {
		t.Errorf("sync every %d minutes, want the default", got.Letterboxd.SyncMinutes)
	}
	// Changed afterwards, it sticks.
	got.Playback.DefaultPlayer = "builtin"
	if _, err := s.Save(got); err != nil {
		t.Fatal(err)
	}
	s2, err := NewStore(d)
	if err != nil {
		t.Fatal(err)
	}
	if s2.Get().Playback.DefaultPlayer != "builtin" {
		t.Fatalf("player lost after restart: %q", s2.Get().Playback.DefaultPlayer)
	}
}

// Get hands out copies: changing one never changes the live settings.
func TestGetReturnsCopies(t *testing.T) {
	s, err := NewStore(openTestDB(t))
	if err != nil {
		t.Fatal(err)
	}
	cur := s.Get()
	cur.TorrentSources.Torznab = []TorznabIndexer{{Name: "Prowlarr", APIKey: "secret"}}
	cur.Providers.NuvioRepos = []string{"https://example.com/manifest.json"}
	if _, err := s.Save(cur); err != nil {
		t.Fatal(err)
	}
	c := s.Get()
	c.Library.IgnorePatterns[0] = "changed"
	c.UI.HomeSections[0] = "changed"
	c.Providers.StremioCatalogs[0] = "changed"
	c.Providers.NuvioRepos[0] = "changed"
	c.TorrentSources.Torznab[0].APIKey = "changed"
	got := s.Get()
	if got.Library.IgnorePatterns[0] == "changed" || got.UI.HomeSections[0] == "changed" || got.Providers.StremioCatalogs[0] == "changed" ||
		got.Providers.NuvioRepos[0] == "changed" || got.TorrentSources.Torznab[0].APIKey == "changed" {
		t.Fatal("a copy shares its slices with the live settings")
	}
}
