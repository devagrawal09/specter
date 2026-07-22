// Package specification validates and canonically identifies portable Specter
// Slice specifications without depending on the TypeScript authoring runtime.
package specification

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"math/big"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

const (
	Schema         = "https://specter.dev/specification/v1/slice.schema.json"
	FormatVersion  = 1
	maxSafeInteger = int64(9_007_199_254_740_991)
)

var (
	sliceNamePattern = regexp.MustCompile(`^[a-z][A-Za-z0-9]*$`)
	eventTypePattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)
)

// Document retains the validated JSON representation used on the wire.
type Document struct {
	value map[string]any
}

func ParseJSON(data []byte) (Document, error) {
	if err := validateJSONUnicode(data); err != nil {
		return Document{}, err
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return Document{}, fmt.Errorf("invalid specification JSON: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return Document{}, fmt.Errorf("invalid specification JSON: multiple values")
	}
	root, ok := value.(map[string]any)
	if !ok {
		return Document{}, fmt.Errorf("specification must be an object")
	}
	if err := validateDocument(root); err != nil {
		return Document{}, err
	}
	return Document{value: root}, nil
}

func (document Document) CanonicalJSON() ([]byte, error) {
	var output bytes.Buffer
	if err := writeCanonicalJSON(&output, document.value); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}

func (document Document) Digest() (string, error) {
	canonical, err := document.CanonicalJSON()
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(canonical)
	return "sha256:" + hex.EncodeToString(digest[:]), nil
}

func validateDocument(root map[string]any) error {
	if err := exactKeys(root, []string{"$schema", "formatVersion", "kind", "name", "description", "scenarios"}, "$", nil); err != nil {
		return err
	}
	if root["$schema"] != Schema {
		return fmt.Errorf("$.$schema must be %s", Schema)
	}
	if !isInteger(root["formatVersion"], FormatVersion) {
		return fmt.Errorf("$.formatVersion must be %d", FormatVersion)
	}
	kind, ok := root["kind"].(string)
	if !ok || (kind != "command" && kind != "query" && kind != "reaction") {
		return fmt.Errorf("$.kind must be one of command, query, reaction")
	}
	name, ok := root["name"].(string)
	if !ok || !sliceNamePattern.MatchString(name) {
		return fmt.Errorf("$.name must use lower camel case")
	}
	if !nonemptyString(root["description"]) {
		return fmt.Errorf("$.description must be a non-empty string")
	}
	scenarios, ok := root["scenarios"].([]any)
	if !ok || len(scenarios) == 0 {
		return fmt.Errorf("$.scenarios must contain at least one scenario")
	}
	descriptions := make(map[string]struct{}, len(scenarios))
	for index, item := range scenarios {
		path := fmt.Sprintf("$.scenarios[%d]", index)
		scenario, ok := item.(map[string]any)
		if !ok {
			return fmt.Errorf("%s must be an object", path)
		}
		allowed := []string{"description", "given", "expect"}
		if kind != "reaction" {
			allowed = append(allowed, "when")
		}
		optional := map[string]struct{}{}
		if kind == "command" {
			allowed = append(allowed, "reject")
			optional["reject"] = struct{}{}
		}
		if err := exactKeys(scenario, allowed, path, optional); err != nil {
			return err
		}
		description, ok := scenario["description"].(string)
		if !ok || strings.TrimSpace(description) == "" {
			return fmt.Errorf("%s.description must be a non-empty string", path)
		}
		if _, duplicate := descriptions[description]; duplicate {
			return fmt.Errorf("%s.description must be unique within the Slice", path)
		}
		descriptions[description] = struct{}{}
		given, ok := scenario["given"].([]any)
		if !ok {
			return fmt.Errorf("%s.given must be an array", path)
		}
		for eventIndex, event := range given {
			if err := validateScenarioEvent(event, fmt.Sprintf("%s.given[%d]", path, eventIndex)); err != nil {
				return err
			}
		}
		if kind != "reaction" {
			if err := validateJSONValue(scenario["when"]); err != nil {
				return fmt.Errorf("%s.when: %w", path, err)
			}
		}
		if kind == "command" {
			expected, ok := scenario["expect"].([]any)
			if !ok {
				return fmt.Errorf("%s.expect must be an array", path)
			}
			for eventIndex, event := range expected {
				if err := validateScenarioEvent(event, fmt.Sprintf("%s.expect[%d]", path, eventIndex)); err != nil {
					return err
				}
			}
			reject, rejected := scenario["reject"]
			if rejected {
				if len(expected) != 0 {
					return fmt.Errorf("%s.reject is only valid when expect is empty", path)
				}
				object, ok := reject.(map[string]any)
				if !ok {
					return fmt.Errorf("%s.reject must be an object", path)
				}
				if err := exactKeys(object, []string{"reason"}, path+".reject", nil); err != nil {
					return err
				}
				if !nonemptyString(object["reason"]) {
					return fmt.Errorf("%s.reject.reason must be a non-empty string", path)
				}
			} else if len(expected) == 0 {
				return fmt.Errorf("%s must expect Events or define an exact rejection reason", path)
			}
		} else if kind == "reaction" {
			expected, ok := scenario["expect"].([]any)
			if !ok {
				return fmt.Errorf("%s.expect must be an array", path)
			}
			if err := validateJSONValue(expected); err != nil {
				return fmt.Errorf("%s.expect: %w", path, err)
			}
		} else if err := validateJSONValue(scenario["expect"]); err != nil {
			return fmt.Errorf("%s.expect: %w", path, err)
		}
	}
	return nil
}

func validateScenarioEvent(value any, path string) error {
	event, ok := value.(map[string]any)
	if !ok {
		return fmt.Errorf("%s must be an object", path)
	}
	if err := exactKeys(event, []string{"kind", "eventType", "examplePayload"}, path, nil); err != nil {
		return err
	}
	if event["kind"] != "scenario-event" {
		return fmt.Errorf("%s.kind must be scenario-event", path)
	}
	eventType, ok := event["eventType"].(string)
	if !ok || !eventTypePattern.MatchString(eventType) {
		return fmt.Errorf("%s.eventType must use kebab-case", path)
	}
	if err := validateJSONValue(event["examplePayload"]); err != nil {
		return fmt.Errorf("%s.examplePayload: %w", path, err)
	}
	return nil
}

func exactKeys(value map[string]any, allowed []string, path string, optional map[string]struct{}) error {
	allowedSet := make(map[string]struct{}, len(allowed))
	for _, key := range allowed {
		allowedSet[key] = struct{}{}
	}
	for key := range value {
		if _, ok := allowedSet[key]; !ok {
			return fmt.Errorf("%s.%s is not allowed", path, key)
		}
	}
	for _, key := range allowed {
		if _, optionalKey := optional[key]; optionalKey {
			continue
		}
		if _, ok := value[key]; !ok {
			return fmt.Errorf("%s.%s is required", path, key)
		}
	}
	return nil
}

func validateJSONValue(value any) error {
	switch typed := value.(type) {
	case nil, string, bool:
		return nil
	case json.Number:
		if integer, ok := new(big.Rat).SetString(typed.String()); ok && integer.IsInt() {
			absolute := new(big.Int).Abs(integer.Num())
			if absolute.Cmp(big.NewInt(maxSafeInteger)) > 0 {
				return fmt.Errorf("integer is outside the portable JSON safe range")
			}
			return nil
		}
		number, err := typed.Float64()
		if err != nil || math.IsInf(number, 0) || math.IsNaN(number) {
			return fmt.Errorf("number must be finite")
		}
		return nil
	case []any:
		for _, item := range typed {
			if err := validateJSONValue(item); err != nil {
				return err
			}
		}
		return nil
	case map[string]any:
		for _, item := range typed {
			if err := validateJSONValue(item); err != nil {
				return err
			}
		}
		return nil
	default:
		return fmt.Errorf("value is not portable JSON")
	}
}

func writeCanonicalJSON(output *bytes.Buffer, value any) error {
	switch typed := value.(type) {
	case nil:
		output.WriteString("null")
	case bool:
		output.WriteString(strconv.FormatBool(typed))
	case string:
		encoded, err := encodeString(typed)
		if err != nil {
			return err
		}
		output.Write(encoded)
	case json.Number:
		number, err := typed.Float64()
		if err != nil {
			return err
		}
		if number == 0 {
			output.WriteByte('0')
			return nil
		}
		encoded, err := json.Marshal(number)
		if err != nil {
			return err
		}
		output.Write(encoded)
	case []any:
		output.WriteByte('[')
		for index, item := range typed {
			if index > 0 {
				output.WriteByte(',')
			}
			if err := writeCanonicalJSON(output, item); err != nil {
				return err
			}
		}
		output.WriteByte(']')
	case map[string]any:
		keys := make([]string, 0, len(typed))
		for key := range typed {
			keys = append(keys, key)
		}
		sort.Slice(keys, func(left, right int) bool {
			return lessUTF16(keys[left], keys[right])
		})
		output.WriteByte('{')
		for index, key := range keys {
			if index > 0 {
				output.WriteByte(',')
			}
			encoded, err := encodeString(key)
			if err != nil {
				return err
			}
			output.Write(encoded)
			output.WriteByte(':')
			if err := writeCanonicalJSON(output, typed[key]); err != nil {
				return err
			}
		}
		output.WriteByte('}')
	default:
		return fmt.Errorf("unsupported canonical JSON value %T", value)
	}
	return nil
}

func encodeString(value string) ([]byte, error) {
	var output bytes.Buffer
	encoder := json.NewEncoder(&output)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return nil, err
	}
	encoded := bytes.TrimSuffix(output.Bytes(), []byte("\n"))
	return unescapeECMAScriptLineSeparators(encoded), nil
}

