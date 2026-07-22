package protocol

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/big"
	"strings"

	"github.com/devagrawal09/specter/runtimes/go/specter"
)

const maxSafeInteger int64 = 9_007_199_254_740_991

var observationKinds = map[string]struct{}{
	"command.started": {}, "command.completed": {}, "command.rejected": {}, "command.failed": {},
	"query.started": {}, "query.completed": {}, "query.rejected": {}, "query.failed": {},
	"events.persisted":       {},
	"slice.catch-up.started": {}, "slice.catch-up.completed": {}, "slice.catch-up.failed": {},
	"subscription.invalidated": {},
	"replay.started":           {}, "replay.completed": {}, "replay.failed": {},
	"reaction.pass.started": {}, "reaction.pass.completed": {}, "reaction.pass.failed": {},
	"reaction.run.started": {}, "reaction.run.completed": {}, "reaction.run.failed": {},
	"outbox.enqueued": {}, "outbox.attempted": {}, "outbox.retry-scheduled": {}, "outbox.dead-lettered": {},
	"telemetry.dropped": {},
}

// ValidateMessageJSON validates either message family in the observation
// protocol while ignoring unknown optional fields.
func ValidateMessageJSON(data []byte) error {
	if !json.Valid(data) {
		return &specter.Error{Code: specter.ErrInvalidJSON, Message: "Malformed JSON message."}
	}
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.UseNumber()
	var jsonValue any
	if decoder.Decode(&jsonValue) != nil || !validateJSONValue(jsonValue) {
		return invalidMessage("Protocol messages must contain JSON-safe values.")
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil || fields == nil {
		return invalidMessage("Protocol message must be an object.")
	}
	if !rawInteger(fields, "protocolVersion", true) {
		return invalidMessage("protocolVersion must be a non-negative JSON-safe integer.")
	}
	var envelope Envelope
	if err := json.Unmarshal(data, &envelope); err != nil {
		return invalidMessage("Protocol envelope fields do not match the protocol types.")
	}
	switch envelope.Kind {
	case "observations.batch":
		var batch RuntimeObservationBatch
		if err := json.Unmarshal(data, &batch); err != nil {
			return invalidMessage("Observation batch fields do not match the protocol types.")
		}
		return ValidateObservationBatch(batch)
	case "observations.ack":
		if failure := validateEnvelope(envelope, "observations.ack"); failure != nil {
			return failure
		}
		var acknowledgement ObservationAcknowledgement
		if err := json.Unmarshal(data, &acknowledgement); err != nil {
			return invalidMessage("Observation acknowledgement fields do not match the protocol types.")
		}
		return validateObservationAcknowledgementShape(acknowledgement, fields)
	default:
		return invalidMessage("Unknown observation protocol message kind.")
	}
}

// ValidateObservationBatch checks the language-neutral wire contract before a
// producer sends a batch. Unknown optional JSON fields are intentionally ignored.
func ValidateObservationBatch(batch RuntimeObservationBatch) error {
	if failure := validateEnvelope(batch.Envelope, "observations.batch"); failure != nil {
		return failure
	}
	if batch.decoded && !batch.fieldsValid {
		return invalidMessage("observations must be present and contain an array.")
	}
	if batch.Observations == nil {
		return invalidMessage("observations must contain an array.")
	}
	if len(batch.Observations) > 100 {
		return invalidMessage("Observation batches may contain at most 100 observations.")
	}
	for _, observation := range batch.Observations {
		if failure := validateObservation(observation); failure != nil {
			return failure
		}
	}
	return nil
}

func validateObservation(observation RuntimeObservation) *specter.Error {
	if observation.ObservationID == "" || observation.OperationID == "" || !safeInteger(observation.Sequence) || observation.ObservedAt.IsZero() || observation.Kind == "" {
		return invalidMessage("Observation identity, safe sequence, timestamp, kind, and operationId are required.")
	}
	if _, offset := observation.ObservedAt.Zone(); offset != 0 {
		return invalidMessage("Observation timestamp must be UTC.")
	}
	if observation.decoded && (!observation.fieldsValid || !observation.timestampValid || !observation.attributesValid || !observation.errorValid) {
		return invalidMessage("Observation fields do not match the protocol types.")
	}
	if _, ok := observationKinds[observation.Kind]; !ok {
		return invalidMessage("Unknown runtime observation kind.")
	}
	source := observation.Source
	if source.Application == "" || source.Environment == "" || source.RuntimeLanguage == "" || source.RuntimeVersion == "" || source.InstanceID == "" || source.EventLogID == "" {
		return invalidMessage("Observation source fields are required.")
	}
	if !uniqueNonempty(observation.ParentOperationIDs) || !uniqueNonempty(observation.TriggeringEventIDs) {
		return invalidMessage("Observation causal IDs must be nonempty and unique.")
	}
	if order := observation.TriggeringEventOrder; order != nil && (!safeInteger(order.From) || !safeInteger(order.To) || order.To < order.From) {
		return invalidMessage("Observation triggering Event order range is invalid.")
	}
	if !safeInteger(observation.Cursor) || !safeInteger(observation.DroppedCount) {
		return invalidMessage("Observation cursor and dropped count must be safe integers.")
	}
	previousEventOrder := int64(-1)
	for _, event := range observation.Events {
		if event.EventID == "" || event.Type == "" || event.RecordedAt.IsZero() || !safeInteger(event.Order) || !safeInteger(event.CommitVersion) {
			return invalidMessage("Observation Event references require identity, UTC timestamp, and safe order and version.")
		}
		if int64(event.Order) <= previousEventOrder {
			return invalidMessage("Observation Event references must be strictly ascending by Event order.")
		}
		previousEventOrder = int64(event.Order)
		if _, offset := event.RecordedAt.Zone(); offset != 0 {
			return invalidMessage("Observation Event timestamps must be UTC.")
		}
		if event.decoded && (!event.fieldsValid || !event.timestampValid || !event.attributesValid) {
			return invalidMessage("Observation Event fields do not match the protocol types.")
		}
		if event.Attributes != nil && !validateJSONValue(event.Attributes) {
			return invalidMessage("Observation Event attributes must contain JSON values with safe integers.")
		}
	}
	if observation.Error != nil && (observation.Error.Code == "" || observation.Error.Message == "" || !validateJSONValue(observation.Error.Details)) {
		return invalidMessage("Observation errors require a code and message.")
	}
	if observation.Attributes != nil && !validateJSONValue(observation.Attributes) {
		return invalidMessage("Observation attributes must contain JSON values with safe integers.")
	}
	if observation.Outcome != "" && observation.Outcome != "succeeded" && observation.Outcome != "rejected" && observation.Outcome != "failed" {
		return invalidMessage("Observation outcome is invalid.")
	}
	return nil
}

func validateObservationAcknowledgement(batch RuntimeObservationBatch, acknowledgement ObservationAcknowledgement, fields map[string]json.RawMessage) error {
	if err := validateObservationAcknowledgementShape(acknowledgement, fields); err != nil {
		return err
	}
	observationIDs := make(map[string]struct{}, len(batch.Observations))
	for _, observation := range batch.Observations {
		observationIDs[observation.ObservationID] = struct{}{}
	}
	rejected := make(map[string]struct{}, len(acknowledgement.RejectedObservationIDs))
	for _, id := range acknowledgement.RejectedObservationIDs {
		if _, exists := observationIDs[id]; !exists {
			return fmt.Errorf("specter protocol: acknowledgement rejected an observation outside the batch")
		}
		rejected[id] = struct{}{}
	}
	accounted := int(acknowledgement.Accepted) + int(acknowledgement.Duplicates) + len(rejected)
	if accounted != len(batch.Observations) {
		return fmt.Errorf("specter protocol: acknowledgement accounts for %d of %d observations", accounted, len(batch.Observations))
	}
	return nil
}

func validateObservationAcknowledgementShape(acknowledgement ObservationAcknowledgement, fields map[string]json.RawMessage) error {
	if !hasFields(fields, "accepted", "duplicates") || !rawInteger(fields, "accepted", true) || !rawInteger(fields, "duplicates", true) || !safeInteger(acknowledgement.Accepted) || !safeInteger(acknowledgement.Duplicates) {
		return invalidMessage("Observation acknowledgement counts must be non-negative safe integers.")
	}
	if raw, present := fields["rejectedObservationIds"]; present && !rawArray(raw) {
		return invalidMessage("rejectedObservationIds must be an array when present.")
	}
	rejected := make(map[string]struct{}, len(acknowledgement.RejectedObservationIDs))
	for _, id := range acknowledgement.RejectedObservationIDs {
		if id == "" {
			return invalidMessage("Rejected observation IDs must be nonempty.")
		}
		if _, duplicate := rejected[id]; duplicate {
			return invalidMessage("Rejected observation IDs must be unique.")
		}
		rejected[id] = struct{}{}
	}
	return nil
}

func validateEnvelope(envelope Envelope, kind string) *specter.Error {
	if envelope.ProtocolVersion != Version {
		return &specter.Error{Code: specter.ErrProtocolVersionMismatch, Message: fmt.Sprintf("Unsupported protocol major version %d; expected %d.", envelope.ProtocolVersion, Version)}
	}
	if envelope.Kind != kind {
		return invalidMessage(fmt.Sprintf("Expected message kind %q.", kind))
	}
	if envelope.RequestID == "" {
		return invalidMessage("requestId is required.")
	}
	return nil
}

func invalidMessage(message string) *specter.Error {
	return &specter.Error{Code: specter.ErrInvalidMessage, Message: message}
}

func safeInteger(value SafeInteger) bool {
	return value >= 0 && int64(value) <= maxSafeInteger
}

func validateJSONValue(value any) bool {
	data, err := json.Marshal(value)
	if err != nil {
		return false
	}
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.UseNumber()
	var normalized any
	if decoder.Decode(&normalized) != nil {
		return false
	}
	return validateDecodedJSONValue(normalized)
}

func validateDecodedJSONValue(value any) bool {
	if value == nil {
		return true
	}
	switch typed := value.(type) {
	case string, bool:
		return true
	case json.Number:
		if exact, ok := new(big.Rat).SetString(typed.String()); ok && exact.IsInt() {
			absolute := new(big.Int).Abs(exact.Num())
			return absolute.Cmp(big.NewInt(maxSafeInteger)) <= 0
		}
		float, err := typed.Float64()
		return err == nil && validateJSONFloat(float)
	case float32:
		return validateJSONFloat(float64(typed))
	case float64:
		return validateJSONFloat(typed)
	case map[string]any:
		for _, item := range typed {
			if !validateDecodedJSONValue(item) {
				return false
			}
		}
		return true
	case []any:
		for _, item := range typed {
			if !validateDecodedJSONValue(item) {
				return false
			}
		}
		return true
	}
	return false
}

func validateJSONFloat(value float64) bool {
	if math.IsInf(value, 0) || math.IsNaN(value) {
		return false
	}
	return math.Trunc(value) != value || math.Abs(value) <= float64(maxSafeInteger)
}

func uniqueNonempty(ids []string) bool {
	seen := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		if id == "" {
			return false
		}
		if _, duplicate := seen[id]; duplicate {
			return false
		}
		seen[id] = struct{}{}
	}
	return true
}

