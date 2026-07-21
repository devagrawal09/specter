// Package protocol implements the Specter protocol v1 JSON binding.
package protocol

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/devagrawal09/specter/runtimes/go/specter"
)

const Version = 1

const (
	CapabilityCommands        = "commands"
	CapabilityQueries         = "queries"
	CapabilitySubscriptions   = "query-subscriptions"
	CapabilityReactionTickets = "reaction-tickets"
	CapabilityObservations    = "runtime-observations"
)

var GoCapabilities = []string{CapabilityCommands, CapabilityQueries, CapabilitySubscriptions, CapabilityReactionTickets}

type Envelope struct {
	ProtocolVersion int    `json:"protocolVersion"`
	Kind            string `json:"kind"`
	RequestID       string `json:"requestId"`
}

type CapabilitiesRequest struct {
	Envelope
	Required []string `json:"required,omitempty"`
	Optional []string `json:"optional,omitempty"`

	fieldsValid bool
}
type CapabilitiesResponse struct {
	Envelope
	Runtime    RuntimeDescriptor `json:"runtime"`
	Supported  []string          `json:"supported"`
	Negotiated []string          `json:"negotiated"`
	Error      *specter.Error    `json:"error,omitempty"`
}
type RuntimeDescriptor struct {
	Language string `json:"language"`
	Version  string `json:"version"`
}

type CommandRequest struct {
	Envelope
	OperationID          string                   `json:"operationId"`
	CorrelationID        string                   `json:"correlationId,omitempty"`
	ParentOperationIDs   []string                 `json:"parentOperationIds,omitempty"`
	TriggeringEventIDs   []string                 `json:"triggeringEventIds,omitempty"`
	TriggeringEventOrder *specter.EventOrderRange `json:"triggeringEventOrder,omitempty"`
	ReactionPassID       string                   `json:"reactionPassId,omitempty"`
	DeliveryID           string                   `json:"deliveryId,omitempty"`
	AttemptID            string                   `json:"attemptId,omitempty"`
	Command              OperationEnvelope        `json:"command"`
	IdempotencyKey       string                   `json:"idempotencyKey,omitempty"`
	ExpectedVersion      *int64                   `json:"expectedVersion,omitempty"`

	fieldsValid bool
}
type OperationEnvelope struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}
type EventReference struct {
	EventID       string         `json:"eventId"`
	Type          string         `json:"type"`
	Order         int64          `json:"order"`
	CommitVersion int64          `json:"commitVersion"`
	RecordedAt    time.Time      `json:"recordedAt"`
	Attributes    map[string]any `json:"attributes,omitempty"`
}
type CommandResponse struct {
	Envelope
	OperationID      string           `json:"operationId"`
	Status           string           `json:"status"`
	Version          int64            `json:"version"`
	Events           []EventReference `json:"events"`
	ReactionTicketID string           `json:"reactionTicketId,omitempty"`
	Error            *specter.Error   `json:"error,omitempty"`
}

type QueryRequest struct {
	Envelope
	OperationID          string                   `json:"operationId"`
	CorrelationID        string                   `json:"correlationId,omitempty"`
	ParentOperationIDs   []string                 `json:"parentOperationIds,omitempty"`
	TriggeringEventIDs   []string                 `json:"triggeringEventIds,omitempty"`
	TriggeringEventOrder *specter.EventOrderRange `json:"triggeringEventOrder,omitempty"`
	ReactionPassID       string                   `json:"reactionPassId,omitempty"`
	DeliveryID           string                   `json:"deliveryId,omitempty"`
	AttemptID            string                   `json:"attemptId,omitempty"`
	Query                OperationEnvelope        `json:"query"`

	fieldsValid bool
}
type QueryResponse struct {
	Envelope
	OperationID string         `json:"operationId"`
	Result      any            `json:"result,omitempty"`
	Error       *specter.Error `json:"error,omitempty"`
}

// MarshalJSON preserves a legitimate JSON null Query result while keeping failed
// responses exclusive: a success always contains result, and a failure never does.
func (response QueryResponse) MarshalJSON() ([]byte, error) {
	type success struct {
		Envelope
		OperationID string `json:"operationId"`
		Result      any    `json:"result"`
	}
	if response.Error == nil {
		return json.Marshal(success{Envelope: response.Envelope, OperationID: response.OperationID, Result: response.Result})
	}
	type failure struct {
		Envelope
		OperationID string         `json:"operationId"`
		Error       *specter.Error `json:"error"`
	}
	return json.Marshal(failure{Envelope: response.Envelope, OperationID: response.OperationID, Error: response.Error})
}

