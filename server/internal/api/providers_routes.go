package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/v0-0x/kumobox-movies/server/internal/app"
	"github.com/v0-0x/kumobox-movies/server/internal/catalog"
	"github.com/v0-0x/kumobox-movies/server/internal/config"
	"github.com/v0-0x/kumobox-movies/server/internal/downloads"
	"github.com/v0-0x/kumobox-movies/server/internal/extensions"
	"github.com/v0-0x/kumobox-movies/server/internal/player"
	"github.com/v0-0x/kumobox-movies/server/internal/providers"
	"github.com/v0-0x/kumobox-movies/server/internal/providers/stremio"
	"github.com/v0-0x/kumobox-movies/server/internal/stream"
)

// Streaming providers: the streams of a movie or an episode from every
// provider (Internet Archive, Stremio addons, Nuvio providers, online
// streaming extensions), playing, downloading or sending one to the torrent
// client, and managing Stremio addons and Nuvio repositories (Nuvio
// providers are extensions: enabling, logs, updates and removal go through
// /api/extensions with their extension id, nuvio.<id>).
//
// Devices on the LAN may use providers but not install or remove them.

func (s *Server) providerRoutes() {
	m := s.mux
	m.HandleFunc("GET /api/providers", h(func(r *http.Request) (any, error) { return s.app.ProviderInfos(), nil }))
	m.HandleFunc("GET /api/providers/streams", h(s.providerStreams))
	m.HandleFunc("POST /api/providers/play", h(s.providerPlay))
	m.HandleFunc("POST /api/providers/download", h(s.providerDownload))
	// Extensions find titles by searching: the match can be picked by hand.
	m.HandleFunc("GET /api/providers/search", h(s.providerSearch))
	m.HandleFunc("POST /api/providers/mapping", h(s.providerMapping))

	m.HandleFunc("GET /api/providers/stremio/addons", h(func(r *http.Request) (any, error) { return s.app.Stremio.List(), nil }))
	m.HandleFunc("POST /api/providers/stremio/addons", s.installStremioAddon)
	m.HandleFunc("DELETE /api/providers/stremio/addons", h(s.uninstallStremioAddon))
	m.HandleFunc("PUT /api/providers/stremio/addons/enabled", h(s.enableStremioAddon))
	m.HandleFunc("PUT /api/providers/stremio/addons/order", h(s.orderStremioAddons))
	m.HandleFunc("POST /api/providers/stremio/refresh", h(s.refreshStremioAddons))
	m.HandleFunc("GET /api/providers/stremio/catalog", h(s.stremioCatalog))

	m.HandleFunc("GET /api/providers/nuvio/repo", h(s.nuvioRepo))
	m.HandleFunc("POST /api/providers/nuvio/repos", h(s.addNuvioRepo))
	m.HandleFunc("DELETE /api/providers/nuvio/repos", h(s.removeNuvioRepo))
	m.HandleFunc("POST /api/providers/nuvio/install", h(s.installNuvio))
	m.HandleFunc("POST /api/providers/nuvio/install-all", h(s.installNuvioRepo))
}

var errLANInstall = forbidden("providers and extensions can only be installed or removed on this computer")

// providerMedia is the movie or show of a request, and the episode asked
// for (a key; a movie's is 1).
func (s *Server) providerMedia(ctx context.Context, mediaID, episode int) (*catalog.Media, int, error) {
	if mediaID <= 0 {
		return nil, 0, badRequest("missing mediaId")
	}
	media, err := s.app.Platform.MediaLite(ctx, mediaID)
	if err != nil {
		return nil, 0, err
	}
	if !media.IsShow() {
		return media, catalog.MovieEpisode, nil
	}
	if _, e := catalog.SplitKey(episode); episode <= 0 || e <= 0 {
		return nil, 0, badRequest("missing episode (a key: season*1000 + episode)")
	}
	return media, episode, nil
}

// providerError makes a provider-side failure a 400 with its message
// (wrong provider, nothing enabled...), keeping cancellations as they are.
func providerError(err error) error {
	var ae *apiError
	if err == nil || errors.As(err, &ae) || errors.Is(err, context.Canceled) {
		return err
	}
	return badRequest(err.Error())
}

