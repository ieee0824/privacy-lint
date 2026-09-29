package api

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// RateLimiter is a fixed-window limiter keyed by client address.
// Addresses exist only in memory for the current window and are never logged
// or persisted (DESIGN.md §22: no IP-address based profile).
type RateLimiter struct {
	limit      int
	window     time.Duration
	trustProxy bool

	mu      sync.Mutex
	start   time.Time
	counts  map[string]int
	nowFunc func() time.Time
}

func NewRateLimiter(limit int, window time.Duration, trustProxy bool) *RateLimiter {
	return &RateLimiter{limit: limit, window: window, trustProxy: trustProxy, counts: map[string]int{}, nowFunc: time.Now}
}

func (l *RateLimiter) Allow(r *http.Request) bool {
	if l == nil || l.limit <= 0 {
		return true
	}
	key := l.clientKey(r)
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.nowFunc()
	if now.Sub(l.start) >= l.window {
		// Drop the whole previous window, including every address in it.
		l.start = now
		l.counts = map[string]int{}
	}
	l.counts[key]++
	return l.counts[key] <= l.limit
}

func (l *RateLimiter) clientKey(r *http.Request) string {
	if l.trustProxy {
		if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
			return strings.TrimSpace(strings.Split(fwd, ",")[0])
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
