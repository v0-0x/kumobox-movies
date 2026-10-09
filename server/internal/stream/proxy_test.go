package stream

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestSafeContentType(t *testing.T) {
	for in, want := range map[string]string{
		"video/mp4":                     "video/mp4",
		"application/vnd.apple.mpegurl": "application/vnd.apple.mpegurl",
		"image/jpeg":                    "image/jpeg",
		"text/vtt; charset=utf-8":       "text/vtt; charset=utf-8",
		"text/html; charset=utf-8":      "application/octet-stream",
		"image/svg+xml":                 "application/octet-stream",
		"application/xhtml+xml":         "application/octet-stream",
		"text/xml":                      "application/octet-stream",
		"application/javascript":        "application/octet-stream",
		"":                              "application/octet-stream",
		"application/x-shockwave-flash": "application/octet-stream",
		"video/mp2t":                    "video/mp2t",
		"application/octet-stream":      "application/octet-stream",
	} {
		if got := SafeContentType(in); got != want {
			t.Errorf("SafeContentType(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestRewritePlaylist(t *testing.T) {
	base, _ := url.Parse("https://cdn.example.com/hls/ep7/index.m3u8")
	in := "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin\"\n#EXTINF:4.0,\nseg-1.ts\n\n#EXTINF:4.0,\nhttps://other.example.com/seg-2.ts\n"
	out := string(rewritePlaylist([]byte(in), base, map[string]string{"Referer": "https://site.example/"}))
	for _, want := range []string{
		"URI=\"" + ProxyURL("https://cdn.example.com/hls/ep7/key.bin", map[string]string{"Referer": "https://site.example/"}) + "\"",
		ProxyURL("https://cdn.example.com/hls/ep7/seg-1.ts", map[string]string{"Referer": "https://site.example/"}),
		ProxyURL("https://other.example.com/seg-2.ts", map[string]string{"Referer": "https://site.example/"}),
	} {
		if !strings.Contains(out, want) {
			t.Errorf("rewritten playlist lacks %q:\n%s", want, out)
		}
	}
}

// The proxy refuses this computer and the LAN, except the addresses of
// the addons installed as local ones (LocalHosts), and doesn't follow a
// redirect from those to another local address.
func TestProxyLocalHosts(t *testing.T) {
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("elsewhere"))
	}))
	defer other.Close()
	addon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/away" {
			http.Redirect(w, r, other.URL+"/x", http.StatusFound)
			return
		}
		_, _ = w.Write([]byte("video bytes"))
	}))
	defer addon.Close()
	get := func(target string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		ServeProxy(w, httptest.NewRequest("GET", ProxyURL(target, nil), nil))
		return w
	}
	defer func(old func() []string) { LocalHosts = old }(LocalHosts)

	LocalHosts = nil
	if w := get(addon.URL + "/stream.mp4"); w.Code == http.StatusOK {
		t.Fatalf("a local address without permission: %d %q", w.Code, w.Body.String())
	}
	u, _ := url.Parse(addon.URL)
	LocalHosts = func() []string { return []string{HostKey(u)} }
	if w := get(addon.URL + "/stream.mp4"); w.Code != http.StatusOK || w.Body.String() != "video bytes" {
		t.Fatalf("the local addon: %d %q", w.Code, w.Body.String())
	}
	if w := get(other.URL + "/x"); w.Code == http.StatusOK {
		t.Fatalf("another local address: %d", w.Code)
	}
	if w := get(addon.URL + "/away"); w.Code == http.StatusOK {
		t.Fatalf("redirected to another local address: %d %q", w.Code, w.Body.String())
	}
	if HostKey(&url.URL{Scheme: "https", Host: "Box.LAN"}) != "box.lan:443" || HostKey(&url.URL{Scheme: "http", Host: "[::1]:7000"}) != "[::1]:7000" {
		t.Error("HostKey")
	}
}
