package api

import (
	"net/http"
	"net/http/httptest"
	"net/netip"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestTransitionRateIsDeterministic(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	current := rateState{Start: now.Add(-10 * time.Second), Count: 1}
	saved := current
	first := transitionRate(now, time.Minute, 2, "203.0.113.7", current)
	second := transitionRate(now, time.Minute, 2, "203.0.113.7", current)
	if first != second || current != saved {
		t.Fatal("transition changed the input or depended on previous calls")
	}
	if !first.Allowed || first.Reset || first.State.Count != 2 {
		t.Fatalf("unexpected transition: %+v", first)
	}
}

func TestTransitionRateBoundaries(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	cases := []struct {
		name    string
		start   time.Time
		limit   int
		window  time.Duration
		allowed bool
		reset   bool
		count   int
	}{
		{"first", time.Time{}, 2, time.Minute, true, true, 1},
		{"limit", now, 2, time.Minute, false, false, 2},
		{"before expiry", now.Add(-time.Minute + time.Nanosecond), 2, time.Minute, false, false, 2},
		{"at expiry", now.Add(-time.Minute), 2, time.Minute, true, true, 1},
		{"after expiry", now.Add(-2 * time.Minute), 2, time.Minute, true, true, 1},
		{"disabled", now, 0, time.Minute, true, false, 2},
		{"negative limit", now, -1, time.Minute, true, false, 2},
		{"disabled window", now, 2, 0, true, false, 2},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			next := transitionRate(now, tc.window, tc.limit, "203.0.113.7", rateState{tc.start, 2})
			if next.Allowed != tc.allowed || next.Reset != tc.reset || next.State.Count != tc.count {
				t.Fatalf("unexpected transition: %+v", next)
			}
		})
	}
}

func TestForwardedClientCannotChangeRateLimitKey(t *testing.T) {
	proxies := []netip.Prefix{netip.MustParsePrefix("127.0.0.1/32")}
	limiter := NewRateLimiter(1, time.Minute, true, proxies...)
	defer limiter.Close()
	for index, spoofed := range []string{"198.51.100.10", "198.51.100.11"} {
		req := httptest.NewRequest("POST", "/v1/assess", nil)
		req.RemoteAddr = "127.0.0.1:1234"
		req.Header.Set("X-Forwarded-For", spoofed+", 203.0.113.7")
		if allowed := limiter.Allow(req); allowed != (index == 0) {
			t.Fatalf("request %d allowed=%t", index, allowed)
		}
	}
}

func TestIdleRateLimiterExpiresClientAddresses(t *testing.T) {
	clock := newFakeRateClock()
	limiter := newRateLimiter(2, time.Minute, false, nil, clock)
	defer limiter.Close()
	limiter.Allow(rateRequest())
	clock.Advance(time.Minute - time.Nanosecond)
	assertStoredClients(t, limiter, 1)
	clock.Advance(time.Nanosecond)
	assertStoredClients(t, limiter, 0)
	if !limiter.Allow(rateRequest()) {
		t.Fatal("a new window must accept its first request")
	}
}

func TestRateLimiterCloseReleasesAddressesAndTimer(t *testing.T) {
	clock := newFakeRateClock()
	limiter := newRateLimiter(2, time.Minute, false, nil, clock)
	limiter.Allow(rateRequest())
	limiter.Close()
	limiter.Close()
	assertStoredClients(t, limiter, 0)
	if !clock.timers[0].stopped || limiter.Allow(rateRequest()) {
		t.Fatal("closed limiter retained its timer or accepted traffic")
	}
	clock.Advance(time.Hour)
	assertStoredClients(t, limiter, 0)
}

func TestStaleExpiryCannotClearNewWindow(t *testing.T) {
	clock := newFakeRateClock()
	limiter := newRateLimiter(2, time.Minute, false, nil, clock)
	defer limiter.Close()
	limiter.Allow(rateRequest())
	stale := clock.timers[0].callback
	clock.Advance(time.Minute)
	limiter.Allow(rateRequest())
	stale()
	assertStoredClients(t, limiter, 1)
}

func TestConcurrentRateLimit(t *testing.T) {
	limiter := NewRateLimiter(10, time.Minute, false)
	defer limiter.Close()
	var allowed atomic.Int64
	var workers sync.WaitGroup
	req := rateRequest()
	for range 100 {
		workers.Go(func() {
			if limiter.Allow(req) {
				allowed.Add(1)
			}
		})
	}
	workers.Wait()
	if allowed.Load() != 10 {
		t.Fatalf("allowed %d requests, want 10", allowed.Load())
	}
}

func TestConcurrentExpiryAndRequests(t *testing.T) {
	clock := newFakeRateClock()
	limiter := newRateLimiter(10, time.Millisecond, false, nil, clock)
	defer limiter.Close()
	var workers sync.WaitGroup
	req := rateRequest()
	workers.Go(func() {
		for range 100 {
			clock.Advance(time.Millisecond)
		}
	})
	for range 10 {
		workers.Go(func() {
			for range 100 {
				limiter.Allow(req)
			}
		})
	}
	workers.Wait()
	clock.Advance(time.Millisecond)
	assertStoredClients(t, limiter, 0)
}

func rateRequest() *http.Request {
	req := httptest.NewRequest("POST", "/v1/assess", nil)
	req.RemoteAddr = "203.0.113.7:1234"
	return req
}

func assertStoredClients(t *testing.T, limiter *RateLimiter, count int) {
	t.Helper()
	limiter.mu.Lock()
	defer limiter.mu.Unlock()
	if len(limiter.counts) != count {
		t.Fatalf("stored %d client addresses, want %d", len(limiter.counts), count)
	}
}
