// Command jevmock is a stand-in for the Jev System One API used in tests and local development.
//
// It answers every question with a deterministic, keyword-based heuristic and can record
// every state it receives (-record) so E2E tests can assert that canary values never
// reach it (DESIGN.md §31.1). It is a test tool: never point production traffic at it.
package main

import (
	"encoding/json"
	"flag"
	"io"
	"log"
	"net/http"
	"os"
	"regexp"
	"strings"
	"sync"
)

type question struct {
	Type     string          `json:"type"`
	Criteria json.RawMessage `json:"criteria"`
}

type request struct {
	State     json.RawMessage     `json:"state"`
	Model     string              `json:"model"`
	Questions map[string]question `json:"questions"`
}

type website struct {
	Page struct {
		Title     string   `json:"title"`
		Headings  []string `json:"headings"`
		PathClass string   `json:"pathClass"`
		Footer    string   `json:"footer"`
	} `json:"page"`
	Form struct {
		Fields []struct {
			Kind string `json:"kind"`
		} `json:"fields"`
		Context []string `json:"context"`
	} `json:"form"`
	PrivacyPolicy struct{ Excerpts []string } `json:"privacyPolicy"`
	OperatorInfo  struct{ Excerpts []string } `json:"operatorInfo"`
}

var (
	entityPattern  = regexp.MustCompile(`株式会社|合同会社|有限会社|一般社団法人|(?i)\b(inc|llc|ltd|corp|gmbh)\b|販売業者|運営会社|会社名|商号`)
	contactPattern = regexp.MustCompile(`\[phone\]|\[email\]|所在地|住所|電話|問い?合わ?せ|(?i)contact|address`)
	purposePattern = regexp.MustCompile(`利用目的|目的|(?i)purpose`)
	collectPattern = regexp.MustCompile(`取得|収集|(?i)collect`)
	thirdPattern   = regexp.MustCompile(`第三者|委託|共同利用|(?i)third[- ]part|share`)
	windowPattern  = regexp.MustCompile(`窓口|問い?合わ?せ|(?i)contact`)
	stalePattern   = regexp.MustCompile(`個人情報保護法.*200[0-9]年|(?i)flash player|internet explorer`)
)

func main() {
	addr := flag.String("addr", "127.0.0.1:8788", "listen address")
	record := flag.String("record", "", "append every received request body to this file (JSON lines)")
	flag.Parse()

	var mu sync.Mutex
	http.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("ok")) })
	http.HandleFunc("/v1/systemone", func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		if err != nil {
			http.Error(w, "read error", http.StatusBadRequest)
			return
		}
		if *record != "" {
			mu.Lock()
			f, err := os.OpenFile(*record, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
			if err == nil {
				_, _ = f.Write(append(body, '\n'))
				_ = f.Close()
			}
			mu.Unlock()
		}
		var req request
		if err := json.Unmarshal(body, &req); err != nil {
			http.Error(w, `{"error":"invalid"}`, http.StatusUnprocessableEntity)
			return
		}
		var state struct {
			Website website `json:"website"`
		}
		_ = json.Unmarshal(req.State, &state)
		answers := map[string]any{}
		for id, q := range req.Questions {
			answers[id] = answer(id, q, &state.Website)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"model":   "jev-mock",
			"answers": answers,
			"usage":   map[string]int{"input_tokens": 0, "output_tokens": 0},
		})
	})
	log.Printf("jevmock listening on %s", *addr)
	log.Fatal(http.ListenAndServe(*addr, nil))
}

func noul(yes bool) map[string]any {
	if yes {
		return map[string]any{"type": "noul", "noul": 0.92}
	}
	return map[string]any{"type": "noul", "noul": 0.08}
}

func answer(id string, q question, w *website) map[string]any {
	policy := strings.Join(w.PrivacyPolicy.Excerpts, "\n")
	operator := strings.Join(w.OperatorInfo.Excerpts, "\n") + "\n" + w.Page.Footer
	switch id {
	case "operator_identifiable":
		return noul(entityPattern.MatchString(operator))
	case "operator_contact_available":
		return noul(contactPattern.MatchString(operator))
	case "policy_describes_collection":
		return noul(collectPattern.MatchString(policy))
	case "policy_describes_purpose":
		return noul(purposePattern.MatchString(policy))
	case "policy_describes_third_party":
		return noul(thirdPattern.MatchString(policy))
	case "policy_describes_contact":
		return noul(windowPattern.MatchString(policy))
	case "policy_covers_form_fields":
		return noul(coversFields(policy, w))
	case "maintenance_signals":
		return noul(stalePattern.MatchString(policy + operator))
	case "data_minimization":
		return minimization(w)
	}
	if q.Type == "noul" {
		return map[string]any{"type": "noul", "noul": 0.5}
	}
	return map[string]any{"type": q.Type, "score": 0, "confidence": 0, "probabilities": map[string]float64{}}
}

var fieldWords = map[string]*regexp.Regexp{
	"name":      regexp.MustCompile(`氏名|名前|(?i)name`),
	"email":     regexp.MustCompile(`メール|(?i)e-?mail`),
	"phone":     regexp.MustCompile(`電話|(?i)phone`),
	"address":   regexp.MustCompile(`住所|(?i)address`),
	"birthdate": regexp.MustCompile(`生年月日|(?i)birth`),
	"payment":   regexp.MustCompile(`決済|クレジット|カード|(?i)payment|card`),
}

func coversFields(policy string, w *website) bool {
	if policy == "" {
		return false
	}
	for _, f := range w.Form.Fields {
		if re, ok := fieldWords[f.Kind]; ok && !re.MatchString(policy) {
			return false
		}
	}
	return true
}

// minimization flags address/birthdate/government ID requested by newsletter or contact pages.
func minimization(w *website) map[string]any {
	purpose := strings.ToLower(w.Page.PathClass + " " + w.Page.Title + " " + strings.Join(w.Page.Headings, " ") + " " + strings.Join(w.Form.Context, " "))
	light := strings.Contains(purpose, "newsletter") || strings.Contains(purpose, "メルマガ") || strings.Contains(purpose, "ニュースレター")
	heavy := 0
	for _, f := range w.Form.Fields {
		switch f.Kind {
		case "address", "birthdate", "government_id", "other_personal":
			heavy++
		}
	}
	level := 0.2
	switch {
	case light && heavy >= 2:
		level = 2.7
	case light && heavy == 1:
		level = 1.6
	case heavy >= 4:
		level = 1.2
	}
	return map[string]any{
		"type":          "score",
		"score":         level,
		"confidence":    0.85,
		"legend":        map[string]string{"0": "natural", "1": "slightly more", "2": "possibly excessive", "3": "hard to explain"},
		"probabilities": map[string]float64{"0": 0.25, "1": 0.25, "2": 0.25, "3": 0.25},
	}
}