type SubscriptionRequest struct {
	Envelope
	OperationID          string                   `json:"operationId"`
	CorrelationID        string                   `json:"correlationId,omitempty"`
	ParentOperationIDs   []string                 `json:"parentOperationIds,omitempty"`
	TriggeringEventIDs   []string                 `json:"triggeringEventIds,omitempty"`
	TriggeringEventOrder *specter.EventOrderRange `json:"triggeringEventOrder,omitempty"`
	ReactionPassID       string                   `json:"reactionPassId,omitempty"`
	DeliveryID           string                   `json:"deliveryId,omitempty"`
	AttemptID            string                   `json:"attemptId,omitempty"`
	Query                OperationEnvelope        `json:"query"`
	AfterSequence        *int64                   `json:"afterSequence,omitempty"`

	fieldsValid bool
}

// UnmarshalJSON retains whether optional request fields were present with their
// protocol-defined JSON types. Go's ordinary value decoding otherwise makes an
// omitted field indistinguishable from an explicit null for pointers, slices,
// and strings.
func (request *CommandRequest) UnmarshalJSON(data []byte) error {
	type alias CommandRequest
	var decoded alias
	valid, sanitized, err := validateRequestFields(data, []string{
		"correlationId", "parentOperationIds", "triggeringEventIds", "triggeringEventOrder",
		"reactionPassId", "deliveryId", "attemptId", "idempotencyKey", "expectedVersion",
	}, func(fields map[string]json.RawMessage) bool {
		return validCausalityFields(fields) && optionalNonemptyString(fields, "idempotencyKey") && optionalSafeInteger(fields, "expectedVersion")
	})
	if err != nil {
		return err
	}
	if err := json.Unmarshal(sanitized, &decoded); err != nil {
		return err
	}
	*request = CommandRequest(decoded)
	request.fieldsValid = valid
	return nil
}

func (request *QueryRequest) UnmarshalJSON(data []byte) error {
	type alias QueryRequest
	var decoded alias
	valid, sanitized, err := validateRequestFields(data, []string{
		"correlationId", "parentOperationIds", "triggeringEventIds", "triggeringEventOrder",
		"reactionPassId", "deliveryId", "attemptId",
	}, validCausalityFields)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(sanitized, &decoded); err != nil {
		return err
	}
	*request = QueryRequest(decoded)
	request.fieldsValid = valid
	return nil
}

func (request *SubscriptionRequest) UnmarshalJSON(data []byte) error {
	type alias SubscriptionRequest
	var decoded alias
	valid, sanitized, err := validateRequestFields(data, []string{
		"correlationId", "parentOperationIds", "triggeringEventIds", "triggeringEventOrder",
		"reactionPassId", "deliveryId", "attemptId", "afterSequence",
	}, func(fields map[string]json.RawMessage) bool {
		return validCausalityFields(fields) && optionalSafeInteger(fields, "afterSequence")
	})
	if err != nil {
		return err
	}
	if err := json.Unmarshal(sanitized, &decoded); err != nil {
		return err
	}
	*request = SubscriptionRequest(decoded)
	request.fieldsValid = valid
	return nil
}

func validateRequestFields(data []byte, optionalNames []string, validate func(map[string]json.RawMessage) bool) (bool, []byte, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return false, nil, err
	}
	if validate(fields) {
		return true, data, nil
	}
	// Remove malformed optional fields so the typed decode can retain the
	// envelope and operation identity used by a correlated structured error.
	for _, name := range optionalNames {
		delete(fields, name)
	}
	sanitized, err := json.Marshal(fields)
	return false, sanitized, err
}

