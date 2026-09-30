package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"reflect"
	"testing"

	"github.com/ieee0824/privacy-lint/relay/internal/jev"
	"github.com/ieee0824/privacy-lint/relay/internal/validation"
)

func TestDecodeProblemIsPure(t *testing.T) {
	cases := []struct {
		err  error
		want httpProblem
	}{
		{&http.MaxBytesError{Limit: 64 << 10}, httpProblem{413, errorResponse{Error: "payload too large"}}},
		{&validation.Error{Path: "website.page.headings", Reason: "required"}, httpProblem{400, errorResponse{Error: "required", Field: "website.page.headings"}}},
		{errors.New("secret failure detail"), httpProblem{400, errorResponse{Error: "invalid request"}}},
	}
	for _, tc := range cases {
		first := decodeProblem(tc.err)
		if first != tc.want || decodeProblem(tc.err) != first {
			t.Fatalf("unexpected error classification: %+v", first)
		}
	}
}

func TestAssessRequestProblemPreservesRejectionOrder(t *testing.T) {
	cases := []struct {
		method, contentType, origin, auth string
		status                            int
	}{
		{"GET", "text/plain", "https://evil.example", "", 405},
		{"POST", "text/plain", "https://evil.example", "", 415},
		{"POST", "application/json", "https://evil.example", "", 403},
		{"POST", "application/json", "moz-extension://abc", "", 401},
	}
	for _, tc := range cases {
		problem := assessRequestProblem(tc.method, tc.contentType, tc.origin, tc.auth, "token")
		if problem == nil || problem.Status != tc.status {
			t.Fatalf("unexpected condition result: %+v", problem)
		}
	}
	if assessRequestProblem("POST", "application/json", "moz-extension://abc", "Bearer token", "token") != nil {
		t.Fatal("valid request rejected")
	}
}

func TestSelectAnswersFiltersAndOwnsItsResult(t *testing.T) {
	questions := map[string]jev.Question{"kept": {Type: "noul"}, "wrong": {Type: "score"}, "missing": {Type: "noul"}}
	response := &jev.Response{Model: "test", Answers: map[string]jev.Answer{
		"kept":  {Type: "noul", Noul: p(0.9), Probabilities: map[string]float64{"true": 0.9}},
		"wrong": {Type: "noul", Noul: p(0.1)},
		"extra": {Type: "noul", Noul: p(1)},
	}}
	saved, _ := json.Marshal(response)
	first := selectAnswers(questions, response)
	second := selectAnswers(questions, response)
	if !reflect.DeepEqual(first, second) || len(first.Answers) != 1 {
		t.Fatalf("unexpected answers: %+v", first)
	}
	*first.Answers["kept"].Noul = 0
	first.Answers["kept"].Probabilities["true"] = 0
	after, _ := json.Marshal(response)
	if string(saved) != string(after) || !reflect.DeepEqual(second, selectAnswers(questions, response)) {
		t.Fatal("result mutation changed input or subsequent selection")
	}
}
