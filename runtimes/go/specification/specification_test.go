package specification_test

import (
	"bytes"
	"encoding/json"
	"os"
	"testing"

	"github.com/devagrawal09/specter/runtimes/go/specification"
)

func TestSharedSpecificationFixture(t *testing.T) {
	contents, err := os.ReadFile("../../../specification/fixtures/add-todo.spec.json")
	if err != nil {
		t.Fatal(err)
	}
	document, err := specification.ParseJSON(contents)
	if err != nil {
		t.Fatal(err)
	}
	digest, err := document.Digest()
	if err != nil {
		t.Fatal(err)
	}
	if digest != "sha256:7b4e50afc9fd82bd836e50bae638f1164befd62dcaa54d5b2b710f2e15aa4c58" {
		t.Fatalf("unexpected digest %s", digest)
	}
}

func TestCanonicalDigestUsesJavaScriptUTF16Ordering(t *testing.T) {
	contents := []byte(`{"$schema":"https://specter.dev/specification/v2/slice.schema.json","formatVersion":2,"kind":"command","name":"unicodeVector","description":"Exercises canonical JSON ordering.","scenarios":[{"description":"Sorts keys without locale rules.","given":[],"when":{"€":3,"\r":0,"😀":4,"ö":2,"1":1},"expect":[{"kind":"scenario-event","eventType":"unicode-recorded","examplePayload":{"value":true}}]}]}`)
	document, err := specification.ParseJSON(contents)
	if err != nil {
		t.Fatal(err)
	}
	digest, err := document.Digest()
	if err != nil {
		t.Fatal(err)
	}
	if digest != "sha256:6310d825b7fcdce1aea7d3127a5b78a7794e9ab92d585dafcb2b1f8853ad5337" {
		t.Fatalf("unexpected Unicode vector digest %s", digest)
	}
}

func TestSpecificationRejectsUnknownFields(t *testing.T) {
	contents := []byte(`{"$schema":"https://specter.dev/specification/v2/slice.schema.json","formatVersion":2,"kind":"command","name":"addTodo","description":"Adds.","scenarios":[{"description":"Adds.","given":[],"when":{},"expect":[{"kind":"scenario-event","eventType":"todo-added","examplePayload":{}}]}],"extra":true}`)
	if _, err := specification.ParseJSON(contents); err == nil {
		t.Fatal("accepted an unknown specification field")
	}
}

func TestSpecificationRequiresAKebabCaseRejectionCode(t *testing.T) {
	document := func(reject string) []byte {
		return []byte(`{"$schema":"https://specter.dev/specification/v2/slice.schema.json","formatVersion":2,"kind":"command","name":"addTodo","description":"Adds.","scenarios":[{"description":"Refuses.","given":[],"when":{},"expect":[],"reject":` + reject + `}]}`)
	}
	for _, valid := range []string{`{"code":"title-required"}`, `{"code":"title-required","message":"Todo title is required","details":{"field":"title"}}`} {
		if _, err := specification.ParseJSON(document(valid)); err != nil {
			t.Fatalf("rejected a valid rejection %s: %v", valid, err)
		}
	}
	for _, invalid := range []string{`{"reason":"Todo title is required"}`, `{"code":"Title required"}`, `{"code":"title-required","message":""}`, `{"code":"title-required","extra":true}`} {
		if _, err := specification.ParseJSON(document(invalid)); err == nil {
			t.Fatalf("accepted an invalid rejection %s", invalid)
		}
	}
}

func TestSharedUnicodeStringFixture(t *testing.T) {
	contents, err := os.ReadFile("../../../specification/fixtures/unicode-strings.spec.json")
	if err != nil {
		t.Fatal(err)
	}
	document, err := specification.ParseJSON(contents)
	if err != nil {
		t.Fatal(err)
	}
	canonical, err := document.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(canonical, []byte("\u2028")) || !bytes.Contains(canonical, []byte("\u2029")) {
		t.Fatalf("canonical JSON escaped ECMAScript line separators: %s", canonical)
	}
	if !json.Valid(canonical) {
		t.Fatalf("canonical JSON corrupted literal escape text: %s", canonical)
	}
	digest, err := document.Digest()
	if err != nil {
		t.Fatal(err)
	}
	if digest != "sha256:20e59e607bb0c6d2111a45d6e15a7e0e8e0e588773b9ef1c6b7710f9445724e2" {
		t.Fatalf("unexpected Unicode string digest %s", digest)
	}
}

func TestSharedLoneSurrogateFixtureIsRejected(t *testing.T) {
	contents, err := os.ReadFile("../../../specification/fixtures/invalid-lone-surrogate.spec.json")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := specification.ParseJSON(contents); err == nil {
		t.Fatal("accepted an unpaired UTF-16 surrogate")
	}
}
