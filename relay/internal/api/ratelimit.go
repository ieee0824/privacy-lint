package api

import (
	"net/http"
	"net/netip"
	"slices"
	"strings"
	"sync"
	"time"
)

// RateLimiter stores client addresses only until the current window expires.
// A timer removes them even when traffic stops; Close releases the timer too.
type RateLimiter struct {
	limit   int
	window  time.Duration
	proxies []netip.Prefix
	clock   rateClock
	mu      sync.Mutex
	start   time.Time
	counts  map[string]int
	timer   rateTimer
	closed  bool
}

func NewRateLimiter(limit int, window time.Duration, trustProxy bool, proxies ...netip.Prefix) *RateLimiter {
	return newRateLimiter(limit, window, trustProxy, proxies, systemRateClock{})
}

func newRateLimiter(limit int, window time.Duration, trustProxy bool, proxies []netip.Prefix, clock rateClock) *RateLimiter {
	trusted := []netip.Prefix(nil)
	if trustProxy {
		trusted = slices.Clone(proxies)
	}
	return &RateLimiter{limit: limit, window: window, proxies: trusted, clock: clock, counts: map[string]int{}}
}

func (l *RateLimiter) Allow(r *http.Request) bool {
	if l == nil || l.limit <= 0 || l.window <= 0 {
		return true
	}
	key := clientKey(r.RemoteAddr, strings.Join(r.Header.Values("X-Forwarded-For"), ","), l.proxies)
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closed {
		return false
	}
	now := l.clock.Now()
	current := rateState{Start: l.start, Count: l.counts[key]}
	next := transitionRate(now, l.window, l.limit, key, current)
	l.apply(next, now)
	return next.Allowed
}

func (l *RateLimiter) apply(next rateTransition, now time.Time) {
	if next.Reset {
		l.counts = map[string]int{}
		l.start = next.State.Start
		l.scheduleExpiry(now, next.State.Start)
	}
	l.counts[next.Key] = next.State.Count
}

func (l *RateLimiter) scheduleExpiry(now, start time.Time) {
	if l.timer != nil {
		l.timer.Stop()
	}
	l.timer = l.clock.AfterFunc(start.Add(l.window).Sub(now), func() { l.expire(start) })
}

func (l *RateLimiter) expire(start time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closed || !l.start.Equal(start) {
		return
	}
	now := l.clock.Now()
	if !windowExpired(now, l.window, start) {
		l.scheduleExpiry(now, start)
		return
	}
	l.counts = map[string]int{}
	l.start = time.Time{}
	l.timer = nil
}

func (l *RateLimiter) Close() {
	if l == nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	l.closed = true
	if l.timer != nil {
		l.timer.Stop()
	}
	l.counts = map[string]int{}
	l.start = time.Time{}
	l.timer = nil
}

type rateTimer interface {
	Stop() bool
}

type rateClock interface {
	Now() time.Time
	AfterFunc(time.Duration, func()) rateTimer
}

type systemRateClock struct{}

func (systemRateClock) Now() time.Time { return time.Now() }

func (systemRateClock) AfterFunc(delay time.Duration, callback func()) rateTimer {
	return time.AfterFunc(delay, callback)
}