func validCausalityFields(fields map[string]json.RawMessage) bool {
	for _, name := range []string{"correlationId", "reactionPassId", "deliveryId", "attemptId"} {
		if !optionalNonemptyString(fields, name) {
			return false
		}
	}
	for _, name := range []string{"parentOperationIds", "triggeringEventIds"} {
		raw, present := fields[name]
		if !present {
			continue
		}
		var values []string
		if strings.TrimSpace(string(raw)) == "null" || json.Unmarshal(raw, &values) != nil {
			return false
		}
		seen := make(map[string]struct{}, len(values))
		for _, value := range values {
			if value == "" {
				return false
			}
			if _, duplicate := seen[value]; duplicate {
				return false
			}
			seen[value] = struct{}{}
		}
	}
	raw, present := fields["triggeringEventOrder"]
	if !present {
		return true
	}
	var order map[string]json.RawMessage
	if !rawObject(raw) || json.Unmarshal(raw, &order) != nil || !rawInteger(order, "from", true) || !rawInteger(order, "to", true) {
		return false
	}
	var from, to int64
	return json.Unmarshal(order["from"], &from) == nil && json.Unmarshal(order["to"], &to) == nil && safeIntegerValue(from) && safeIntegerValue(to) && to >= from
}

func optionalNonemptyString(fields map[string]json.RawMessage, name string) bool {
	raw, present := fields[name]
	if !present {
		return true
	}
	var value string
	return json.Unmarshal(raw, &value) == nil && value != ""
}

func optionalSafeInteger(fields map[string]json.RawMessage, name string) bool {
	raw, present := fields[name]
	if !present {
		return true
	}
	var value int64
	return strings.TrimSpace(string(raw)) != "null" && json.Unmarshal(raw, &value) == nil && safeIntegerValue(value)
}

func safeIntegerValue(value int64) bool {
	return value >= 0 && value <= 9_007_199_254_740_991
}

type SubscriptionMessage struct {
	Envelope
	OperationID string         `json:"operationId"`
	Sequence    int64          `json:"sequence,omitempty"`
	Result      any            `json:"result,omitempty"`
	Error       *specter.Error `json:"error,omitempty"`
}

// MarshalJSON makes result presence depend on the message kind rather than the
// Go value. This distinguishes a successful JSON null from an absent result.
func (message SubscriptionMessage) MarshalJSON() ([]byte, error) {
	type value struct {
		Envelope
		OperationID string `json:"operationId"`
		Sequence    int64  `json:"sequence"`
		Result      any    `json:"result"`
	}
	if message.Kind == "subscription.value" {
		return json.Marshal(value{Envelope: message.Envelope, OperationID: message.OperationID, Sequence: message.Sequence, Result: message.Result})
	}
	type terminal struct {
		Envelope
		OperationID string         `json:"operationId"`
		Error       *specter.Error `json:"error,omitempty"`
	}
	return json.Marshal(terminal{Envelope: message.Envelope, OperationID: message.OperationID, Error: message.Error})
}

type ReactionTicketResponse struct {
	Envelope
	ReactionTicketID string         `json:"reactionTicketId"`
	Status           string         `json:"status"`
	Error            *specter.Error `json:"error,omitempty"`
}

type RuntimeSource struct {
	Application     string `json:"application"`
	Environment     string `json:"environment"`
	RuntimeLanguage string `json:"runtimeLanguage"`
	RuntimeVersion  string `json:"runtimeVersion"`
	InstanceID      string `json:"instanceId"`
	EventLogID      string `json:"eventLogId"`
}
type RuntimeObservation struct {
	specter.Observation
	Sequence int64         `json:"sequence"`
	Source   RuntimeSource `json:"source"`

	timestampsValid bool
	causalityValid  bool
	typesValid      bool
}

