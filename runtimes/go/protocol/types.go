// Package protocol implements Specter's one-way runtime-observability protocol.
package protocol

import (
	"bytes"
	"encoding/json"
	"math/big"
	"reflect"
	"regexp"
	"strings"
	"time"

	"github.com/devagrawal09/specter/runtimes/go/specter"
)

const Version SafeInteger = 1

var safeIntegerType = reflect.TypeOf(SafeInteger(0))

// SafeInteger is an unsigned integer that can be represented exactly by every
// conforming JSON implementation. Decimal JSON spellings such as 1.0 are
// accepted and encoded canonically as 1.
type SafeInteger int64

func (value *SafeInteger) UnmarshalJSON(data []byte) error {
	parsed, ok := parseSafeInteger(data)
	if !ok {
		return &json.UnmarshalTypeError{Value: string(data), Type: safeIntegerType}
	}
	*value = SafeInteger(parsed)
	return nil
}

type Envelope struct {
	ProtocolVersion SafeInteger `json:"protocolVersion"`
	Kind            string      `json:"kind"`
	RequestID       string      `json:"requestId"`
}

type RuntimeSource struct {
	Application     string `json:"application"`
	Environment     string `json:"environment"`
	RuntimeLanguage string `json:"runtimeLanguage"`
	RuntimeVersion  string `json:"runtimeVersion"`
	InstanceID      string `json:"instanceId"`
	EventLogID      string `json:"eventLogId"`
}

type EventOrderRange struct {
	From SafeInteger `json:"from"`
	To   SafeInteger `json:"to"`
}

type StructuredError struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Details   any    `json:"details,omitempty"`
	Retryable *bool  `json:"retryable,omitempty"`
}

type EventReference struct {
	EventID       string         `json:"eventId"`
	Type          string         `json:"type"`
	Order         SafeInteger    `json:"order"`
	RecordedAt    time.Time      `json:"recordedAt"`
	CommitVersion SafeInteger    `json:"commitVersion"`
	Attributes    map[string]any `json:"attributes,omitempty"`

	decoded         bool
	fieldsValid     bool
	timestampValid  bool
	attributesValid bool
}

func (event *EventReference) UnmarshalJSON(data []byte) error {
	type alias EventReference
	var decoded alias
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	attributesValid := true
	if attributes, present := fields["attributes"]; present {
		attributesValid = isJSONObject(attributes)
	}
	*event = EventReference(decoded)
	event.decoded = true
	event.fieldsValid = rawInteger(fields, "order", true) && rawInteger(fields, "commitVersion", true)
	event.timestampValid = isUTCDateTime(fields["recordedAt"])
	event.attributesValid = attributesValid
	return nil
}

// RuntimeObservation is the language-neutral wire DTO. It deliberately does
// not embed the Go runtime's internal Observation shape.
type RuntimeObservation struct {
	ObservationID        string           `json:"observationId"`
	Sequence             SafeInteger      `json:"sequence"`
	ObservedAt           time.Time        `json:"observedAt"`
	Source               RuntimeSource    `json:"source"`
	Kind                 string           `json:"kind"`
	OperationID          string           `json:"operationId"`
	CorrelationID        string           `json:"correlationId,omitempty"`
	ParentOperationIDs   []string         `json:"parentOperationIds,omitempty"`
	TriggeringEventIDs   []string         `json:"triggeringEventIds,omitempty"`
	TriggeringEventOrder *EventOrderRange `json:"triggeringEventOrder,omitempty"`
	DeliveryID           string           `json:"deliveryId,omitempty"`
	Outcome              string           `json:"outcome,omitempty"`
	CommandType          string           `json:"commandType,omitempty"`
	QueryType            string           `json:"queryType,omitempty"`
	Slice                string           `json:"slice,omitempty"`
	Reaction             string           `json:"reaction,omitempty"`
	Events               []EventReference `json:"events,omitempty"`
	Cursor               SafeInteger      `json:"cursor,omitempty"`
	Error                *StructuredError `json:"error,omitempty"`
	DroppedCount         SafeInteger      `json:"droppedCount,omitempty"`
	Attributes           map[string]any   `json:"attributes,omitempty"`

	decoded         bool
	fieldsValid     bool
	timestampValid  bool
	attributesValid bool
	errorValid      bool
}

func (observation *RuntimeObservation) UnmarshalJSON(data []byte) error {
	type alias RuntimeObservation
	var decoded alias
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	fieldsValid := rawInteger(fields, "sequence", true) && rawObject(fields["source"])
	for _, name := range []string{"cursor", "droppedCount"} {
		fieldsValid = fieldsValid && rawInteger(fields, name, false)
	}
	for _, name := range []string{"parentOperationIds", "triggeringEventIds", "events"} {
		if value, present := fields[name]; present {
			fieldsValid = fieldsValid && rawArray(value)
		}
	}
	if value, present := fields["triggeringEventOrder"]; present {
		var order map[string]json.RawMessage
		fieldsValid = fieldsValid && rawObject(value) && json.Unmarshal(value, &order) == nil && rawInteger(order, "from", true) && rawInteger(order, "to", true)
	}
	attributesValid := true
	if attributes, present := fields["attributes"]; present {
		attributesValid = isJSONObject(attributes)
	}
	errorValid := true
	if value, present := fields["error"]; present {
		errorValid = isStructuredError(value)
	}
	*observation = RuntimeObservation(decoded)
	observation.decoded = true
	observation.fieldsValid = fieldsValid
	observation.timestampValid = isUTCDateTime(fields["observedAt"])
	observation.attributesValid = attributesValid
	observation.errorValid = errorValid
	return nil
}

