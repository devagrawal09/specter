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
	if digest != "sha256:eaf05020c0bbee5b8afb871f0a28b83678270c602495cc1476beb9b53cda20fd" {
		t.Fatalf("unexpected digest %s", digest)
	}
}

func TestCanonicalDigestUsesJavaScriptUTF16Ordering(t *testing.T) {
	contents := []byte(`{"$schema":"https://specter.dev/specification/v1/slice.schema.json","formatVersion":1,"kind":"command","name":"unicodeVector","description":"Exercises canonical JSON ordering.","scenarios":[{"description":"Sorts keys without locale rules.","given":[],"when":{"€":3,"\r":0,"😀":4,"ö":2,"1":1},"expect":[{"kind":"scenario-event","eventType":"unicode-recorded","examplePayload":{"value":true}}]}]}`)
	document, err := specification.ParseJSON(contents)
	if err != nil {
		t.Fatal(err)
	}
	digest, err := document.Digest()
	if err != nil {
		t.Fatal(err)
	}
	if digest != "sha256:55b5fb1832af7eb3a48eb72f161765c1b07f95c04bad0e10204c7d477e018b1c" {
		t.Fatalf("unexpected Unicode vector digest %s", digest)
	}
}

func TestSpecificationRejectsUnknownFields(t *testing.T) {
	contents := []byte(`{"$schema":"https://specter.dev/specification/v1/slice.schema.json","formatVersion":1,"kind":"command","name":"addTodo","description":"Adds.","scenarios":[{"description":"Adds.","given":[],"when":{},"expect":[{"kind":"scenario-event","eventType":"todo-added","examplePayload":{}}]}],"extra":true}`)
	if _, err := specification.ParseJSON(contents); err == nil {
		t.Fatal("accepted an unknown specification field")
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
	if digest != "sha256:4c6675c9d9e5daf8e475adbfadf34d5fb94c0a097fa6b12e4ef1d1d6e14955ec" {
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
