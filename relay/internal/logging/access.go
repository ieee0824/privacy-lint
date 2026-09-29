// Package logging writes access logs that contain no request content (DESIGN.md §22):
// only request ID, route, status, latency, schema version and payload size.
// Client IPs, user agents, headers, URLs with queries and bodies are never logged.
package logging

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"io"
	"log/slog"
	"net/http"
	"time"
)

type ctxKey struct{}

// Fields is filled in by handlers with the few values that may be logged.
type Fields struct {
	SchemaVersion int
}

func FieldsFrom(ctx context.Context) *Fields {
	f, _ := ctx.Value(ctxKey{}).(*Fields)
	if f == nil {
		return &Fields{}
	}
	return f
}

type recorder struct {
	http.ResponseWriter
	status int
}

func (r *recorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

type countingBody struct {
	body  io.ReadCloser
	bytes int64
}

func (c *countingBody) Read(p []byte) (int, error) {
	n, err := c.body.Read(p)
	c.bytes += int64(n)
	return n, err
}

func (c *countingBody) Close() error { return c.body.Close() }

func newRequestID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// knownRoutes limits the logged path to fixed values; arbitrary client paths are never logged.
var knownRoutes = map[string]bool{"/v1/assess": true, "/healthz": true}

var knownMethods = map[string]bool{http.MethodGet: true, http.MethodPost: true, http.MethodOptions: true, http.MethodHead: true}

func methodOf(method string) string {
	if knownMethods[method] {
		return method
	}
	return "other"
}

func routeOf(path string) string {
	if knownRoutes[path] {
		return path
	}
	return "other"
}

// Middleware logs one line per request.
func Middleware(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		id := newRequestID()
		fields := &Fields{}
		rec := &recorder{ResponseWriter: w, status: http.StatusOK}
		body := &countingBody{body: r.Body}
		r.Body = body
		w.Header().Set("X-Request-Id", id)

		next.ServeHTTP(rec, r.WithContext(context.WithValue(r.Context(), ctxKey{}, fields)))

		logger.Info("request",
			"request_id", id,
			"method", methodOf(r.Method),
			"route", routeOf(r.URL.Path),
			"status", rec.status,
			"latency_ms", time.Since(start).Milliseconds(),
			"schema_version", fields.SchemaVersion,
			"payload_bytes", body.bytes,
		)
	})
}