type RuntimeObservationBatch struct {
	Envelope
	Observations []RuntimeObservation `json:"observations"`

	decoded     bool
	fieldsValid bool
}

func (batch *RuntimeObservationBatch) UnmarshalJSON(data []byte) error {
	type alias RuntimeObservationBatch
	var decoded alias
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	observations, present := fields["observations"]
	*batch = RuntimeObservationBatch(decoded)
	batch.decoded = true
	batch.fieldsValid = present && rawArray(observations)
	return nil
}

type ObservationAcknowledgement struct {
	Envelope
	Accepted               SafeInteger `json:"accepted"`
	Duplicates             SafeInteger `json:"duplicates"`
	RejectedObservationIDs []string    `json:"rejectedObservationIds,omitempty"`
}

// ObservationFromRuntime is the single explicit adapter from Go runtime facts
// to the language-neutral wire DTO. Caller-owned metadata is snapshotted here.
func ObservationFromRuntime(observation specter.Observation, source RuntimeSource, sequence int64) RuntimeObservation {
	attributes := snapshotJSONObject(observation.Attributes)
	if observation.Version != 0 || observation.Duplicate || observation.ReactionTicketID != "" {
		if attributes == nil {
			attributes = make(map[string]any)
		}
		if observation.Version != 0 {
			attributes["version"] = observation.Version
		}
		if observation.Duplicate {
			attributes["duplicate"] = true
		}
		if observation.ReactionTicketID != "" {
			attributes["reactionTicketId"] = observation.ReactionTicketID
		}
	}
	result := RuntimeObservation{
		ObservationID: observation.ObservationID, Sequence: SafeInteger(sequence), ObservedAt: observation.ObservedAt,
		Source: source, Kind: observation.Kind, OperationID: observation.OperationID, CorrelationID: observation.CorrelationID,
		ParentOperationIDs: append([]string(nil), observation.ParentOperationIDs...), TriggeringEventIDs: append([]string(nil), observation.TriggeringEventIDs...),
		DeliveryID: observation.DeliveryID,
		Outcome:    observation.Outcome, CommandType: observation.CommandType, QueryType: observation.QueryType, Slice: observation.Slice,
		Reaction: observation.ReactionName, Cursor: SafeInteger(observation.Cursor), DroppedCount: SafeInteger(observation.DroppedCount),
		Attributes: attributes,
	}
	if observation.TriggeringEventOrder != nil {
		result.TriggeringEventOrder = &EventOrderRange{From: SafeInteger(observation.TriggeringEventOrder.From), To: SafeInteger(observation.TriggeringEventOrder.To)}
	}
	if observation.Error != nil {
		result.Error = SanitizeObservationError(observation.Error)
	}
	if len(observation.Events) > 0 {
		result.Events = make([]EventReference, len(observation.Events))
		for index, event := range observation.Events {
			result.Events[index] = EventReference{EventID: event.EventID, Type: event.Type, Order: SafeInteger(event.Order), RecordedAt: event.RecordedAt, CommitVersion: SafeInteger(event.CommitVersion), Attributes: snapshotJSONObject(event.Attributes)}
		}
	}
	return result
}

func snapshotJSONObject(value map[string]any) map[string]any {
	if value == nil {
		return nil
	}
	data, err := json.Marshal(value)
	if err != nil {
		return nil
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var result map[string]any
	if decoder.Decode(&result) != nil {
		return nil
	}
	return result
}

func rawInteger(fields map[string]json.RawMessage, name string, required bool) bool {
	raw, present := fields[name]
	if !present {
		return !required
	}
	_, ok := parseSafeInteger(raw)
	return ok
}

func parseSafeInteger(raw []byte) (int64, bool) {
	value := strings.TrimSpace(string(raw))
	parsed, ok := new(big.Rat).SetString(value)
	if !ok || !parsed.IsInt() || parsed.Sign() < 0 || parsed.Cmp(big.NewRat(maxSafeInteger, 1)) > 0 {
		return 0, false
	}
	return parsed.Num().Int64(), true
}

func rawArray(raw json.RawMessage) bool {
	value := strings.TrimSpace(string(raw))
	return len(value) > 0 && value[0] == '['
}

func rawObject(raw json.RawMessage) bool {
	value := strings.TrimSpace(string(raw))
	return len(value) > 0 && value[0] == '{'
}

func isUTCDateTime(raw json.RawMessage) bool {
	var value string
	if err := json.Unmarshal(raw, &value); err != nil || !canonicalTimestamp.MatchString(value) {
		return false
	}
	_, err := time.Parse(time.RFC3339Nano, value)
	return err == nil
}

var canonicalTimestamp = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$`)

func isJSONObject(raw json.RawMessage) bool {
	if !rawObject(raw) {
		return false
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value map[string]any
	return decoder.Decode(&value) == nil && validateJSONValue(value)
}

func isStructuredError(raw json.RawMessage) bool {
	if !rawObject(raw) {
		return false
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil {
		return false
	}
	var code, message string
	if json.Unmarshal(fields["code"], &code) != nil || code == "" || json.Unmarshal(fields["message"], &message) != nil || message == "" {
		return false
	}
	if details, present := fields["details"]; present {
		decoder := json.NewDecoder(bytes.NewReader(details))
		decoder.UseNumber()
		var value any
		if decoder.Decode(&value) != nil || !validateJSONValue(value) {
			return false
		}
	}
	if retryable, present := fields["retryable"]; present {
		var value bool
		if json.Unmarshal(retryable, &value) != nil || strings.TrimSpace(string(retryable)) == "null" {
			return false
		}
	}
	return true
}
