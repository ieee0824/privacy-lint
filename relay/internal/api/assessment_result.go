package api

import (
	"errors"
	"maps"
	"net/http"
	"strings"

	"github.com/ieee0824/privacy-lint/relay/internal/jev"
	"github.com/ieee0824/privacy-lint/relay/internal/validation"
)

type httpProblem struct {
	Status int
	Body   errorResponse
}

func assessRequestProblem(method, contentType, origin, authorization, bearer string) *httpProblem {
	if method != http.MethodPost {
		return &httpProblem{http.StatusMethodNotAllowed, errorResponse{Error: "method not allowed"}}
	}
	// Requiring application/json forces preflight for a web page's cross-origin
	// POST; the CORS boundary rejects non-extension origins.
	if !strings.HasPrefix(contentType, "application/json") {
		return &httpProblem{http.StatusUnsupportedMediaType, errorResponse{Error: "content type must be application/json"}}
	}
	if origin != "" && !isExtensionOrigin(origin) {
		return &httpProblem{http.StatusForbidden, errorResponse{Error: "origin not allowed"}}
	}
	if bearer != "" && !validBearer(authorization, bearer) {
		return &httpProblem{http.StatusUnauthorized, errorResponse{Error: "unauthorized"}}
	}
	return nil
}

func decodeProblem(err error) httpProblem {
	var tooLarge *http.MaxBytesError
	var invalid *validation.Error
	switch {
	case errors.As(err, &tooLarge):
		return httpProblem{http.StatusRequestEntityTooLarge, errorResponse{Error: "payload too large"}}
	case errors.As(err, &invalid):
		return httpProblem{http.StatusBadRequest, errorResponse{Error: invalid.Reason, Field: invalid.Path}}
	default:
		return httpProblem{http.StatusBadRequest, errorResponse{Error: "invalid request"}}
	}
}

func selectAnswers(questions map[string]jev.Question, response *jev.Response) assessResponse {
	answers := make(map[string]jev.Answer, len(questions))
	for id, question := range questions {
		answer, ok := response.Answers[id]
		if ok && answer.Type == question.Type {
			answers[id] = copyAnswer(answer)
		}
	}
	return assessResponse{SchemaVersion: validation.SchemaVersion, Model: response.Model, Answers: answers}
}

func copyAnswer(answer jev.Answer) jev.Answer {
	answer.Noul = copyPointer(answer.Noul)
	answer.Score = copyPointer(answer.Score)
	answer.Choice = copyPointer(answer.Choice)
	answer.Confidence = copyPointer(answer.Confidence)
	answer.Probabilities = maps.Clone(answer.Probabilities)
	return answer
}

func copyPointer[T any](value *T) *T {
	if value == nil {
		return nil
	}
	copy := *value
	return &copy
}
