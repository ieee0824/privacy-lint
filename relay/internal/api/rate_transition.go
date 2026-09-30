package api

import "time"

// rateState projects the global window and the current client's count into
// immutable scalar values. Other clients' counts are untouched by the event.
// This keeps the pure transition O(1), without copying the complete IP map.
type rateState struct {
	Start time.Time
	Count int
}

type rateTransition struct {
	State   rateState
	Key     string
	Allowed bool
	Reset   bool
}

func transitionRate(now time.Time, window time.Duration, limit int, key string, current rateState) rateTransition {
	next := rateTransition{State: current, Key: key, Allowed: true}
	if limit <= 0 || window <= 0 {
		return next
	}
	if windowExpired(now, window, current.Start) {
		next.State = rateState{Start: now}
		next.Reset = true
	}
	next.Allowed = next.State.Count < limit
	if next.Allowed {
		next.State.Count++
	}
	return next
}

func windowExpired(now time.Time, window time.Duration, start time.Time) bool {
	return start.IsZero() || !now.Before(start.Add(window))
}
