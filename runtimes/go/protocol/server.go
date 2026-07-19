package protocol

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"strings"

	"github.com/devagrawal09/specter/runtimes/go/specter"
)

type ObservationSink func(context.Context, RuntimeObservationBatch) (ObservationAcknowledgement, error)

const maxSafeInteger int64 = 9_007_199_254_740_991

type Server struct {
	App                *specter.App
	RuntimeVersion     string
	Capabilities       []string
	AcceptObservations ObservationSink
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /specter/v1/capabilities", s.capabilitiesGet)
	mux.HandleFunc("POST /specter/v1/capabilities", s.capabilities)
	mux.HandleFunc("POST /specter/v1/commands", s.command)
	mux.HandleFunc("POST /specter/v1/queries", s.query)
	mux.HandleFunc("POST /specter/v1/subscriptions", s.subscription)
	mux.HandleFunc("GET /specter/v1/reaction-tickets/{id}", s.reactionTicket)
	mux.HandleFunc("POST /specter/v1/observations", s.observations)
	return mux
}

func (s *Server) availableCapabilities() []string {
	if s.Capabilities != nil {
		return append([]string(nil), s.Capabilities...)
	}
	return append([]string(nil), GoCapabilities...)
}

func (s *Server) capabilities(w http.ResponseWriter, r *http.Request) {
	var request CapabilitiesRequest
	if !decode(w, r, &request) {
		return
	}
	if failure := validateEnvelope(request.Envelope, "capabilities.request"); failure != nil {
		writeJSON(w, protocolErrorStatus(failure), CapabilitiesResponse{Envelope: responseEnvelope(request.Envelope, "capabilities.response"), Error: failure})
		return
	}
	available := s.availableCapabilities()
	set := map[string]struct{}{}
	for _, capability := range available {
		set[capability] = struct{}{}
	}
	missing := []string{}
	for _, required := range request.Required {
		if _, ok := set[required]; !ok {
			missing = append(missing, required)
		}
	}
	if len(missing) > 0 {
		writeJSON(w, http.StatusBadRequest, CapabilitiesResponse{Envelope: responseEnvelope(request.Envelope, "capabilities.response"), Error: &specter.Error{Code: specter.ErrUnsupportedCapability, Message: "Required capabilities are unsupported.", Details: map[string]any{"missing": missing}}})
		return
	}
	negotiated := []string{}
	seen := map[string]struct{}{}
	for _, requested := range append(append([]string(nil), request.Required...), request.Optional...) {
		if _, ok := set[requested]; ok {
			if _, duplicate := seen[requested]; !duplicate {
				seen[requested] = struct{}{}
				negotiated = append(negotiated, requested)
			}
		}
	}
	writeJSON(w, http.StatusOK, CapabilitiesResponse{Envelope: responseEnvelope(request.Envelope, "capabilities.response"), Runtime: RuntimeDescriptor{Language: "go", Version: s.RuntimeVersion}, Supported: available, Negotiated: negotiated})
}

func (s *Server) capabilitiesGet(w http.ResponseWriter, r *http.Request) {
	requestID := r.URL.Query().Get("requestId")
	if requestID == "" {
		requestID = newRequestID()
	}
	request := Envelope{ProtocolVersion: Version, Kind: "capabilities.request", RequestID: requestID}
	writeJSON(w, http.StatusOK, CapabilitiesResponse{Envelope: responseEnvelope(request, "capabilities.response"), Runtime: RuntimeDescriptor{Language: "go", Version: s.RuntimeVersion}, Supported: s.availableCapabilities(), Negotiated: []string{}})
}