// providerStreams is GET /api/providers/streams?mediaId=&episode=&provider=
// (&refresh=1): the streams of a movie or episode, best first, with the
// providers' errors and the subtitles of subtitle addons.
func (s *Server) providerStreams(r *http.Request) (any, error) {
	q := r.URL.Query()
	media, episode, err := s.providerMedia(r.Context(), queryInt(r, "mediaId"), queryInt(r, "episode"))
	if err != nil {
		return nil, err
	}
	provider := q.Get("provider")
	if provider == "all" {
		provider = ""
	}
	res, err := s.app.Stream.Streams(r.Context(), media, episode, provider, q.Get("refresh") == "1")
	if err != nil {
		return nil, providerError(err)
	}
	if res.Streams == nil {
		res.Streams = []stream.Stream{}
	}
	return res, nil
}

type providerPlayBody struct {
	MediaID int `json:"mediaId"`
	Episode int `json:"episode"`
	// StreamID is a stream of GET /api/providers/streams; Stream the stream
	// itself (when its id is gone: links found a while ago). With neither,
	// the best direct link of Provider ("" for all) plays.
	StreamID string            `json:"streamId"`
	Stream   *providers.Stream `json:"stream"`
	Provider string            `json:"provider"`
	// Player is "builtin", "mpv" or "" (the default player).
	Player string   `json:"player"`
	Start  *float64 `json:"start"`
}

// providerPlay is POST /api/providers/play. A direct link opens in mpv or
// gives the in-app player its sources (the stream picked, then the other
// direct links as fallbacks), a torrent goes to the torrent client (into the
// library), a YouTube video or a web page comes back to be opened:
// {action: "builtin" | "mpv" | "torrent" | "external", ...}.
func (s *Server) providerPlay(r *http.Request) (any, error) {
	var body providerPlayBody
	if err := decode(r, &body); err != nil {
		return nil, err
	}
	media, episode, err := s.providerMedia(r.Context(), body.MediaID, body.Episode)
	if err != nil {
		return nil, err
	}
	st, res, err := s.pickStream(r.Context(), media, episode, body)
	if err != nil {
		return nil, providerError(err)
	}
	switch st.Kind {
	case stream.KindTorrent:
		return s.sendStreamTorrent(r.Context(), media, episode, st)
	case stream.KindYouTube:
		return map[string]any{"action": "external", "url": "https://www.youtube.com/watch?v=" + url.QueryEscape(st.YouTubeID)}, nil
	case stream.KindExternal:
		u, err := url.Parse(st.ExternalURL)
		if err != nil || (u.Scheme != "https" && u.Scheme != "http") {
			return nil, badRequest("this source has no link to open")
		}
		return map[string]any{"action": "external", "url": st.ExternalURL}, nil
	}

	cfg := s.app.Settings.Get()
	playerName := body.Player
	if playerName == "" {
		playerName = cfg.Playback.DefaultPlayer
	}
	// LAN devices can't see this computer's mpv window.
	if !isTrusted(r) {
		playerName = "builtin"
	}
	var addonSubs []providers.Subtitle
	if res != nil {
		addonSubs = res.Subtitles
	}
	title := app.EpisodeTitle(media, episode)
	if playerName == "mpv" {
		headers, referrer := splitReferrer(st.Headers)
		// mpv loads every subtitle file it's given when it starts: only a
		// few, in the preferred languages.
		subs := append(append([]providers.Subtitle(nil), st.Subtitles...), stream.SortSubtitles(addonSubs, cfg.Playback.PreferredSubLang, 4)...)
		var files []string
		for _, sub := range subs {
			files = append(files, sub.URL)
		}
		sess, err := s.app.Player.PlayMpv(player.PlayRequest{
			MediaID: media.ID, Episode: episode, Title: title, Source: "stream", Target: st.URL,
			Headers: headers, Referrer: referrer, SubFiles: files, Start: body.Start,
		})
		if err != nil {
			return nil, err
		}
		return map[string]any{"action": "mpv", "player": "mpv", "session": sess, "provider": st.Provider}, nil
	}

	// The in-app player: the stream picked first, then the other direct
	// links (its provider's first) to fall back on.
	sources := []map[string]any{playerSource(st, addonSubs, cfg)}
	if res != nil {
		var same, others []stream.Stream
		for _, x := range res.Direct() {
			switch {
			case x.ID == st.ID:
			case x.Provider == st.Provider:
				same = append(same, x)
			default:
				others = append(others, x)
			}
		}
		for _, x := range append(same, others...) {
			if len(sources) >= 10 {
				break
			}
			sources = append(sources, playerSource(x, addonSubs, cfg))
		}
	}
	// A new viewing, which may update progress again (rewatch).
	s.app.Player.ResetBuiltinProgress(media.ID, episode)
	resume := s.app.History.ResumePosition(media.ID, episode)
	if body.Start != nil {
		resume = *body.Start
	}
	return map[string]any{
		"action": "builtin", "player": "builtin", "sources": sources, "title": title, "resumeAt": resume,
		"tracks": s.app.Player.Tracks.Get(media.ID), "mediaId": media.ID, "episode": episode, "key": episode, "provider": st.Provider,
	}, nil
}

