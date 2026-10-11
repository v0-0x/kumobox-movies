package util

import (
	"context"
	"errors"
	"net"
	"net/url"
	"os"
	"strings"
	"syscall"
	"time"
)

// ErrPrivateAddress is returned when something tries to reach the LAN.
var ErrPrivateAddress = errors.New("connections to local/private network addresses are not allowed")

// IsPrivateIP reports loopback, private, link-local, CGNAT and similar ranges,
// also as IPv6 addresses carrying an IPv4 one (mapped, compatible, NAT64).
func IsPrivateIP(ip net.IP) bool {
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() || ip.IsMulticast() {
		return true
	}
	if v4 := ip.To4(); v4 != nil {
		// CGNAT/Tailscale 100.64.0.0/10, "this network" 0.0.0.0/8.
		return v4[0] == 100 && v4[1]&0xc0 == 64 || v4[0] == 0
	}
	if len(ip) != net.IPv6len {
		return false
	}
	switch {
	case isZero(ip[:12]):
		// IPv4-compatible ::a.b.c.d.
		return IsPrivateIP(net.IP(ip[12:16]))
	case isZero(ip[4:12]) && ip[0] == 0 && ip[1] == 0x64 && ip[2] == 0xff && ip[3] == 0x9b:
		// NAT64 64:ff9b::a.b.c.d reaches a.b.c.d.
		return IsPrivateIP(net.IP(ip[12:16]))
	case ip[0] == 0 && ip[1] == 0x64 && ip[2] == 0xff && ip[3] == 0x9b && ip[4] == 0 && ip[5] == 1:
		// The local-use NAT64 prefix 64:ff9b:1::/48 is this network's own.
		return true
	}
	return false
}

func isZero(b []byte) bool {
	for _, c := range b {
		if c != 0 {
			return false
		}
	}
	return true
}

// proxyHosts are the configured HTTP proxies (allowed even when local).
func proxyHosts() map[string]bool {
	out := map[string]bool{}
	for _, k := range []string{"HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"} {
		v := os.Getenv(k)
		if v == "" {
			continue
		}
		if !strings.Contains(v, "://") {
			v = "http://" + v
		}
		if u, err := url.Parse(v); err == nil && u.Host != "" {
			host := u.Host
			if u.Port() == "" {
				host = net.JoinHostPort(u.Hostname(), "80")
			}
			out[strings.ToLower(host)] = true
		}
	}
	return out
}

// PublicDialContext dials only public addresses (the configured HTTP proxy
// excepted), checked after DNS resolution so rebinding tricks don't work.
func PublicDialContext(timeout time.Duration) func(ctx context.Context, network, addr string) (net.Conn, error) {
	proxies := proxyHosts()
	plain := &net.Dialer{Timeout: timeout, KeepAlive: 30 * time.Second}
	guarded := &net.Dialer{
		Timeout:   timeout,
		KeepAlive: 30 * time.Second,
		Control: func(network, address string, _ syscall.RawConn) error {
			return checkDialAddress(address)
		},
	}
	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		if proxies[strings.ToLower(addr)] {
			return plain.DialContext(ctx, network, addr)
		}
		return guarded.DialContext(ctx, network, addr)
	}
}

// checkDialAddress refuses the resolved address a connection is about to
// be made to ("ip:port") when it's this computer or the LAN. An IPv6
// address may come with its interface ("[fe80::1%eth0]:80", which a URL
// can name): it's judged without it, and an address that can't be read
// is refused.
func checkDialAddress(address string) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return err
	}
	if i := strings.IndexByte(host, '%'); i >= 0 {
		host = host[:i]
	}
	ip := net.ParseIP(host)
	if ip == nil || IsPrivateIP(ip) {
		return ErrPrivateAddress
	}
	return nil
}
