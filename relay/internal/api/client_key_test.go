package api

import (
	"net/netip"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestClientKeyHonorsProxyTrustBoundary(t *testing.T) {
	proxies := []netip.Prefix{netip.MustParsePrefix("127.0.0.1/32"), netip.MustParsePrefix("10.0.0.0/8"), netip.MustParsePrefix("::1/128")}
	saved := slices.Clone(proxies)
	cases := []struct{ remote, forwarded, want string }{
		{"127.0.0.1:1234", "198.51.100.10, 203.0.113.7", "203.0.113.7"},
		{"127.0.0.1:1234", "198.51.100.11, 203.0.113.7", "203.0.113.7"},
		{"127.0.0.1:1234", "forged, 203.0.113.7, 10.1.2.3", "203.0.113.7"},
		{"203.0.113.7:1234", "198.51.100.10", "203.0.113.7"},
		{"127.0.0.1:1234", "forged", "127.0.0.1"},
		{"127.0.0.1:1234", "203.0.113.7, forged", "127.0.0.1"},
		{"127.0.0.1:1234", "", "127.0.0.1"},
		{"[::1]:1234", "2001:db8::4", "2001:db8::4"},
		{"[::ffff:203.0.113.7]:1234", "198.51.100.10", "203.0.113.7"},
	}
	for _, tc := range cases {
		if got := clientKey(tc.remote, tc.forwarded, proxies); got != tc.want {
			t.Errorf("remote=%q forwarded=%q: got %q, want %q", tc.remote, tc.forwarded, got, tc.want)
		}
	}
	if !slices.Equal(proxies, saved) {
		t.Fatal("client identification changed the trust configuration")
	}
}

func TestForwardedHeadersIgnoredWithoutTrustedPeer(t *testing.T) {
	if key := clientKey("203.0.113.7:1234", "198.51.100.10", nil); key != "203.0.113.7" {
		t.Fatalf("used untrusted XFF: %q", key)
	}
	if key := clientKey("not-an-IP", "198.51.100.10", nil); key != "unknown" {
		t.Fatalf("invalid peer should use a single fallback key: %q", key)
	}
}

func TestMultipleForwardedHeadersCannotSpoofRateKey(t *testing.T) {
	limiter := NewRateLimiter(1, time.Minute, true, netip.MustParsePrefix("127.0.0.1/32"))
	defer limiter.Close()
	for index, spoofed := range []string{"198.51.100.10", "198.51.100.11"} {
		req := rateRequest()
		req.RemoteAddr = "127.0.0.1:1234"
		req.Header.Add("X-Forwarded-For", spoofed)
		req.Header.Add("X-Forwarded-For", "203.0.113.7")
		if limiter.Allow(req) != (index == 0) {
			t.Fatalf("unexpected allowance for request %d", index)
		}
	}
	assertStoredClients(t, limiter, 1)
}

func TestParseTrustedProxies(t *testing.T) {
	proxies, err := ParseTrustedProxies(" 127.0.0.1/32, 10.1.2.3/8,::1/128 ")
	if err != nil || len(proxies) != 3 || proxies[1].String() != "10.0.0.0/8" {
		t.Fatalf("unexpected proxy configuration: %v %v", proxies, err)
	}
	if empty, err := ParseTrustedProxies(" "); err != nil || len(empty) != 0 {
		t.Fatal("empty configuration should contain no trusted peers")
	}
	for _, invalid := range []string{"127.0.0.1", "203.0.113.7/99", "secret-client.example", "127.0.0.1/32,"} {
		_, err := ParseTrustedProxies(invalid)
		if err == nil || strings.Contains(err.Error(), invalid) {
			t.Fatalf("invalid CIDR accepted or echoed: %q %v", invalid, err)
		}
	}
}

func TestLimiterCopiesTrustConfiguration(t *testing.T) {
	proxies := []netip.Prefix{netip.MustParsePrefix("127.0.0.1/32")}
	limiter := NewRateLimiter(1, time.Minute, true, proxies...)
	defer limiter.Close()
	proxies[0] = netip.MustParsePrefix("0.0.0.0/0")
	if limiter.proxies[0].String() != "127.0.0.1/32" {
		t.Fatal("limiter retained caller-owned proxy configuration")
	}
}