func (s *Server) command(w http.ResponseWriter, r *http.Request) {
	var request CommandRequest
	if !decode(w, r, &request) {
		return
	}
	if failure := validateEnvelope(request.Envelope, "command.request"); failure != nil {
		writeJSON(w, protocolErrorStatus(failure), CommandResponse{Envelope: responseEnvelope(request.Envelope, "command.response"), OperationID: request.OperationID, Status: "rejected", Events: []EventReference{}, Error: failure})
		return
	}
	if !request.fieldsValid {
		writeJSON(w, http.StatusBadRequest, CommandResponse{Envelope: responseEnvelope(request.Envelope, "command.response"), OperationID: request.OperationID, Status: "rejected", Events: []EventReference{}, Error: &specter.Error{Code: specter.ErrInvalidMessage, Message: "Command request optional fields are invalid."}})
		return
	}
	if request.OperationID == "" || request.Command.Type == "" || len(request.Command.Payload) == 0 {
		writeJSON(w, http.StatusBadRequest, CommandResponse{Envelope: responseEnvelope(request.Envelope, "command.response"), OperationID: request.OperationID, Status: "rejected", Events: []EventReference{}, Error: &specter.Error{Code: specter.ErrInvalidMessage, Message: "operationId and command type/payload are required."}})
		return
	}
	if request.ExpectedVersion != nil && (*request.ExpectedVersion < 0 || *request.ExpectedVersion > maxSafeInteger) {
		writeJSON(w, http.StatusBadRequest, CommandResponse{Envelope: responseEnvelope(request.Envelope, "command.response"), OperationID: request.OperationID, Status: "rejected", Events: []EventReference{}, Error: &specter.Error{Code: specter.ErrInvalidMessage, Message: "expectedVersion must be a non-negative safe integer."}})
		return
	}
	execution, err := s.App.CommandJSON(r.Context(), request.Command.Type, request.Command.Payload, specter.DispatchOptions{OperationID: request.OperationID, CorrelationID: request.CorrelationID, ParentOperationIDs: request.ParentOperationIDs, TriggeringEventIDs: request.TriggeringEventIDs, TriggeringEventOrder: request.TriggeringEventOrder, ReactionPassID: request.ReactionPassID, DeliveryID: request.DeliveryID, AttemptID: request.AttemptID, IdempotencyKey: request.IdempotencyKey, ExpectedVersion: request.ExpectedVersion})
	if err != nil {
		public := PublicError(err)
		status := "rejected"
		if public.Code != specter.ErrCommandRejected {
			status = "rejected"
		}
		writeJSON(w, http.StatusOK, CommandResponse{Envelope: responseEnvelope(request.Envelope, "command.response"), OperationID: request.OperationID, Status: status, Version: s.App.EventLog().Version(), Events: []EventReference{}, Error: public})
		return
	}
	events := make([]EventReference, len(execution.Events))
	for i, event := range execution.Events {
		events[i] = EventReference{EventID: event.ID, Type: event.Type, Order: event.GlobalOrder, CommitVersion: event.CommitVersion, RecordedAt: event.RecordedAt, Attributes: event.Attributes}
	}
	status := "committed"
	if execution.Duplicate {
		status = "duplicate"
	}
	writeJSON(w, http.StatusOK, CommandResponse{Envelope: responseEnvelope(request.Envelope, "command.response"), OperationID: execution.OperationID, Status: status, Version: execution.Version, Events: events, ReactionTicketID: execution.ReactionTicketID})
}

func (s *Server) query(w http.ResponseWriter, r *http.Request) {
	var request QueryRequest
	if !decode(w, r, &request) {
		return
	}
	if failure := validateEnvelope(request.Envelope, "query.request"); failure != nil {
		writeJSON(w, protocolErrorStatus(failure), QueryResponse{Envelope: responseEnvelope(request.Envelope, "query.response"), OperationID: request.OperationID, Error: failure})
		return
	}
	if !request.fieldsValid {
		writeJSON(w, http.StatusBadRequest, QueryResponse{Envelope: responseEnvelope(request.Envelope, "query.response"), OperationID: request.OperationID, Error: &specter.Error{Code: specter.ErrInvalidMessage, Message: "Query request optional fields are invalid."}})
		return
	}
	if request.OperationID == "" || request.Query.Type == "" || len(request.Query.Payload) == 0 {
		writeJSON(w, http.StatusBadRequest, QueryResponse{Envelope: responseEnvelope(request.Envelope, "query.response"), OperationID: request.OperationID, Error: &specter.Error{Code: specter.ErrInvalidMessage, Message: "operationId and query type/payload are required."}})
		return
	}
	result, err := s.App.QueryJSON(r.Context(), request.Query.Type, request.Query.Payload, specter.DispatchOptions{OperationID: request.OperationID, CorrelationID: request.CorrelationID, ParentOperationIDs: request.ParentOperationIDs, TriggeringEventIDs: request.TriggeringEventIDs, TriggeringEventOrder: request.TriggeringEventOrder, ReactionPassID: request.ReactionPassID, DeliveryID: request.DeliveryID, AttemptID: request.AttemptID})
	if err != nil {
		writeJSON(w, http.StatusOK, QueryResponse{Envelope: responseEnvelope(request.Envelope, "query.response"), OperationID: request.OperationID, Error: PublicError(err)})
		return
	}
	writeJSON(w, http.StatusOK, QueryResponse{Envelope: responseEnvelope(request.Envelope, "query.response"), OperationID: request.OperationID, Result: result})
}

