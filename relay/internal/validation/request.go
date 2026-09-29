// Package validation decodes and strictly validates requests from the extension
// (DESIGN.md §17, §22). It mirrors extension/src/shared/validate.ts.
package validation

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"unicode/utf8"
)

// SchemaVersion is the only request schema version this relay accepts.
const SchemaVersion = 1

// Limits mirror extension/src/shared/schema.ts LIMITS.
const (
	shortText           = 120
	labelText           = 60
	footerText          = 300
	excerptText         = 280
	excerptsPerDocument = 12
	maxHeadings         = 5
	maxContextTexts     = 6
	maxFields           = 40
	maxOrigins          = 300
)

var (
	sensitiveFieldKinds = set("name", "email", "phone", "address", "birthdate", "password", "payment", "government_id", "other_personal", "unknown")
	schemes             = set("https", "http", "other")
	pathClasses         = set("checkout", "signup", "login", "contact", "reservation", "newsletter", "account", "application", "other")
	formMethods         = set("get", "post", "dialog", "none", "other")
	originPattern       = regexp.MustCompile(`^https?://([a-z0-9.-]+|\[[0-9a-f:.]+\])(:\d{1,5})?$`)
)

func set(values ...string) map[string]bool {
	m := make(map[string]bool, len(values))
	for _, v := range values {
		m[v] = true
	}
	return m
}

// AssessRequest is the only payload accepted from the extension.
type AssessRequest struct {
	SchemaVersion int     `json:"schemaVersion"`
	Website       Website `json:"website"`
}

// Website is untrusted, page-derived data. It is only ever placed under state.website.
type Website struct {
	Page          Page           `json:"page"`
	Form          Form           `json:"form"`
	PrivacyPolicy LinkedDocument `json:"privacyPolicy"`
	OperatorInfo  LinkedDocument `json:"operatorInfo"`
	ThirdParty    ThirdParty     `json:"thirdParty"`
}

type Page struct {
	Origin    string   `json:"origin"`
	Scheme    string   `json:"scheme"`
	PathClass string   `json:"pathClass"`
	Title     *string  `json:"title,omitempty"`
	Headings  []string `json:"headings"`
	Footer    *string  `json:"footer,omitempty"`
}

type Form struct {
	Method            string   `json:"method"`
	CrossOriginAction bool     `json:"crossOriginAction"`
	CrossSiteAction   bool     `json:"crossSiteAction"`
	Fields            []Field  `json:"fields"`
	Context           []string `json:"context"`
}

type Field struct {
	Kind     string  `json:"kind"`
	Label    *string `json:"label,omitempty"`
	Required bool    `json:"required"`
}

type LinkedDocument struct {
	Found    bool     `json:"found"`
	Fetched  bool     `json:"fetched"`
	Title    *string  `json:"title,omitempty"`
	Excerpts []string `json:"excerpts"`
}

type ThirdParty struct {
	TotalOrigins  int `json:"totalOrigins"`
	ScriptOrigins int `json:"scriptOrigins"`
	IframeOrigins int `json:"iframeOrigins"`
}

// Error describes which field failed. It never includes the offending value,
// so it is safe to return to clients and to log.
type Error struct {
	Path   string
	Reason string
}

func (e *Error) Error() string { return e.Path + ": " + e.Reason }

func fail(path, reason string) error { return &Error{Path: path, Reason: reason} }