func unescapeECMAScriptLineSeparators(encoded []byte) []byte {
	var output bytes.Buffer
	start := 0
	for index := 0; index+6 <= len(encoded); index++ {
		candidate := encoded[index : index+6]
		if !bytes.Equal(candidate, []byte(`\u2028`)) && !bytes.Equal(candidate, []byte(`\u2029`)) {
			continue
		}
		precedingSlashes := 0
		for previous := index - 1; previous >= 0 && encoded[previous] == '\\'; previous-- {
			precedingSlashes++
		}
		if precedingSlashes%2 != 0 {
			continue
		}
		output.Write(encoded[start:index])
		if candidate[5] == '8' {
			output.WriteString("\u2028")
		} else {
			output.WriteString("\u2029")
		}
		index += 5
		start = index + 1
	}
	if start == 0 {
		return encoded
	}
	output.Write(encoded[start:])
	return output.Bytes()
}

func validateJSONUnicode(data []byte) error {
	if !utf8.Valid(data) {
		return fmt.Errorf("invalid specification JSON: strings must use valid UTF-8")
	}
	inString := false
	for index := 0; index < len(data); index++ {
		switch data[index] {
		case '"':
			inString = !inString
		case '\\':
			if !inString || index+1 >= len(data) {
				continue
			}
			if data[index+1] != 'u' || index+6 > len(data) {
				index++
				continue
			}
			code, err := strconv.ParseUint(string(data[index+2:index+6]), 16, 16)
			if err != nil {
				continue
			}
			if code >= 0xd800 && code <= 0xdbff {
				if index+12 > len(data) || data[index+6] != '\\' || data[index+7] != 'u' {
					return fmt.Errorf("invalid specification JSON: strings must not contain unpaired UTF-16 surrogates")
				}
				low, lowErr := strconv.ParseUint(string(data[index+8:index+12]), 16, 16)
				if lowErr != nil || low < 0xdc00 || low > 0xdfff {
					return fmt.Errorf("invalid specification JSON: strings must not contain unpaired UTF-16 surrogates")
				}
				index += 11
			} else if code >= 0xdc00 && code <= 0xdfff {
				return fmt.Errorf("invalid specification JSON: strings must not contain unpaired UTF-16 surrogates")
			} else {
				index += 5
			}
		}
	}
	return nil
}

func lessUTF16(left, right string) bool {
	leftUnits := utf16.Encode([]rune(left))
	rightUnits := utf16.Encode([]rune(right))
	limit := len(leftUnits)
	if len(rightUnits) < limit {
		limit = len(rightUnits)
	}
	for index := 0; index < limit; index++ {
		if leftUnits[index] != rightUnits[index] {
			return leftUnits[index] < rightUnits[index]
		}
	}
	return len(leftUnits) < len(rightUnits)
}

func nonemptyString(value any) bool {
	text, ok := value.(string)
	return ok && strings.TrimSpace(text) != ""
}

func isInteger(value any, expected int64) bool {
	number, ok := value.(json.Number)
	if !ok {
		return false
	}
	parsed, ok := new(big.Rat).SetString(number.String())
	return ok && parsed.IsInt() && parsed.Num().Int64() == expected
}
