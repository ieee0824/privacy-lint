package main

import (
	"net/netip"
	"testing"
)

func TestProxyConfigurationRequiresExplicitTrust(t *testing.T) {
	proxies := []netip.Prefix{netip.MustParsePrefix("127.0.0.1/32")}
	cases := []struct {
		name string
		cfg  config
		fail bool
	}{
		{"direct", config{endpoint: "http://mock.example"}, false},
		{"missing CIDRs", config{endpoint: "http://mock.example", trustProxy: true}, true},
		{"disabled trust", config{endpoint: "http://mock.example", proxies: proxies}, true},
		{"trusted proxy", config{endpoint: "http://mock.example", trustProxy: true, proxies: proxies}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := validateConfig(tc.cfg); (err != nil) != tc.fail {
				t.Fatalf("unexpected configuration error: %v", err)
			}
		})
	}
}