// pickStream finds the stream a play request is about.
func (s *Server) pickStream(ctx context.Context, media *catalog.Media, episode int, body providerPlayBody) (stream.Stream, *stream.Result, error) {
	if body.StreamID != "" {
		st, res, err := s.app.Stream.Find(ctx, media, episode, body.StreamID)
		if err == nil || body.Stream == nil {
			return st, res, err
		}
	}
	if body.Stream != nil {
		st := *body.Stream
		if !providers.Playable(st) {
			return stream.Stream{}, nil, badRequest("this source has nothing to play")
		}
		if st.InfoHash == "" && st.Magnet == "" {
			st.FileIdx = -1
		}
		return stream.Wrap(st), nil, nil
	}
	return s.app.Stream.Best(ctx, media, episode, body.Provider)
}

// splitReferrer takes the Referer out of a stream's headers (mpv has an
// option of its own for it).
func splitReferrer(h map[string]string) (map[string]string, string) {
	out := map[string]string{}
	referrer := ""
	for k, v := range h {
		if strings.EqualFold(k, "referer") {
			referrer = v
			continue
		}
		out[k] = v
	}
	return out, referrer
}

// playerSource is a direct link as the in-app player takes it: through the
// proxy (headers, CORS, HLS playlists rewritten), subtitles converted to
// WebVTT. Those of subtitle addons come after the stream's own, the
// preferred languages first.
func playerSource(st stream.Stream, addonSubs []providers.Subtitle, cfg config.Settings) map[string]any {
	headers := map[string]string{}
	for k, v := range st.Headers {
		headers[k] = v
	}
	_, referrer := splitReferrer(st.Headers)
	subs := []map[string]any{}
	all := append(append([]providers.Subtitle(nil), st.Subtitles...), stream.SortSubtitles(addonSubs, cfg.Playback.PreferredSubLang, 30)...)
	for i, sub := range all {
		label := sub.Label
		if label == "" {
			label = sub.Language
		}
		subs = append(subs, map[string]any{
			"url": stream.ProxyURL(sub.URL, headers) + "&fmt=vtt", "language": sub.Language, "label": label,
			"isDefault": i == 0 && len(st.Subtitles) > 0, "original": sub.URL,
		})
	}
	typ := st.Type
	if typ == providers.StreamUnknown {
		typ = "unknown"
	}
	return map[string]any{
		"id": st.ID, "url": stream.ProxyURL(st.URL, headers), "originalUrl": st.URL, "type": typ, "quality": st.Quality,
		"label": firstLine(st.Title), "server": st.ProviderName, "provider": st.Provider, "subtitles": subs,
		"headers": headers, "referrer": referrer, "notWebReady": st.NotWebReady,
	}
}

func firstLine(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return strings.TrimSpace(s[:i])
	}
	return s
}

// sendStreamTorrent hands a torrent stream to the torrent client, saved
// into the library (the movie's or show's folder).
func (s *Server) sendStreamTorrent(ctx context.Context, media *catalog.Media, episode int, st stream.Stream) (any, error) {
	magnet := st.Magnet
	if magnet == "" {
		name := firstLine(st.Title)
		if st.Filename != "" {
			name = st.Filename
		}
		magnet = providers.MagnetURI(st.InfoHash, name, nil)
	}
	if magnet == "" {
		return nil, badRequest("this torrent has no info hash")
	}
	save := s.torrentFolder(media.ID, media.PreferredTitle())
	if err := s.app.Torrents.Add(ctx, []string{magnet}, save); err != nil {
		return nil, err
	}
	what := media.PreferredTitle()
	if media.IsShow() {
		what += " " + catalog.FormatKey(episode)
	}
	s.app.Hub.Success("Sent " + what + " to the torrent client")
	return map[string]any{"action": "torrent", "savePath": save, "magnet": magnet}, nil
}

