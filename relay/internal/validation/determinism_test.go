package validation

import (
	"errors"
	"strings"
	"testing"
)

func TestMultipleMissingKeysHaveDeterministicError(t *testing.T) {
	body := strings.Replace(valid, `, "headings": ["購入手続き"]`, "", 1)
	body = strings.Replace(body, `, "context": ["購入する"]`, "", 1)
	assertRepeatedValidationError(t, body, "website.page.headings", "required")
}

func TestNullRequiredKeysHaveDeterministicError(t *testing.T) {
	body := strings.Replace(valid, `"headings": ["購入手続き"]`, `"headings": null`, 1)
	body = strings.Replace(body, `"context": ["購入する"]`, `"context": null`, 1)
	assertRepeatedValidationError(t, body, "website.page.headings", "required")
}

func TestObjectTypeErrorsKeepTheirPriority(t *testing.T) {
	body := strings.Replace(valid, `, "headings": ["購入手続き"]`, "", 1)
	body = strings.Replace(body, `"operatorInfo": {"found": false, "fetched": false, "excerpts": []}`, `"operatorInfo": null`, 1)
	assertRepeatedValidationError(t, body, "website.operatorInfo", "expected object")
}

func TestTopLevelRequiredKeysHaveFixedPriority(t *testing.T) {
	body := strings.Replace(valid, `"schemaVersion": 1,`, "", 1)
	body = strings.Replace(body, `, "headings": ["購入手続き"]`, "", 1)
	assertRepeatedValidationError(t, body, "schemaVersion", "required")
}

func assertRepeatedValidationError(t *testing.T, body, path, reason string) {
	t.Helper()
	for range 1000 {
		_, err := Decode(strings.NewReader(body))
		var invalid *Error
		if !errors.As(err, &invalid) {
			t.Fatalf("expected validation error, got %v", err)
		}
		if invalid.Path != path || invalid.Reason != reason {
			t.Fatalf("got %v, want %s: %s", err, path, reason)
		}
	}
}
