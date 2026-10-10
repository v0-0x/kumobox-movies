package stream

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"
)

// An online stream the browser can't play as it is (a Matroska file here)
// is probed and converted like a library file, read through the relay;
// the relay sends the stream's headers and byte ranges, and refuses this
// computer and the LAN unless the address is a local addon's.
func TestRemoteStreamConverts(t *testing.T) {
	l, video := newFfmpegLocal(t, "libx264")
	data, err := os.ReadFile(video)
	if err != nil {
		t.Fatal(err)
	}
	var sawHeader, sawRange bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Referer") == "https://site.example/" {
			sawHeader = true
		}
		if r.Header.Get("Range") != "" {
			sawRange = true
		}
		http.ServeContent(w, r, "movie.mkv", time.Time{}, bytes.NewReader(data))
	}))
	defer srv.Close()
	defer func(old func() []string) { LocalHosts = old }(LocalHosts)

	path := RegisterRemote(srv.URL+"/movie.mkv", map[string]string{"Referer": "https://site.example/"})
	if !IsRemoteInput(path) || RegisterRemote(srv.URL+"/movie.mkv", map[string]string{"Referer": "https://site.example/"}) != path {
		t.Fatalf("path %q: not one name per link", path)
	}

	// The test server is on this computer: refused, like the LAN.
	LocalHosts = nil
	if _, err := l.Probe(context.Background(), path); err == nil {
		t.Fatal("probed a link on this computer")
	}

	u, _ := url.Parse(srv.URL)
	LocalHosts = func() []string { return []string{HostKey(u)} }
	p, err := l.Probe(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Video) != 1 || len(p.Audio) != 1 || p.Duration < 29 || p.Path != path {
		t.Fatalf("probe: %+v", p)
	}
	if !sawHeader || !sawRange {
		t.Errorf("headers sent: %v, ranges asked: %v", sawHeader, sawRange)
	}

	// Remuxed to fragmented MP4 from 10 seconds in.
	start, err := l.SeekPoint(context.Background(), path, 10, 0, "remux", DefaultCaps, false)
	if err != nil || start <= 0 || start > 10 {
		t.Fatalf("seek point %v, %v", start, err)
	}
	w := httptest.NewRecorder()
	l.ServeTranscode(w, httptest.NewRequest("GET", "/api/local/transcode", nil), path, start, 0, "remux", DefaultCaps)
	if w.Code != http.StatusOK || !bytes.Contains(w.Body.Bytes()[:min(64, w.Body.Len())], []byte("ftyp")) {
		t.Fatalf("transcode: %d, %d bytes", w.Code, w.Body.Len())
	}
	if d := probeDuration(t, w.Body.Bytes()); d < 15 || d > 21 {
		t.Errorf("converted from %vs: %vs long, want about 20", start, d)
	}

	// Subtitles would need the whole file; the file itself isn't served.
	w = httptest.NewRecorder()
	l.ServeSubtitle(w, httptest.NewRequest("GET", "/", nil), path, 0, "")
	if w.Code != http.StatusUnprocessableEntity {
		t.Errorf("subtitle: %d", w.Code)
	}
	w = httptest.NewRecorder()
	l.ServeFile(w, httptest.NewRequest("GET", "/", nil), path)
	if w.Code != http.StatusBadRequest {
		t.Errorf("file: %d", w.Code)
	}

	// A name KumoBox doesn't know.
	if _, err := l.Probe(context.Background(), RemotePrefix+"0123456789abcdef01234567"); err != ErrRemoteGone {
		t.Errorf("unknown name: %v", err)
	}
}

// The relay only answers for the links named, and passes the status and
// range headers on.
func TestRelay(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.ServeContent(w, r, "x.bin", time.Time{}, strings.NewReader("0123456789"))
	}))
	defer srv.Close()
	defer func(old func() []string) { LocalHosts = old }(LocalHosts)
	u, _ := url.Parse(srv.URL)
	LocalHosts = func() []string { return []string{HostKey(u)} }

	input, err := remoteInput(RegisterRemote(srv.URL+"/x.bin", nil))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(input, "http://127.0.0.1:") {
		t.Fatalf("relay %q isn't on the loopback address", input)
	}
	req, _ := http.NewRequest("GET", input, nil)
	req.Header.Set("Range", "bytes=2-4")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var b bytes.Buffer
	_, _ = b.ReadFrom(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusPartialContent || b.String() != "234" || resp.Header.Get("Content-Range") != "bytes 2-4/10" {
		t.Fatalf("range: %d %q %q", resp.StatusCode, b.String(), resp.Header.Get("Content-Range"))
	}
	resp, err = http.Get(strings.TrimSuffix(input, input[strings.LastIndexByte(input, '/')+1:]) + "nope")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("unknown name: %d", resp.StatusCode)
	}
}
