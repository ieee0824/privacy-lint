// Command relay runs the Privacy Relay: the only component that holds the Jev credential
// (DESIGN.md §3.9, §22).
//
// Environment:
//
//	JEV_API_KEY        Jev credential (required unless -jev-endpoint points at a mock)
//	RELAY_BEARER       optional shared bearer value required from clients
package main

import (
	"flag"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/ieee0824/privacy-lint/relay/internal/api"
	"github.com/ieee0824/privacy-lint/relay/internal/jev"
	"github.com/ieee0824/privacy-lint/relay/internal/logging"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:8787", "listen address")
	endpoint := flag.String("jev-endpoint", jev.DefaultEndpoint, "Jev System One endpoint")
	model := flag.String("jev-model", "jev-latest", "Jev model")
	rate := flag.Int("rate", 30, "requests per minute per client address (0 disables)")
	trustProxy := flag.Bool("trust-proxy", false, "use X-Forwarded-For for rate limiting (only behind a trusted proxy)")
	flag.Parse()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	credential := os.Getenv("JEV_API_KEY")
	if credential == "" && *endpoint == jev.DefaultEndpoint {
		logger.Error("JEV_API_KEY is not set")
		os.Exit(1)
	}

	server := &api.Server{
		Jev:     jev.NewClient(*endpoint, *model, credential),
		Bearer:  os.Getenv("RELAY_BEARER"),
		Limiter: api.NewRateLimiter(*rate, time.Minute, *trustProxy),
	}
	httpServer := &http.Server{
		Addr:              *addr,
		Handler:           logging.Middleware(logger, server.Routes()),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      30 * time.Second,
		MaxHeaderBytes:    16 << 10,
		// net/http's own error log could include client addresses; discard it.
		ErrorLog: slog.NewLogLogger(slog.DiscardHandler, slog.LevelError),
	}
	logger.Info("relay listening", "addr", *addr, "jev_endpoint", *endpoint, "model", *model)
	if err := httpServer.ListenAndServe(); err != nil {
		logger.Error("server stopped", "error", err.Error())
		os.Exit(1)
	}
}