func (observation *RuntimeObservation) UnmarshalJSON(data []byte) error {
	type alias RuntimeObservation
	var decoded alias
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	var raw struct {
		ObservedAt json.RawMessage              `json:"observedAt"`
		Events     []map[string]json.RawMessage `json:"events"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	timestampsValid := isUTCDateTime(raw.ObservedAt)
	typesValid := true
	for _, event := range raw.Events {
		timestampsValid = timestampsValid && isUTCDateTime(event["recordedAt"])
		typesValid = typesValid && rawInteger(event, "order", true) && rawInteger(event, "commitVersion", true)
		if attributes, present := event["attributes"]; present {
			typesValid = typesValid && rawObject(attributes)
		}
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	typesValid = typesValid && rawInteger(fields, "sequence", true) && rawObject(fields["source"])
	for _, name := range []string{"cursor", "droppedCount", "version"} {
		typesValid = typesValid && rawInteger(fields, name, false)
	}
	for _, name := range []string{"parentOperationIds", "triggeringEventIds", "events"} {
		if value, present := fields[name]; present {
			typesValid = typesValid && rawArray(value)
		}
	}
	for _, name := range []string{"attributes", "error"} {
		if value, present := fields[name]; present {
			typesValid = typesValid && rawObject(value)
		}
	}
	if value, present := fields["duplicate"]; present {
		var boolean bool
		typesValid = typesValid && string(value) != "null" && json.Unmarshal(value, &boolean) == nil
	}
	if value, present := fields["triggeringEventOrder"]; present {
		var order map[string]json.RawMessage
		if !rawObject(value) || json.Unmarshal(value, &order) != nil {
			typesValid = false
		} else {
			typesValid = typesValid && rawInteger(order, "from", true) && rawInteger(order, "to", true)
		}
	}
	causalityValid := true
	for _, name := range []string{
		"correlationId", "reactionPassId", "deliveryId", "attemptId",
		"commandType", "queryType", "reaction", "slice", "reactionTicketId", "outcome",
	} {
		if value, present := fields[name]; present {
			var id string
			if err := json.Unmarshal(value, &id); err != nil || id == "" {
				causalityValid = false
			}
		}
	}
	*observation = RuntimeObservation(decoded)
	observation.timestampsValid = timestampsValid
	observation.causalityValid = causalityValid
	observation.typesValid = typesValid
	return nil
}

func rawInteger(fields map[string]json.RawMessage, name string, required bool) bool {
	raw, present := fields[name]
	if !present {
		return !required
	}
	if strings.TrimSpace(string(raw)) == "null" {
		return false
	}
	var value int64
	return json.Unmarshal(raw, &value) == nil
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
	if err := json.Unmarshal(raw, &value); err != nil || !strings.HasSuffix(value, "Z") {
		return false
	}
	_, err := time.Parse(time.RFC3339Nano, value)
	return err == nil
}

type RuntimeObservationBatch struct {
	Envelope
	Observations []RuntimeObservation `json:"observations"`

	fieldsValid bool
}
type ObservationAcknowledgement struct {
	Envelope
	Accepted               int            `json:"accepted"`
	Duplicates             int            `json:"duplicates"`
	RejectedObservationIDs []string       `json:"rejectedObservationIds,omitempty"`
	Error                  *specter.Error `json:"error,omitempty"`
}

func (request *CapabilitiesRequest) UnmarshalJSON(data []byte) error {
	type alias CapabilitiesRequest
	var decoded alias
	valid, sanitized, err := validateRequestFields(data, []string{"required", "optional"}, func(fields map[string]json.RawMessage) bool {
		for _, name := range []string{"required", "optional"} {
			raw, present := fields[name]
			if !present {
				continue
			}
			var capabilities []string
			if !rawArray(raw) || json.Unmarshal(raw, &capabilities) != nil || !validCapabilityList(capabilities) {
				return false
			}
		}
		return true
	})
	if err != nil {
		return err
	}
	if err := json.Unmarshal(sanitized, &decoded); err != nil {
		return err
	}
	*request = CapabilitiesRequest(decoded)
	request.fieldsValid = valid
	return nil
}

func (batch *RuntimeObservationBatch) UnmarshalJSON(data []byte) error {
	type alias RuntimeObservationBatch
	var decoded alias
	valid, sanitized, err := validateRequestFields(data, []string{"observations"}, func(fields map[string]json.RawMessage) bool {
		raw, present := fields["observations"]
		return present && rawArray(raw)
	})
	if err != nil {
		return err
	}
	if err := json.Unmarshal(sanitized, &decoded); err != nil {
		return err
	}
	*batch = RuntimeObservationBatch(decoded)
	batch.fieldsValid = valid
	return nil
}

func validCapabilityList(capabilities []string) bool {
	seen := make(map[string]struct{}, len(capabilities))
	for _, capability := range capabilities {
		if capability == "" {
			return false
		}
		if _, duplicate := seen[capability]; duplicate {
			return false
		}
		seen[capability] = struct{}{}
	}
	return true
}
