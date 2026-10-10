package stream

import (
	"context"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/v0-0x/kumobox-movies/server/internal/util"
)

// Online streams in the in-app player
//
// Providers mostly link to files browsers can't play as they are: Matroska,
// HEVC video, AC-3/DTS/TrueHD audio. The in-app player converts those like
// library files (remux or transcode with ffmpeg, see local.go and hls.go),
// with the stream's link as ffmpeg's input instead of a file.
//
// ffmpeg doesn't fetch the link itself: the player is handed a "remote:"
// path naming the link (RegisterRemote), and ffmpeg reads it from a relay
// on this computer's loopback address, which fetches it with the stream
// proxy's client (its headers, byte ranges for seeking, and above all the
// same refusal to reach this computer or the LAN, redirects included).

// RemotePrefix starts the paths of online streams.
const RemotePrefix = "remote:"

// IsRemoteInput reports whether path names an online stream.
func IsRemoteInput(path string) bool { return strings.HasPrefix(path, RemotePrefix) }

const (
	remoteKeep = 12 * time.Hour // a link unused this long is forgotten
	remoteMax  = 256
)

type remoteSource struct {
	url     string
	headers map[string]string
	used    time.Time
}

var remotes = struct {
	sync.Mutex
	m map[string]*remoteSource
}{m: map[string]*remoteSource{}}

// RegisterRemote names a stream's link (and the headers it needs) for the
// in-app player's conversion endpoints: the "remote:" path it returns is
// as good as a library file's path there. The name is unguessable, so
// nobody can have KumoBox fetch other links through it.
func RegisterRemote(link string, headers map[string]string) string {
	remotes.Lock()
	defer remotes.Unlock()
	now := time.Now()
	for id, s := range remotes.m {
		if s.url == link && sameHeaders(s.headers, headers) {
			s.used = now
			return RemotePrefix + id
		}
	}
	// Forget the stale links, then the least recently used ones.
	for id, s := range remotes.m {
		if now.Sub(s.used) > remoteKeep {
			delete(remotes.m, id)
		}
	}
	for len(remotes.m) >= remoteMax {
		var oldest string
		for id, s := range remotes.m {
			if oldest == "" || s.used.Before(remotes.m[oldest].used) {
				oldest = id
			}
		}
		delete(remotes.m, oldest)
	}
	h := make(map[string]string, len(headers))
	for k, v := range headers {
		h[k] = v
	}
	id := newSessionID()
	remotes.m[id] = &remoteSource{url: link, headers: h, used: now}
	return RemotePrefix + id
}

func sameHeaders(a, b map[string]string) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if b[k] != v {
			return false
		}
	}
	return true
}

func remoteSourceOf(path string) (*remoteSource, string, bool) {
	id := strings.TrimPrefix(path, RemotePrefix)
	remotes.Lock()
	defer remotes.Unlock()
	s, ok := remotes.m[id]
	if !ok {
		return nil, "", false
	}
	s.used = time.Now()
	return s, id, true
}

// ErrRemoteGone: the player asked for a stream KumoBox no longer knows
// (forgotten, or KumoBox restarted): it asks the provider again.
var ErrRemoteGone = errors.New("this stream has expired, play it again")

// remoteInput is the relay URL ffmpeg reads an online stream from.
func remoteInput(path string) (string, error) {
	_, id, ok := remoteSourceOf(path)
	if !ok {
		return "", ErrRemoteGone
	}
	addr, err := startRelay()
	if err != nil {
		return "", err
	}
	return "http://" + addr + "/r/" + id, nil
}

var relay struct {
	once sync.Once
	addr string
	err  error
}

// startRelay starts the relay once, on a free port of the loopback address.
func startRelay() (string, error) {
	relay.once.Do(func() {
		ln, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			relay.err = err
			return
		}
		relay.addr = ln.Addr().String()
		srv := &http.Server{Handler: http.HandlerFunc(serveRelay), ReadHeaderTimeout: 10 * time.Second}
		go func() {
			if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
				log.Printf("stream relay: %v", err)
			}
		}()
	})
	return relay.addr, relay.err
}

// serveRelay passes one request of ffmpeg (a GET, maybe of a byte range) on
// to the stream's link.
func serveRelay(w http.ResponseWriter, r *http.Request) {
	id, ok := strings.CutPrefix(r.URL.Path, "/r/")
	if !ok || (r.Method != http.MethodGet && r.Method != http.MethodHead) {
		http.NotFound(w, r)
		return
	}
	src, _, ok := remoteSourceOf(RemotePrefix + id)
	if !ok {
		http.NotFound(w, r)
		return
	}
	resp, err := fetchRemote(r.Context(), r.Method, src, r.Header.Get("Range"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	for _, k := range []string{"Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "Last-Modified", "ETag"} {
		if v := resp.Header.Get(k); v != "" {
			w.Header().Set(k, v)
		}
	}
	w.WriteHeader(resp.StatusCode)
	if r.Method == http.MethodGet {
		_, _ = io.Copy(w, resp.Body)
	}
}

// fetchRemote requests a stream's link the way the stream proxy does.
func fetchRemote(ctx context.Context, method string, src *remoteSource, rng string) (*http.Response, error) {
	u, err := url.Parse(src.url)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return nil, errors.New("not a web link")
	}
	local := allowedLocal(u)
	if strings.EqualFold(u.Hostname(), "localhost") && !local {
		return nil, errors.New("forbidden")
	}
	req, err := http.NewRequestWithContext(ctx, method, src.url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", util.UserAgent)
	for k, v := range src.headers {
		req.Header.Set(k, v)
	}
	if rng != "" {
		req.Header.Set("Range", rng)
	}
	client := proxyClient
	if local {
		client = localProxyClient
	}
	return client.Do(req)
}
