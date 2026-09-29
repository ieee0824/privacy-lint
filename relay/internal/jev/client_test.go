package jev

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestClientRetriesOnRateLimitThenSucceeds(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-credential" {
			t.Errorf("missing bearer header")
		}
		if calls.Add(1) == 1 {
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		_, _ = w.Write([]byte(`{"model":"jev-1.13.0","answers":{"q":{"type":"noul","noul":0.9}},"usage":{}}`))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "jev-latest", "test-credential")
	c.backoff = time.Millisecond
	res, err := c.Evaluate(context.Background(), "state", map[string]Question{"q": {Type: "noul", Instructions: "?"}})
	if err != nil {
		t.Fatal(err)
	}
	if *res.Answers["q"].Noul != 0.9 || calls.Load() != 2 {
		t.Fatalf("unexpected result %+v after %d calls", res, calls.Load())
	}
}

func TestClientFailuresAreUnavailable(t *testing.T) {
	for _, status := range []int{http.StatusInternalServerError, http.StatusUnauthorized, 529} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(status) }))
		c := NewClient(srv.URL, "jev-latest", "x")
		c.backoff = time.Millisecond
		_, err := c.Evaluate(context.Background(), "state", map[string]Question{})
		if !errors.Is(err, ErrUnavailable) {
			t.Fatalf("status %d: expected ErrUnavailable, got %v", status, err)
		}
		srv.Close()
	}
}
