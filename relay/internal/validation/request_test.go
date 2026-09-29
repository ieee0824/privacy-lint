package validation

import (
	"errors"
	"strings"
	"testing"
)

const valid = `{
  "schemaVersion": 1,
  "website": {
    "page": {"origin": "https://shop.example", "scheme": "https", "pathClass": "checkout", "title": "購入", "headings": ["購入手続き"]},
    "form": {"method": "post", "crossOriginAction": false, "crossSiteAction": false,
             "fields": [{"kind": "email", "required": true, "label": "メール"}], "context": ["購入する"]},
    "privacyPolicy": {"found": true, "fetched": true, "excerpts": ["利用目的: 発送"]},
    "operatorInfo": {"found": false, "fetched": false, "excerpts": []},
    "thirdParty": {"totalOrigins": 1, "scriptOrigins": 1, "iframeOrigins": 0}
  }
}`

func TestDecodeValid(t *testing.T) {
	req, err := Decode(strings.NewReader(valid))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if req.Website.Page.Origin != "https://shop.example" || len(req.Website.Form.Fields) != 1 {
		t.Fatalf("unexpected decode result: %+v", req)
	}
}

func TestDecodeRejects(t *testing.T) {
	cases := map[string]string{
		"unknown field":      strings.Replace(valid, `"required": true`, `"required": true, "value": "taro@example.com"`, 1),
		"trailing data":      valid + `{}`,
		"schema version":     strings.Replace(valid, `"schemaVersion": 1`, `"schemaVersion": 2`, 1),
		"origin with path":   strings.Replace(valid, `"https://shop.example"`, `"https://shop.example/cart?id=1"`, 1),
		"bad enum":           strings.Replace(valid, `"kind": "email"`, `"kind": "credit_score"`, 1),
		"missing object":     strings.Replace(valid, `"thirdParty": {"totalOrigins": 1, "scriptOrigins": 1, "iframeOrigins": 0}`, `"thirdParty": null`, 1),
		"missing field":      strings.Replace(valid, `"found": false, `, ``, 1),
		"too long":           strings.Replace(valid, `"title": "購入"`, `"title": "`+strings.Repeat("あ", 121)+`"`, 1),
		"negative count":     strings.Replace(valid, `"iframeOrigins": 0`, `"iframeOrigins": -1`, 1),
		"not json":           `not json`,
		"wrong type":         strings.Replace(valid, `"required": true`, `"required": "yes"`, 1),
		"top-level question": strings.Replace(valid, `"schemaVersion": 1,`, `"schemaVersion": 1, "questions": {},`, 1),
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := Decode(strings.NewReader(body)); err == nil {
				t.Fatal("expected an error")
			}
		})
	}
}

func TestErrorsNeverEchoValues(t *testing.T) {
	body := strings.Replace(valid, `"https://shop.example"`, `"taro@example.com"`, 1)
	_, err := Decode(strings.NewReader(body))
	var verr *Error
	if !errors.As(err, &verr) {
		t.Fatalf("expected validation error, got %v", err)
	}
	if strings.Contains(err.Error(), "taro@example.com") {
		t.Fatalf("error echoes the value: %v", err)
	}
	unknown := strings.Replace(valid, `"required": true`, `"required": true, "taro@example.com": 1`, 1)
	_, err = Decode(strings.NewReader(unknown))
	if err == nil || strings.Contains(err.Error(), "taro@example.com") {
		t.Fatalf("error echoes a client-controlled key: %v", err)
	}
}
