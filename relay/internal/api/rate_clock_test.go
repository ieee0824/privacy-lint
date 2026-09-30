package api

import (
	"sync"
	"time"
)

type fakeRateClock struct {
	mu     sync.Mutex
	now    time.Time
	timers []*fakeRateTimer
}

type fakeRateTimer struct {
	clock    *fakeRateClock
	deadline time.Time
	callback func()
	stopped  bool
}

func newFakeRateClock() *fakeRateClock {
	return &fakeRateClock{now: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}
}

func (clock *fakeRateClock) Now() time.Time {
	clock.mu.Lock()
	defer clock.mu.Unlock()
	return clock.now
}

func (clock *fakeRateClock) AfterFunc(delay time.Duration, callback func()) rateTimer {
	clock.mu.Lock()
	defer clock.mu.Unlock()
	timer := &fakeRateTimer{clock: clock, deadline: clock.now.Add(delay), callback: callback}
	clock.timers = append(clock.timers, timer)
	return timer
}

func (clock *fakeRateClock) Advance(duration time.Duration) {
	clock.mu.Lock()
	clock.now = clock.now.Add(duration)
	due := []func(){}
	for _, timer := range clock.timers {
		if !timer.stopped && !timer.deadline.After(clock.now) {
			timer.stopped = true
			due = append(due, timer.callback)
		}
	}
	clock.mu.Unlock()
	for _, callback := range due {
		callback()
	}
}

func (timer *fakeRateTimer) Stop() bool {
	timer.clock.mu.Lock()
	defer timer.clock.mu.Unlock()
	wasActive := !timer.stopped
	timer.stopped = true
	return wasActive
}
