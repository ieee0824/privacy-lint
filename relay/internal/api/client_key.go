package api

import (
	"errors"
	"net"
	"net/netip"
	"strings"
)

// ParseTrustedProxies accepts explicit CIDRs; it never treats every peer as
// trusted merely because X-Forwarded-For is enabled.
func ParseTrustedProxies(value string) ([]netip.Prefix, error) {
	if strings.TrimSpace(value) == "" {
		return nil, nil
	}
	proxies := []netip.Prefix{}
	for _, entry := range strings.Split(value, ",") {
		prefix, err := netip.ParsePrefix(strings.TrimSpace(entry))
		if err != nil {
			return nil, errors.New("trusted proxies must be a comma-separated list of IP CIDRs")
		}
		proxies = append(proxies, prefix.Masked())
	}
	return proxies, nil
}

func clientKey(remoteAddr, forwarded string, proxies []netip.Prefix) string {
	remote, err := peerAddress(remoteAddr)
	if err != nil {
		return "unknown"
	}
	if forwarded == "" || !trustedAddress(remote, proxies) {
		return remote.String()
	}
	return forwardedClient(remote, strings.Split(forwarded, ","), proxies).String()
}

func peerAddress(remote string) (netip.Addr, error) {
	host, _, err := net.SplitHostPort(remote)
	if err != nil {
		host = remote
	}
	addr, err := netip.ParseAddr(host)
	return addr.Unmap(), err
}

// Walk from the connected peer toward the client and stop at the first hop
// outside the configured proxy ranges. Earlier values are client-controlled.
func forwardedClient(remote netip.Addr, hops []string, proxies []netip.Prefix) netip.Addr {
	client := remote
	for i := len(hops) - 1; i >= 0; i-- {
		if !trustedAddress(client, proxies) {
			return client
		}
		addr, err := netip.ParseAddr(strings.TrimSpace(hops[i]))
		if err != nil {
			return remote
		}
		client = addr.Unmap()
	}
	return client
}

func trustedAddress(addr netip.Addr, proxies []netip.Prefix) bool {
	for _, prefix := range proxies {
		if prefix.Contains(addr) {
			return true
		}
	}
	return false
}