// providerDownload is POST /api/providers/download {mediaId, episodes,
// provider, quality}: queues downloads, each resolved when its turn comes
// (links expire) from the same provider in the closest quality.
func (s *Server) providerDownload(r *http.Request) (any, error) {
	var body struct {
		MediaID  int    `json:"mediaId"`
		Episodes []int  `json:"episodes"`
		Provider string `json:"provider"`
		Quality  string `json:"quality"`
	}
	if err := decode(r, &body); err != nil {
		return nil, err
	}
	if body.MediaID <= 0 {
		return nil, badRequest("missing mediaId")
	}
	media, err := s.app.Platform.MediaLite(r.Context(), body.MediaID)
	if err != nil {
		return nil, err
	}
	keys := body.Episodes
	if !media.IsShow() {
		keys = []int{catalog.MovieEpisode}
	}
	if len(keys) == 0 {
		return nil, badRequest("no episode to download")
	}
	if body.Provider != "" {
		found := false
		for _, p := range s.app.StreamProviders() {
			found = found || p.ID() == body.Provider
		}
		if !found {
			return nil, badRequest(fmt.Sprintf("streaming provider %q is not installed or is disabled", body.Provider))
		}
	}
	items := []*downloads.Item{}
	for _, key := range keys {
		if _, e := catalog.SplitKey(key); key <= 0 || e <= 0 {
			return nil, badRequest(fmt.Sprintf("invalid episode %d", key))
		}
		it, err := s.app.Downloads.Enqueue(downloads.Item{
			MediaID: media.ID, Episode: key, AnimeTitle: app.DownloadTitle(media), Image: media.CoverImage.Large,
			Source: "stream", Provider: body.Provider, Quality: body.Quality,
		})
		if err != nil {
			return nil, err
		}
		items = append(items, it)
	}
	if len(items) == 1 {
		s.app.Hub.Info("Queued " + app.EpisodeTitle(media, items[0].Episode))
	} else {
		s.app.Hub.Info(fmt.Sprintf("Queued %d downloads", len(items)))
	}
	return items, nil
}

// providerSearch is GET /api/providers/search?provider=&q=&mediaId=: an
// extension's titles, to pick the right match by hand.
func (s *Server) providerSearch(r *http.Request) (any, error) {
	q := r.URL.Query()
	m, err := s.app.Stream.Matcher(q.Get("provider"))
	if err != nil {
		return nil, badRequest(err.Error())
	}
	if strings.TrimSpace(q.Get("q")) == "" {
		return nil, badRequest("type something to search")
	}
	res, err := m.SearchTitles(r.Context(), q.Get("q"), queryInt(r, "mediaId"))
	if err != nil {
		return nil, providerError(err)
	}
	if res == nil {
		res = []stream.SearchResult{}
	}
	return res, nil
}

// providerMapping is POST /api/providers/mapping {provider, mediaId, id,
// title}: an extension uses that title for the movie or show from now on.
func (s *Server) providerMapping(r *http.Request) (any, error) {
	var body struct {
		Provider string `json:"provider"`
		MediaID  int    `json:"mediaId"`
		ID       string `json:"id"`
		Title    string `json:"title"`
	}
	if err := decode(r, &body); err != nil {
		return nil, err
	}
	if body.MediaID <= 0 {
		return nil, badRequest("missing mediaId")
	}
	return nil, providerError(s.app.Stream.SetMatch(body.Provider, body.MediaID, body.ID, body.Title))
}

// ---------------------------------------------------------------------------
// Stremio addons

// installStremioAddon is POST /api/providers/stremio/addons {url,
// allowLocal, allowAdult}. Addons that need a confirmation or can't be
// installed answer 409 {error, code: "local" | "adult" | "configure" |
// "unsupported", configureUrl}.
func (s *Server) installStremioAddon(w http.ResponseWriter, r *http.Request) {
	out, err := s.doInstallStremioAddon(r)
	var ce *conflictError
	if errors.As(err, &ce) {
		body := map[string]any{"error": ce.msg, "code": ce.code}
		if ce.configureURL != "" {
			body["configureUrl"] = ce.configureURL
		}
		writeJSON(w, http.StatusConflict, body)
		return
	}
	h(func(*http.Request) (any, error) { return out, err })(w, r)
}