func (s *Server) subscription(w http.ResponseWriter, r *http.Request) {
	var request SubscriptionRequest
	if !decode(w, r, &request) {
		return
	}
	if failure := validateEnvelope(request.Envelope, "subscription.request"); failure != nil {
		writeJSON(w, protocolErrorStatus(failure), SubscriptionMessage{Envelope: responseEnvelope(request.Envelope, "subscription.error"), OperationID: request.OperationID, Error: failure})
		return
	}
	if !request.fieldsValid {
		writeJSON(w, http.StatusBadRequest, SubscriptionMessage{Envelope: responseEnvelope(request.Envelope, "subscription.error"), OperationID: request.OperationID, Error: &specter.Error{Code: specter.ErrInvalidMessage, Message: "Subscription request optional fields are invalid."}})
		return
	}
	if request.OperationID == "" || request.Query.Type == "" || len(request.Query.Payload) == 0 {
		writeJSON(w, http.StatusBadRequest, SubscriptionMessage{Envelope: responseEnvelope(request.Envelope, "subscription.error"), OperationID: request.OperationID, Error: &specter.Error{Code: specter.ErrInvalidMessage, Message: "operationId and query type/payload are required."}})
		return
	}
	if request.AfterSequence != nil && (*request.AfterSequence < 0 || *request.AfterSequence > maxSafeInteger) {
		writeJSON(w, http.StatusBadRequest, SubscriptionMessage{Envelope: responseEnvelope(request.Envelope, "subscription.error"), OperationID: request.OperationID, Error: &specter.Error{Code: specter.ErrInvalidMessage, Message: "afterSequence must be a non-negative safe integer."}})
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	sub, err := s.App.SubscribeJSON(r.Context(), request.Query.Type, request.Query.Payload, specter.DispatchOptions{OperationID: request.OperationID, CorrelationID: request.CorrelationID, ParentOperationIDs: request.ParentOperationIDs, TriggeringEventIDs: request.TriggeringEventIDs, TriggeringEventOrder: request.TriggeringEventOrder, ReactionPassID: request.ReactionPassID, DeliveryID: request.DeliveryID, AttemptID: request.AttemptID})
	if err != nil {
		writeJSON(w, http.StatusBadRequest, SubscriptionMessage{Envelope: responseEnvelope(request.Envelope, "subscription.error"), OperationID: request.OperationID, Error: PublicError(err)})
		return
	}
	defer sub.Close()
	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Specter-Protocol-Version", "1")
	w.WriteHeader(http.StatusOK)
	sequence := int64(0)
	if request.AfterSequence != nil {
		sequence = *request.AfterSequence
	}
	for {
		select {
		case <-r.Context().Done():
			return
		case item, open := <-sub.C:
			if !open {
				message := SubscriptionMessage{Envelope: responseEnvelope(request.Envelope, "subscription.complete"), OperationID: request.OperationID}
				bytes, _ := json.Marshal(message)
				_, _ = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", message.Kind, bytes)
				flusher.Flush()
				return
			}
			sequence++
			kind := "subscription.value"
			message := SubscriptionMessage{Envelope: responseEnvelope(request.Envelope, kind), OperationID: request.OperationID, Sequence: sequence, Result: item.Value}
			if item.Err != nil {
				message.Kind = "subscription.error"
				message.Error = PublicError(item.Err)
				message.Result = nil
				message.Sequence = 0
			}
			bytes, _ := json.Marshal(message)
			_, _ = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", message.Kind, bytes)
			flusher.Flush()
			if item.Err != nil {
				return
			}
		}
	}
}

func (s *Server) reactionTicket(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	requestID := r.URL.Query().Get("requestId")
	if requestID == "" {
		requestID = newRequestID()
	}
	request := Envelope{ProtocolVersion: Version, Kind: "reaction-ticket.request", RequestID: requestID}
	status, ok := s.App.ReactionTicket(id)
	if !ok {
		writeJSON(w, http.StatusNotFound, ReactionTicketResponse{Envelope: responseEnvelope(request, "reaction-ticket.response"), ReactionTicketID: id, Status: "failed", Error: &specter.Error{Code: specter.ErrReactionTicketNotFound, Message: "Reaction ticket was not found or expired."}})
		return
	}
	writeJSON(w, http.StatusOK, ReactionTicketResponse{Envelope: responseEnvelope(request, "reaction-ticket.response"), ReactionTicketID: id, Status: status.Status, Error: status.Error})
}

func (s *Server) observations(w http.ResponseWriter, r *http.Request) {
	var request RuntimeObservationBatch
	if !decode(w, r, &request) {
		return
	}
	if failure := validateEnvelope(request.Envelope, "observations.batch"); failure != nil {
		writeJSON(w, protocolErrorStatus(failure), ObservationAcknowledgement{Envelope: responseEnvelope(request.Envelope, "observations.ack"), Error: failure})
		return
	}
	if len(request.Observations) > 100 {
		writeJSON(w, http.StatusBadRequest, ObservationAcknowledgement{Envelope: responseEnvelope(request.Envelope, "observations.ack"), Error: &specter.Error{Code: specter.ErrInvalidMessage, Message: "Observation batches may contain at most 100 observations."}})
		return
	}
	for _, observation := range request.Observations {
		if failure := validateObservation(observation); failure != nil {
			writeJSON(w, http.StatusBadRequest, ObservationAcknowledgement{Envelope: responseEnvelope(request.Envelope, "observations.ack"), Error: failure})
			return
		}
	}
	if s.AcceptObservations == nil {
		writeJSON(w, http.StatusNotImplemented, ObservationAcknowledgement{Envelope: responseEnvelope(request.Envelope, "observations.ack"), Error: &specter.Error{Code: specter.ErrInfrastructure, Message: "This runtime does not accept observations."}})
		return
	}
	ack, err := s.AcceptObservations(r.Context(), request)
	ack.Envelope = responseEnvelope(request.Envelope, "observations.ack")
	if err != nil {
		ack.Error = PublicError(err)
		writeJSON(w, http.StatusInternalServerError, ack)
		return
	}
	writeJSON(w, http.StatusOK, ack)
}

var observationKinds = map[string]struct{}{"command.started": {}, "command.completed": {}, "command.rejected": {}, "command.failed": {}, "query.started": {}, "query.completed": {}, "query.rejected": {}, "query.failed": {}, "events.persisted": {}, "slice.catch-up.started": {}, "slice.catch-up.completed": {}, "slice.catch-up.failed": {}, "subscription.invalidated": {}, "replay.started": {}, "replay.completed": {}, "replay.failed": {}, "reaction.pass.started": {}, "reaction.pass.completed": {}, "reaction.pass.failed": {}, "reaction.run.started": {}, "reaction.run.completed": {}, "reaction.run.failed": {}, "outbox.enqueued": {}, "outbox.attempted": {}, "outbox.retry-scheduled": {}, "outbox.dead-lettered": {}, "telemetry.dropped": {}}

func validateObservation(observation RuntimeObservation) *specter.Error {
	if observation.ObservationID == "" || observation.OperationID == "" || !safeInteger(observation.Sequence) || observation.ObservedAt.IsZero() || !observation.timestampsValid || !observation.typesValid || observation.Kind == "" {
		return &specter.Error{Code: specter.ErrInvalidMessage, Message: "Observation identity, safe sequence, timestamp, kind, and operationId are required."}
	}
	if _, ok := observationKinds[observation.Kind]; !ok {
		return &specter.Error{Code: specter.ErrInvalidMessage, Message: "Unknown runtime observation kind."}
	}
	source := observation.Source
	if source.Application == "" || source.Environment == "" || source.RuntimeLanguage == "" || source.RuntimeVersion == "" || source.InstanceID == "" || source.EventLogID == "" {
		return &specter.Error{Code: specter.ErrInvalidMessage, Message: "Observation source fields are required."}
	}
	if !observation.causalityValid || !uniqueNonempty(observation.ParentOperationIDs) || !uniqueNonempty(observation.TriggeringEventIDs) {
		return &specter.Error{Code: specter.ErrInvalidMessage, Message: "Observation causal IDs must be nonempty and unique."}
	}
	if order := observation.TriggeringEventOrder; order != nil && (!safeInteger(order.From) || !safeInteger(order.To) || order.To < order.From) {
		return &specter.Error{Code: specter.ErrInvalidMessage, Message: "Observation triggering Event order range is invalid."}
	}
	if !safeInteger(observation.Cursor) || !safeInteger(observation.DroppedCount) || !safeInteger(observation.Version) {
		return &specter.Error{Code: specter.ErrInvalidMessage, Message: "Observation cursor, dropped count, and version must be safe integers."}
	}
	for _, event := range observation.Events {
		if event.EventID == "" || event.Type == "" || event.RecordedAt.IsZero() || !safeInteger(event.Order) || !safeInteger(event.CommitVersion) {
			return &specter.Error{Code: specter.ErrInvalidMessage, Message: "Observation Event references require identity, UTC timestamp, and safe order and version."}
		}
	}
	if observation.Error != nil && (observation.Error.Code == "" || observation.Error.Message == "") {
		return &specter.Error{Code: specter.ErrInvalidMessage, Message: "Observation errors require a code and message."}
	}
	if observation.Outcome != "" && observation.Outcome != "succeeded" && observation.Outcome != "rejected" && observation.Outcome != "failed" {
		return &specter.Error{Code: specter.ErrInvalidMessage, Message: "Observation outcome is invalid."}
	}
	return nil
}

func safeInteger(value int64) bool {
	return value >= 0 && value <= maxSafeInteger
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

func validateEnvelope(envelope Envelope, kind string) *specter.Error {
	if envelope.ProtocolVersion != Version {
		return &specter.Error{Code: specter.ErrProtocolVersionMismatch, Message: fmt.Sprintf("Unsupported protocol major version %d; expected %d.", envelope.ProtocolVersion, Version)}
	}
	if envelope.Kind != kind {
		return &specter.Error{Code: specter.ErrInvalidMessage, Message: fmt.Sprintf("Expected message kind %q.", kind)}
	}
	if strings.TrimSpace(envelope.RequestID) == "" {
		return &specter.Error{Code: specter.ErrInvalidMessage, Message: "requestId is required."}
	}
	return nil
}
func responseEnvelope(request Envelope, kind string) Envelope {
	return Envelope{ProtocolVersion: Version, Kind: kind, RequestID: request.RequestID}
}
func decode(w http.ResponseWriter, r *http.Request, out any) bool {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		writeJSON(w, http.StatusUnsupportedMediaType, map[string]any{"error": &specter.Error{Code: specter.ErrInvalidMessage, Message: "Content-Type must be application/json."}})
		return false
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	if err := decoder.Decode(out); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": &specter.Error{Code: specter.ErrInvalidJSON, Message: "Malformed JSON request."}})
		return false
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": &specter.Error{Code: specter.ErrInvalidJSON, Message: "Malformed JSON request."}})
		return false
	}
	return true
}

func protocolErrorStatus(failure *specter.Error) int {
	if failure != nil && failure.Code == specter.ErrProtocolVersionMismatch {
		return http.StatusUpgradeRequired
	}
	return http.StatusBadRequest
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Specter-Protocol-Version", "1")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

// PublicError reduces a runtime failure to the stable, transport-safe protocol shape.
// It deliberately discards caller-provided messages, details, and causes.
func PublicError(err error) *specter.Error {
	var public *specter.Error
	if errors.As(err, &public) {
		if message, ok := publicErrorMessages[public.Code]; ok {
			return &specter.Error{Code: public.Code, Message: message}
		}
	}
	return &specter.Error{Code: specter.ErrInfrastructure, Message: "Runtime operation failed."}
}

var publicErrorMessages = map[specter.ErrorCode]string{
	specter.ErrCommandRejected:         "Command was rejected.",
	specter.ErrConformanceFailed:       "Runtime conformance failed.",
	specter.ErrIdempotencyConflict:     "The idempotency key conflicts with an earlier Command.",
	specter.ErrInfrastructure:          "Runtime operation failed.",
	specter.ErrInvalidInput:            "Operation input is invalid.",
	specter.ErrInvalidJSON:             "Request body must be valid JSON.",
	specter.ErrInvalidMessage:          "Protocol message is invalid.",
	specter.ErrInvalidOutput:           "Operation output is invalid.",
	specter.ErrProtocolVersionMismatch: "Protocol major version is unsupported.",
	specter.ErrReactionFailure:         "One or more Reactions failed.",
	specter.ErrReactionTicketNotFound:  "Reaction ticket was not found or expired.",
	specter.ErrRouteNotFound:           "Route not found.",
	specter.ErrTransportFailure:        "Transport operation failed.",
	specter.ErrUnknownCommand:          "Command type is not registered.",
	specter.ErrUnknownEvent:            "Event type is not registered.",
	specter.ErrUnknownQuery:            "Query type is not registered.",
	specter.ErrUnsupportedCapability:   "A required capability is unsupported.",
	specter.ErrVersionConflict:         "Event Log version conflict.",
}
