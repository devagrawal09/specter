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
	Command              OperationEnvelope        `json:"command"`
	IdempotencyKey       string                   `json:"idempotencyKey,omitempty"`
	ExpectedVersion      *int64                   `json:"expectedVersion,omitempty"`
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
	Query                OperationEnvelope        `json:"query"`
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
	Query                OperationEnvelope        `json:"query"`
	AfterSequence        *int64                   `json:"afterSequence,omitempty"`
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
}

func (observation *RuntimeObservation) UnmarshalJSON(data []byte) error {
	type alias RuntimeObservation
	var decoded alias
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	var raw struct {
		ObservedAt json.RawMessage `json:"observedAt"`
		Events     []struct {
			RecordedAt json.RawMessage `json:"recordedAt"`
		} `json:"events"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	timestampsValid := isUTCDateTime(raw.ObservedAt)
	for _, event := range raw.Events {
		timestampsValid = timestampsValid && isUTCDateTime(event.RecordedAt)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	causalityValid := true
	for _, name := range []string{"correlationId", "reactionPassId", "deliveryId", "attemptId"} {
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
	return nil
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
}
type ObservationAcknowledgement struct {
	Envelope
	Accepted               int            `json:"accepted"`
	Duplicates             int            `json:"duplicates"`
	RejectedObservationIDs []string       `json:"rejectedObservationIds,omitempty"`
	Error                  *specter.Error `json:"error,omitempty"`
}