func (s *Server) doInstallStremioAddon(r *http.Request) (any, error) {
	if !isTrusted(r) {
		return nil, errLANInstall
	}
	var body struct {
		URL string `json:"url"`
		stremio.InstallOptions
	}
	if err := decode(r, &body); err != nil {
		return nil, err
	}
	a, err := s.app.Stremio.Install(r.Context(), body.URL, body.InstallOptions)
	var cfgErr *stremio.ConfigurationError
	switch {
	case err == nil:
		s.app.Hub.Success("Installed " + a.Manifest.Name)
		return a, nil
	case errors.Is(err, stremio.ErrLocalAddon):
		return nil, conflict(err, "local", "")
	case errors.Is(err, stremio.ErrAdultAddon):
		return nil, conflict(err, "adult", "")
	case errors.As(err, &cfgErr):
		return nil, conflict(err, "configure", cfgErr.ConfigureURL)
	case errors.Is(err, stremio.ErrUnsupportedAddon):
		return nil, conflict(err, "unsupported", "")
	}
	return nil, badRequest(err.Error())
}

// conflictError is a 409 with a code telling the UI what to ask.
type conflictError struct {
	msg, code, configureURL string
}

func (e *conflictError) Error() string { return e.msg }

func conflict(err error, code, configureURL string) error {
	return &conflictError{msg: err.Error(), code: code, configureURL: configureURL}
}

func (s *Server) uninstallStremioAddon(r *http.Request) (any, error) {
	if !isTrusted(r) {
		return nil, errLANInstall
	}
	key := r.URL.Query().Get("key")
	if err := s.app.Stremio.Uninstall(key); err != nil {
		if errors.Is(err, stremio.ErrNotInstalled) {
			return nil, notFound(err.Error())
		}
		return nil, err
	}
	return nil, nil
}

func (s *Server) enableStremioAddon(r *http.Request) (any, error) {
	var body struct {
		Key     string `json:"key"`
		Enabled bool   `json:"enabled"`
	}
	if err := decode(r, &body); err != nil {
		return nil, err
	}
	if err := s.app.Stremio.SetEnabled(body.Key, body.Enabled); err != nil {
		if errors.Is(err, stremio.ErrNotInstalled) {
			return nil, notFound(err.Error())
		}
		return nil, err
	}
	return s.app.Stremio.List(), nil
}

func (s *Server) orderStremioAddons(r *http.Request) (any, error) {
	var body struct {
		Keys []string `json:"keys"`
	}
	if err := decode(r, &body); err != nil {
		return nil, err
	}
	if err := s.app.Stremio.Reorder(body.Keys); err != nil {
		return nil, err
	}
	return s.app.Stremio.List(), nil
}

// refreshStremioAddons downloads the addons' manifests again; the ones that
// couldn't be reached keep theirs: {addons, errors: {transportUrl: error}}.
func (s *Server) refreshStremioAddons(r *http.Request) (any, error) {
	errs := map[string]string{}
	for u, err := range s.app.Stremio.Refresh(r.Context()) {
		errs[u] = err.Error()
	}
	return map[string]any{"addons": s.app.Stremio.List(), "errors": errs}, nil
}

// stremioCatalog is GET /api/providers/stremio/catalog?url=(&refresh=1): an
// addon collection (the first of Settings › Providers by default), the
// installed addons marked: {url, catalogs, addons}.
func (s *Server) stremioCatalog(r *http.Request) (any, error) {
	catalogs := s.app.Settings.Get().Providers.StremioCatalogs
	u := strings.TrimSpace(r.URL.Query().Get("url"))
	if u == "" && len(catalogs) > 0 {
		u = catalogs[0]
	}
	if u == "" {
		u = config.DefaultStremioCatalog
	}
	list, err := s.app.StremioCollection(r.Context(), u, r.URL.Query().Get("refresh") == "1")
	if err != nil {
		return nil, badRequest(err.Error())
	}
	if list == nil {
		list = []stremio.Addon{}
	}
	return map[string]any{"url": u, "catalogs": catalogs, "addons": list}, nil
}

