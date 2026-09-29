// Package api implements the Privacy Relay HTTP surface (DESIGN.md §22):
// auth, schema validation, rate limiting, and forwarding fixed questions to Jev.
// The relay is not an analysis subject: it stores nothing and logs no content.
package api

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/ieee0824/privacy-lint/relay/internal/jev"
	"github.com/ieee0824/privacy-lint/relay/internal/logging"
	"github.com/ieee0824/privacy-lint/relay/internal/validation"
)

const maxBodyBytes = 64 << 10

// Evaluator is satisfied by *jev.Client.
type Evaluator interface {
	Evaluate(ctx context.Context, state any, questions map[string]jev.Question) (*jev.Response, error)
}

type Server struct {
	Jev Evaluator
	// Bearer, when non-empty, is required as "Authorization: Bearer <value>".
	Bearer  string
	Limiter *RateLimiter
	Timeout time.Duration
}

type assessResponse struct {
	SchemaVersion int                   `json:"schemaVersion"`
	Model         string                `json:"model,omitempty"`
	Answers       map[string]jev.Answer `json:"answers"`
}

type errorResponse struct {
	Error string `json:"error"`
	Field string `json:"field,omitempty"`
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte("ok"))
	})
	mux.HandleFunc("/v1/assess", s.assess)
	return withCORS(mux)
}

// withCORS allows browser-extension origins only. Web pages cannot use the relay
// as a Jev proxy through a visitor's browser. No credentials are ever allowed.
func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if isExtensionOrigin(origin) {
			h := w.Header()
			h.Set("Access-Control-Allow-Origin", origin)
			h.Set("Access-Control-Allow-Methods", "POST, OPTIONS")
			h.Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			h.Set("Access-Control-Max-Age", "600")
			h.Add("Vary", "Origin")
		} else if origin != "" && r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func isExtensionOrigin(origin string) bool {
	for _, prefix := range []string{"chrome-extension://", "moz-extension://"} {
		if strings.HasPrefix(origin, prefix) && len(origin) > len(prefix) && len(origin) < 200 {
			return true
		}
	}
	return false
}

func (s *Server) assess(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, errorResponse{Error: "method not allowed"})
		return
	}
	// A web page could send a "simple" cross-origin POST without preflight; requiring
	// application/json forces a preflight that withCORS rejects for non-extension origins.
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		writeJSON(w, http.StatusUnsupportedMediaType, errorResponse{Error: "content type must be application/json"})
		return
	}
	if origin := r.Header.Get("Origin"); origin != "" && !isExtensionOrigin(origin) {
		writeJSON(w, http.StatusForbidden, errorResponse{Error: "origin not allowed"})
		return
	}
	if s.Bearer != "" && !validBearer(r.Header.Get("Authorization"), s.Bearer) {
		writeJSON(w, http.StatusUnauthorized, errorResponse{Error: "unauthorized"})
		return
	}
	if !s.Limiter.Allow(r) {
		writeJSON(w, http.StatusTooManyRequests, errorResponse{Error: "rate limited"})
		return
	}

	req, err := validation.Decode(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	if err != nil {
		var tooLarge *http.MaxBytesError
		var invalid *validation.Error
		switch {
		case errors.As(err, &tooLarge):
			writeJSON(w, http.StatusRequestEntityTooLarge, errorResponse{Error: "payload too large"})
		case errors.As(err, &invalid):
			writeJSON(w, http.StatusBadRequest, errorResponse{Error: invalid.Reason, Field: invalid.Path})
		default:
			writeJSON(w, http.StatusBadRequest, errorResponse{Error: "invalid request"})
		}
		return
	}
	logging.FieldsFrom(r.Context()).SchemaVersion = req.SchemaVersion

	questions := jev.QuestionsFor(&req.Website)
	if len(questions) == 0 {
		writeJSON(w, http.StatusOK, assessResponse{SchemaVersion: validation.SchemaVersion, Answers: map[string]jev.Answer{}})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), s.timeout())
	defer cancel()
	res, err := s.Jev.Evaluate(ctx, jev.State(&req.Website), questions)
	if err != nil {
		// Never degrade to an empty or default answer set: the extension must see the failure.
		writeJSON(w, http.StatusBadGateway, errorResponse{Error: "evaluation unavailable"})
		return
	}

	answers := make(map[string]jev.Answer, len(questions))
	for id := range questions {
		if a, ok := res.Answers[id]; ok && a.Type == questions[id].Type {
			answers[id] = a
		}
	}
	writeJSON(w, http.StatusOK, assessResponse{SchemaVersion: validation.SchemaVersion, Model: res.Model, Answers: answers})
}

func (s *Server) timeout() time.Duration {
	if s.Timeout > 0 {
		return s.Timeout
	}
	return 18 * time.Second
}

func validBearer(header, expected string) bool {
	const prefix = "Bearer "
	if !strings.HasPrefix(header, prefix) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(header[len(prefix):]), []byte(expected)) == 1
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
