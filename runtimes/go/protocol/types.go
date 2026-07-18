// Package protocol implements the Specter protocol v1 JSON binding.
package protocol

import (
	"encoding/json"
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
	Result      any            `json:"result"`
	Error       *specter.Error `json:"error,omitempty"`
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
	Result      any            `json:"result"`
	Error       *specter.Error `json:"error,omitempty"`
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
