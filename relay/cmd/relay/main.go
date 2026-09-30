// Command relay runs the Privacy Relay: the only component that holds the Jev credential
// (DESIGN.md §3.9, §22).
//
// Environment:
//
//	JEV_API_KEY        Jev credential (required unless -jev-endpoint points at a mock)
//	RELAY_BEARER       optional shared bearer value required from clients
package main

import (
	"errors"
	"flag"
	"log/slog"
	"net/http"
	"net/netip"
	"os"
	"time"

	"github.com/ieee0824/privacy-lint/relay/internal/api"
	"github.com/ieee0824/privacy-lint/relay/internal/jev"
	"github.com/ieee0824/privacy-lint/relay/internal/logging"
)

type config struct {
	addr, endpoint, model, credential, bearer string
	rate                                      int
	trustProxy                                bool
	proxies                                   []netip.Prefix
}

func readConfig() (config, error) {
	addr := flag.String("addr", "127.0.0.1:8787", "listen address")
	endpoint := flag.String("jev-endpoint", jev.DefaultEndpoint, "Jev System One endpoint")
	model := flag.String("jev-model", "jev-latest", "Jev model")
	rate := flag.Int("rate", 30, "requests per minute per client address (0 disables)")
	trustProxy := flag.Bool("trust-proxy", false, "use X-Forwarded-For only from -trusted-proxies; requires explicit proxy CIDRs")
	proxyCIDRs := flag.String("trusted-proxies", "", "comma-separated trusted proxy IP CIDRs; required with -trust-proxy")
	flag.Parse()
	proxies, err := api.ParseTrustedProxies(*proxyCIDRs)
	if err != nil {
		return config{}, err
	}
	c := config{*addr, *endpoint, *model, os.Getenv("JEV_API_KEY"), os.Getenv("RELAY_BEARER"), *rate, *trustProxy, proxies}
	return c, validateConfig(c)
}

func validateConfig(c config) error {
	if c.credential == "" && c.endpoint == jev.DefaultEndpoint {
		return errors.New("JEV_API_KEY is not set")
	}
	if c.trustProxy && len(c.proxies) == 0 {
		return errors.New("-trust-proxy requires -trusted-proxies with explicit proxy IP CIDRs")
	}
	if !c.trustProxy && len(c.proxies) > 0 {
		return errors.New("-trusted-proxies requires -trust-proxy")
	}
	return nil
}

func run(c config, logger *slog.Logger) error {
	limiter := api.NewRateLimiter(c.rate, time.Minute, c.trustProxy, c.proxies...)
	defer limiter.Close()
	server := &api.Server{
		Jev:     jev.NewClient(c.endpoint, c.model, c.credential),
		Bearer:  c.bearer,
		Limiter: limiter,
	}
	logger.Info("relay listening", "addr", c.addr, "jev_endpoint", c.endpoint, "model", c.model)
	return newHTTPServer(c.addr, logging.Middleware(logger, server.Routes())).ListenAndServe()
}

func newHTTPServer(addr string, handler http.Handler) *http.Server {
	httpServer := &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      30 * time.Second,
		MaxHeaderBytes:    16 << 10,
		// net/http's own error log could include client addresses; discard it.
		ErrorLog: slog.NewLogLogger(slog.DiscardHandler, slog.LevelError),
	}
	return httpServer
}

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	c, err := readConfig()
	if err != nil {
		logger.Error("invalid configuration", "error", err.Error())
		os.Exit(1)
	}
	if err := run(c, logger); err != nil {
		logger.Error("server stopped", "error", err.Error())
		os.Exit(1)
	}
}