// ---------------------------------------------------------------------------
// Nuvio repositories

func (s *Server) nuvioRepo(r *http.Request) (any, error) {
	repo, err := s.app.Extensions.NuvioRepo(r.Context(), r.URL.Query().Get("url"))
	if err != nil {
		return nil, badRequest(err.Error())
	}
	return repo, nil
}

// addNuvioRepo is POST /api/providers/nuvio/repos {url}: checks the
// repository and keeps it in Settings › Providers.
func (s *Server) addNuvioRepo(r *http.Request) (any, error) {
	var body struct {
		URL string `json:"url"`
	}
	if err := decode(r, &body); err != nil {
		return nil, err
	}
	repo, err := s.app.Extensions.NuvioRepo(r.Context(), body.URL)
	if err != nil {
		return nil, badRequest(err.Error())
	}
	if err := s.keepNuvioRepo(repo.URL); err != nil {
		return nil, err
	}
	return repo, nil
}

func (s *Server) removeNuvioRepo(r *http.Request) (any, error) {
	u := strings.TrimSpace(r.URL.Query().Get("url"))
	cfg := s.app.Settings.Get()
	repos := []string{}
	for _, x := range cfg.Providers.NuvioRepos {
		if x != u {
			repos = append(repos, x)
		}
	}
	cfg.Providers.NuvioRepos = repos
	_, err := s.app.Settings.Save(cfg)
	return nil, err
}

// keepNuvioRepo adds a repository to the settings (once).
func (s *Server) keepNuvioRepo(u string) error {
	cfg := s.app.Settings.Get()
	for _, x := range cfg.Providers.NuvioRepos {
		if x == u {
			return nil
		}
	}
	// A copy: the settings' slices are shared with the ones in memory.
	cfg.Providers.NuvioRepos = append(append([]string(nil), cfg.Providers.NuvioRepos...), u)
	_, err := s.app.Settings.Save(cfg)
	return err
}

func (s *Server) installNuvio(r *http.Request) (any, error) {
	if !isTrusted(r) {
		return nil, errLANInstall
	}
	var body struct {
		Repo string `json:"repo"`
		ID   string `json:"id"`
	}
	if err := decode(r, &body); err != nil {
		return nil, err
	}
	info, err := s.app.Extensions.InstallNuvio(r.Context(), body.Repo, body.ID)
	if err != nil {
		return nil, badRequest(err.Error())
	}
	if err := s.keepNuvioRepo(strings.TrimSpace(body.Repo)); err != nil {
		return nil, err
	}
	s.app.Stream.Invalidate()
	s.app.Hub.Success("Installed " + info.Manifest.Name)
	return info, nil
}

// installNuvioRepo installs every provider a repository enables by default
// (and updates the installed ones): {installed, errors}.
func (s *Server) installNuvioRepo(r *http.Request) (any, error) {
	if !isTrusted(r) {
		return nil, errLANInstall
	}
	var body struct {
		Repo string `json:"repo"`
	}
	if err := decode(r, &body); err != nil {
		return nil, err
	}
	installed, err := s.app.Extensions.InstallNuvioRepo(r.Context(), body.Repo)
	if installed == nil {
		installed = []extensions.Info{}
	}
	if err != nil && len(installed) == 0 {
		return nil, badRequest(err.Error())
	}
	if err := s.keepNuvioRepo(strings.TrimSpace(body.Repo)); err != nil {
		return nil, err
	}
	s.app.Stream.Invalidate()
	errs := []string{}
	if err != nil {
		errs = strings.Split(err.Error(), "\n")
	}
	s.app.Hub.Success(fmt.Sprintf("Installed %d provider(s)", len(installed)))
	return map[string]any{"installed": installed, "errors": errs}, nil
}

// uninstallExtension is DELETE /api/extensions/{id} (Nuvio providers too).
func (s *Server) uninstallExtension(r *http.Request) (any, error) {
	if !isTrusted(r) {
		return nil, errLANInstall
	}
	if err := s.app.Extensions.Uninstall(r.PathValue("id")); err != nil {
		return nil, err
	}
	s.app.Stream.Invalidate()
	return nil, nil
}
