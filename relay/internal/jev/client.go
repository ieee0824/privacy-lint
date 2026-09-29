// Package jev is a minimal client for the TypeSafe System One endpoint
// (https://docs.typesafe.ai/api) plus the fixed question set used by privacy-lint.
package jev

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

const DefaultEndpoint = "https://api.typesafe.ai/v1/systemone"

// Question is one typed question. Instructions and criteria are always
// relay-owned constants (see questions.go), never text from a web page.
type Question struct {
	Type         string `json:"type"`
	Instructions any    `json:"instructions"`
	Criteria     any    `json:"criteria,omitempty"`
}

type Request struct {
	State     any                 `json:"state"`
	Model     string              `json:"model"`
	Questions map[string]Question `json:"questions"`
}

// Answer keeps only the fields the extension consumes.
type Answer struct {
	Type          string             `json:"type"`
	Noul          *float64           `json:"noul,omitempty"`
	Score         *float64           `json:"score,omitempty"`
	Choice        *string            `json:"choice,omitempty"`
	Confidence    *float64           `json:"confidence,omitempty"`
	Probabilities map[string]float64 `json:"probabilities,omitempty"`
}

type Response struct {
	Model   string            `json:"model"`
	Answers map[string]Answer `json:"answers"`
}

// ErrUnavailable covers every upstream failure. Callers must not treat it as a low-risk answer.
var ErrUnavailable = errors.New("jev unavailable")

type Client struct {
	Endpoint   string
	Model      string
	credential string
	HTTP       *http.Client
	// MaxRetries applies to 429 / 529 responses (exponential backoff).
	MaxRetries int
	backoff    time.Duration
}

func NewClient(endpoint, model, credential string) *Client {
	return &Client{
		Endpoint:   endpoint,
		Model:      model,
		credential: credential,
		HTTP:       &http.Client{Timeout: 15 * time.Second},
		MaxRetries: 2,
		backoff:    300 * time.Millisecond,
	}
}

func (c *Client) Evaluate(ctx context.Context, state any, questions map[string]Question) (*Response, error) {
	body, err := json.Marshal(Request{State: state, Model: c.Model, Questions: questions})
	if err != nil {
		return nil, err
	}
	for attempt := 0; ; attempt++ {
		resp, status, err := c.post(ctx, body)
		if err == nil {
			return resp, nil
		}
		retryable := status == http.StatusTooManyRequests || status == 529
		if !retryable || attempt >= c.MaxRetries {
			return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
		}
		select {
		case <-ctx.Done():
			return nil, fmt.Errorf("%w: %v", ErrUnavailable, ctx.Err())
		case <-time.After(c.backoff << attempt):
		}
	}
}

func (c *Client) post(ctx context.Context, body []byte) (*Response, int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.Endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.credential)
	res, err := c.HTTP.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		// Upstream error bodies may echo request content; drain without reading into logs.
		_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 1<<16))
		return nil, res.StatusCode, fmt.Errorf("status %d", res.StatusCode)
	}
	var out Response
	if err := json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&out); err != nil {
		return nil, res.StatusCode, errors.New("malformed response")
	}
	return &out, res.StatusCode, nil
}