// Decode reads and validates one AssessRequest. Unknown fields, trailing data,
// missing required fields and out-of-range values are all rejected.
func Decode(r io.Reader) (*AssessRequest, error) {
	raw, err := io.ReadAll(r)
	if err != nil {
		return nil, err
	}
	if err := requireKeys(raw); err != nil {
		return nil, err
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	var req AssessRequest
	if err := dec.Decode(&req); err != nil {
		var syntax *json.SyntaxError
		var typeErr *json.UnmarshalTypeError
		switch {
		case errors.As(err, &syntax):
			return nil, fail("body", "malformed JSON")
		case errors.As(err, &typeErr):
			return nil, fail(typeErr.Field, "wrong type")
		default:
			// e.g. unknown fields. The message is not echoed: field names are client-controlled.
			return nil, fail("body", "unexpected content")
		}
	}
	if dec.More() {
		return nil, fail("body", "trailing data")
	}
	if err := req.validate(); err != nil {
		return nil, err
	}
	return &req, nil
}

// requireKeys makes sure required objects/arrays are present rather than
// silently zero-valued by encoding/json.
func requireKeys(raw []byte) error {
	var top map[string]json.RawMessage
	if err := json.Unmarshal(raw, &top); err != nil {
		return fail("body", "malformed JSON")
	}
	required := map[string][]string{
		"":                      {"schemaVersion", "website"},
		"website":               {"page", "form", "privacyPolicy", "operatorInfo", "thirdParty"},
		"website.page":          {"origin", "scheme", "pathClass", "headings"},
		"website.form":          {"method", "crossOriginAction", "crossSiteAction", "fields", "context"},
		"website.privacyPolicy": {"found", "fetched", "excerpts"},
		"website.operatorInfo":  {"found", "fetched", "excerpts"},
		"website.thirdParty":    {"totalOrigins", "scriptOrigins", "iframeOrigins"},
	}
	objects := map[string]map[string]json.RawMessage{"": top}
	for _, path := range []string{"website", "website.page", "website.form", "website.privacyPolicy", "website.operatorInfo", "website.thirdParty"} {
		parent, key := splitPath(path)
		obj, ok := objects[parent]
		if !ok {
			return fail(parent, "missing")
		}
		var child map[string]json.RawMessage
		if err := json.Unmarshal(obj[key], &child); err != nil || child == nil {
			return fail(path, "expected object")
		}
		objects[path] = child
	}
	for path, keys := range required {
		for _, k := range keys {
			v, ok := objects[path][k]
			if !ok || string(v) == "null" {
				return fail(join(path, k), "required")
			}
		}
	}
	return nil
}

func splitPath(path string) (string, string) {
	for i := len(path) - 1; i >= 0; i-- {
		if path[i] == '.' {
			return path[:i], path[i+1:]
		}
	}
	return "", path
}

func join(parent, key string) string {
	if parent == "" {
		return key
	}
	return parent + "." + key
}

func (r *AssessRequest) validate() error {
	if r.SchemaVersion != SchemaVersion {
		return fail("schemaVersion", "unsupported")
	}
	w := &r.Website
	checks := []error{
		origin("website.page.origin", w.Page.Origin),
		enum("website.page.scheme", w.Page.Scheme, schemes),
		enum("website.page.pathClass", w.Page.PathClass, pathClasses),
		optText("website.page.title", w.Page.Title, shortText),
		optText("website.page.footer", w.Page.Footer, footerText),
		texts("website.page.headings", w.Page.Headings, maxHeadings, shortText),
		enum("website.form.method", w.Form.Method, formMethods),
		texts("website.form.context", w.Form.Context, maxContextTexts, shortText),
		document("website.privacyPolicy", &w.PrivacyPolicy),
		document("website.operatorInfo", &w.OperatorInfo),
		count("website.thirdParty.totalOrigins", w.ThirdParty.TotalOrigins),
		count("website.thirdParty.scriptOrigins", w.ThirdParty.ScriptOrigins),
		count("website.thirdParty.iframeOrigins", w.ThirdParty.IframeOrigins),
	}
	if len(w.Form.Fields) > maxFields {
		checks = append(checks, fail("website.form.fields", "too many items"))
	}
	for i, f := range w.Form.Fields {
		p := fmt.Sprintf("website.form.fields[%d]", i)
		checks = append(checks, enum(p+".kind", f.Kind, sensitiveFieldKinds), optText(p+".label", f.Label, labelText))
	}
	for _, err := range checks {
		if err != nil {
			return err
		}
	}
	return nil
}

func origin(path, v string) error {
	if len(v) > 300 || !originPattern.MatchString(v) {
		return fail(path, "not an origin")
	}
	return nil
}

func enum(path, v string, allowed map[string]bool) error {
	if !allowed[v] {
		return fail(path, "unexpected value")
	}
	return nil
}

func text(path, v string, max int) error {
	if !utf8.ValidString(v) {
		return fail(path, "invalid UTF-8")
	}
	if utf8.RuneCountInString(v) > max {
		return fail(path, "too long")
	}
	return nil
}

func optText(path string, v *string, max int) error {
	if v == nil {
		return nil
	}
	return text(path, *v, max)
}

func texts(path string, vs []string, maxItems, maxLen int) error {
	if len(vs) > maxItems {
		return fail(path, "too many items")
	}
	for i, v := range vs {
		if err := text(fmt.Sprintf("%s[%d]", path, i), v, maxLen); err != nil {
			return err
		}
	}
	return nil
}

func document(path string, d *LinkedDocument) error {
	if err := optText(path+".title", d.Title, shortText); err != nil {
		return err
	}
	return texts(path+".excerpts", d.Excerpts, excerptsPerDocument, excerptText)
}

func count(path string, v int) error {
	if v < 0 || v > maxOrigins {
		return fail(path, "out of range")
	}
	return nil
}