func hasFields(fields map[string]json.RawMessage, names ...string) bool {
	for _, name := range names {
		if _, present := fields[name]; !present {
			return false
		}
	}
	return true
}

// SanitizeObservationError reduces a runtime failure to telemetry-safe data.
func SanitizeObservationError(err error) *StructuredError {
	var public *specter.Error
	if errors.As(err, &public) {
		if message, ok := observationErrorMessages[public.Code]; ok {
			return &StructuredError{Code: string(public.Code), Message: message}
		}
	}
	return &StructuredError{Code: string(specter.ErrInfrastructure), Message: "Runtime operation failed."}
}

var observationErrorMessages = map[specter.ErrorCode]string{
	specter.ErrCommandRejected:     "Command was rejected.",
	specter.ErrConformanceFailed:   "Runtime conformance failed.",
	specter.ErrIdempotencyConflict: "The idempotency key conflicts with an earlier Command.",
	specter.ErrInfrastructure:      "Runtime operation failed.",
	specter.ErrInvalidInput:        "Operation input is invalid.",
	specter.ErrInvalidOutput:       "Operation output is invalid.",
	specter.ErrReactionFailure:     "One or more Reactions failed.",
	specter.ErrUnknownCommand:      "Command type is not registered.",
	specter.ErrUnknownEvent:        "Event type is not registered.",
	specter.ErrUnknownQuery:        "Query type is not registered.",
	specter.ErrVersionConflict:     "Event Log version conflict.",
}
