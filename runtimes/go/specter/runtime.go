package specter

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

type Observation struct {
	ObservationID        string           `json:"observationId"`
	Kind                 string           `json:"kind"`
	ObservedAt           time.Time        `json:"observedAt"`
	OperationID          string           `json:"operationId,omitempty"`
	CorrelationID        string           `json:"correlationId,omitempty"`
	ParentOperationIDs   []string         `json:"parentOperationIds,omitempty"`
	TriggeringEventIDs   []string         `json:"triggeringEventIds,omitempty"`
	TriggeringEventOrder *EventOrderRange `json:"triggeringEventOrder,omitempty"`
	ReactionPassID       string           `json:"reactionPassId,omitempty"`
	CommandType          string           `json:"commandType,omitempty"`
	QueryType            string           `json:"queryType,omitempty"`
	ReactionName         string           `json:"reaction,omitempty"`
	Slice                string           `json:"slice,omitempty"`
	Cursor               int64            `json:"cursor,omitempty"`
	ReactionTicketID     string           `json:"reactionTicketId,omitempty"`
	DeliveryID           string           `json:"deliveryId,omitempty"`
	AttemptID            string           `json:"attemptId,omitempty"`
	Events               []EventReference `json:"events,omitempty"`
	Version              int64            `json:"version,omitempty"`
	Duplicate            bool             `json:"duplicate,omitempty"`
	Error                *Error           `json:"error,omitempty"`
	Attributes           map[string]any   `json:"attributes,omitempty"`
	DroppedCount         int64            `json:"droppedCount,omitempty"`
}

type EventReference struct {
	EventID       string         `json:"eventId"`
	Type          string         `json:"type"`
	Order         int64          `json:"order"`
	CommitVersion int64          `json:"commitVersion"`
	RecordedAt    time.Time      `json:"recordedAt"`
	Attributes    map[string]any `json:"attributes,omitempty"`
}
type EventOrderRange struct {
	From int64 `json:"from"`
	To   int64 `json:"to"`
}

type Observer func(Observation)

type Config struct {
	Events                  []string
	EventLog                *MemoryEventLog
	Commands                []CommandDefinition
	Queries                 []QueryDefinition
	Reactions               []ReactionDefinition
	Observe                 Observer
	ReactionTicketRetention time.Duration
}

type sliceRuntime struct {
	mu     sync.Mutex
	cursor int64
	apply  map[string]ApplyFunc
}
type commandRuntime struct {
	definition CommandDefinition
	slice      sliceRuntime
}
type queryRuntime struct {
	definition QueryDefinition
	slice      sliceRuntime
}
type reactionRuntime struct {
	definition ReactionDefinition
	slice      sliceRuntime
}

type App struct {
	log              *MemoryEventLog
	events           map[string]struct{}
	commands         map[string]*commandRuntime
	queries          map[string]*queryRuntime
	reactions        map[string]*reactionRuntime
	observe          Observer
	subMu            sync.Mutex
	subscriptions    map[uint64]*Subscription
	nextSubscription atomic.Uint64
	tickets          sync.Map
	ticketRetention  time.Duration
	reactionQueue    reactionScheduler
}

const DefaultReactionTicketRetention = 5 * time.Minute

type reactionScheduler struct {
	mu    sync.Mutex
	queue []reactionPass
	wake  chan struct{}
}

func newReactionScheduler() reactionScheduler {
	return reactionScheduler{wake: make(chan struct{}, 1)}
}

func (s *reactionScheduler) enqueue(pass reactionPass) {
	s.mu.Lock()
	s.queue = append(s.queue, pass)
	s.mu.Unlock()
	select {
	case s.wake <- struct{}{}:
	default:
	}
}

func (s *reactionScheduler) next() reactionPass {
	for {
		s.mu.Lock()
		if len(s.queue) > 0 {
			pass := s.queue[0]
			s.queue[0] = reactionPass{}
			s.queue = s.queue[1:]
			s.mu.Unlock()
			return pass
		}
		s.mu.Unlock()
		<-s.wake
	}
}

type reactionPass struct {
	parent, correlation, ticketID string
	events                        []PersistedEvent
	ticket                        *reactionTicket
	result                        chan<- error
}

type DispatchOptions struct {
	OperationID          string
	CorrelationID        string
	ParentOperationIDs   []string
	TriggeringEventIDs   []string
	TriggeringEventOrder *EventOrderRange
	ReactionPassID       string
	DeliveryID           string
	IdempotencyKey       string
	ExpectedVersion      *int64
}

type CommandExecution struct {
	OperationID      string           `json:"operationId"`
	Events           []PersistedEvent `json:"events"`
	Version          int64            `json:"version"`
	Duplicate        bool             `json:"duplicate"`
	ReactionTicketID string           `json:"reactionTicketId"`
	Reactions        <-chan error     `json:"-"`
}

type ReactionContext struct {
	OperationID   string    `json:"operationId"`
	CorrelationID string    `json:"correlationId,omitempty"`
	DeliveryID    string    `json:"deliveryId"`
	AttemptID     string    `json:"attemptId"`
	ScheduledAt   time.Time `json:"scheduledAt"`
}

type reactionTicket struct {
	done chan struct{}
	mu   sync.RWMutex
	err  error
}
type ReactionTicketStatus struct {
	ID     string `json:"id"`
	Status string `json:"status"`
	Error  *Error `json:"error,omitempty"`
}

func NewApp(config Config) (*App, error) {
	if err := validateDefinitions(config.Commands, config.Queries, config.Reactions); err != nil {
		return nil, err
	}
	if config.EventLog == nil {
		config.EventLog = NewMemoryEventLog()
	}
	if config.ReactionTicketRetention <= 0 {
		config.ReactionTicketRetention = DefaultReactionTicketRetention
	}
	app := &App{log: config.EventLog, events: map[string]struct{}{}, commands: map[string]*commandRuntime{}, queries: map[string]*queryRuntime{}, reactions: map[string]*reactionRuntime{}, observe: config.Observe, subscriptions: map[uint64]*Subscription{}, ticketRetention: config.ReactionTicketRetention, reactionQueue: newReactionScheduler()}
	for _, name := range config.Events {
		if name == "" {
			return nil, newError(ErrConformanceFailed, "Event type must not be empty.", nil, nil)
		}
		if _, duplicate := app.events[name]; duplicate {
			return nil, newError(ErrConformanceFailed, fmt.Sprintf("Duplicate Event type %q.", name), nil, nil)
		}
		app.events[name] = struct{}{}
	}
	ensureRegistered := func(sliceName string, apply map[string]ApplyFunc) error {
		for eventType, handler := range apply {
			if _, ok := app.events[eventType]; !ok {
				return newError(ErrConformanceFailed, fmt.Sprintf("Slice %q applies unregistered Event %q.", sliceName, eventType), nil, nil)
			}
			if handler == nil {
				return newError(ErrConformanceFailed, fmt.Sprintf("Slice %q has a nil apply handler for Event %q.", sliceName, eventType), nil, nil)
			}
		}
		return nil
	}
	for _, definition := range config.Commands {
		if err := ensureRegistered(definition.Name, definition.Apply); err != nil {
			return nil, err
		}
		for eventType := range definition.allowed {
			if _, ok := app.events[eventType]; !ok {
				return nil, newError(ErrConformanceFailed, fmt.Sprintf("Command %q Scenario expects unregistered Event %q.", definition.Name, eventType), nil, nil)
			}
		}
	}
	for _, definition := range config.Queries {
		if err := ensureRegistered(definition.Name, definition.Apply); err != nil {
			return nil, err
		}
	}
	for _, definition := range config.Reactions {
		if err := ensureRegistered(definition.Name, definition.Apply); err != nil {
			return nil, err
		}
	}
	for _, definition := range config.Commands {
		d := definition
		app.commands[d.Name] = &commandRuntime{definition: d, slice: sliceRuntime{apply: d.Apply}}
	}
	for _, definition := range config.Queries {
		d := definition
		app.queries[d.Name] = &queryRuntime{definition: d, slice: sliceRuntime{apply: d.Apply}}
	}
	for _, definition := range config.Reactions {
		d := definition
		app.reactions[d.Name] = &reactionRuntime{definition: d, slice: sliceRuntime{apply: d.Apply}}
	}
	go func() {
		for {
			pass := app.reactionQueue.next()
			app.afterCommit(context.Background(), pass.parent, pass.correlation, pass.ticketID, pass.events, pass.ticket, pass.result)
		}
	}()
	return app, nil
}

func (a *App) EventLog() *MemoryEventLog { return a.log }

func (a *App) Command(ctx context.Context, name string, payload any, options DispatchOptions) (CommandExecution, error) {
	raw, err := marshalInput(payload)
	if err != nil {
		return CommandExecution{}, newError(ErrInvalidInput, fmt.Sprintf("Invalid command input for %q.", name), nil, err)
	}
	return a.CommandJSON(ctx, name, raw, options)
}

func (a *App) CommandJSON(ctx context.Context, name string, payload json.RawMessage, options DispatchOptions) (CommandExecution, error) {
	operationID := options.OperationID
	if operationID == "" {
		operationID = newID("op")
	}
	a.emit(Observation{Kind: "command.started", OperationID: operationID, CorrelationID: options.CorrelationID, ParentOperationIDs: options.ParentOperationIDs, TriggeringEventIDs: options.TriggeringEventIDs, TriggeringEventOrder: options.TriggeringEventOrder, ReactionPassID: options.ReactionPassID, DeliveryID: options.DeliveryID, CommandType: name})
	command := a.commands[name]
	if command == nil {
		failure := unknownCommand(name)
		a.emit(Observation{Kind: "command.rejected", OperationID: operationID, CorrelationID: options.CorrelationID, CommandType: name, Error: failure})
		return CommandExecution{}, failure
	}
	a.log.transactionMu.Lock()
	defer a.log.transactionMu.Unlock()
	command.slice.mu.Lock()
	defer command.slice.mu.Unlock()
	if err := a.catchUp(ctx, &command.slice, name, operationID, options.CorrelationID); err != nil {
		a.emitFailure("command.failed", operationID, options.CorrelationID, name, "", err)
		return CommandExecution{}, err
	}
	fingerprintBytes, fingerprintErr := commandFingerprint(name, payload)
	if fingerprintErr != nil {
		return CommandExecution{}, newError(ErrInvalidInput, "Command payload is not valid JSON.", nil, fingerprintErr)
	}
	fingerprint := sha256.Sum256(fingerprintBytes)
	fingerprintString := hex.EncodeToString(fingerprint[:])
	commit, duplicate, lookupErr := a.log.findCommit(options.IdempotencyKey, fingerprintString)
	if lookupErr != nil {
		a.emitFailure("command.failed", operationID, options.CorrelationID, name, "", lookupErr)
		return CommandExecution{}, lookupErr
	}
	if !duplicate {
		ticketID := newID("ticket")
		drafts, handleErr := command.definition.Handle(ctx, payload)
		if handleErr != nil {
			var public *Error
			if errors.As(handleErr, &public) && public.Code != ErrCommandRejected {
				a.emitFailure("command.failed", operationID, options.CorrelationID, name, "", public)
				return CommandExecution{}, public
			}
			if !errors.As(handleErr, &public) {
				public = newError(ErrCommandRejected, fmt.Sprintf("Command %q rejected: %s", name, handleErr), map[string]any{"commandType": name}, handleErr)
			}
			a.emit(Observation{Kind: "command.rejected", OperationID: operationID, CorrelationID: options.CorrelationID, CommandType: name, Error: public})
			return CommandExecution{}, public
		}
		for _, draft := range drafts {
			if _, ok := a.events[draft.Type]; !ok {
				failure := newError(ErrUnknownEvent, fmt.Sprintf("Unknown Event type: %q.", draft.Type), map[string]any{"eventType": draft.Type}, nil)
				a.emitFailure("command.failed", operationID, options.CorrelationID, name, "", failure)
				return CommandExecution{}, failure
			}
			if _, ok := command.definition.allowed[draft.Type]; !ok {
				failure := newError(ErrConformanceFailed, fmt.Sprintf("Command %q emitted Event %q absent from its Scenarios.", name, draft.Type), nil, nil)
				a.emitFailure("command.failed", operationID, options.CorrelationID, name, "", failure)
				return CommandExecution{}, failure
			}
		}
		var appendErr error
		commit, appendErr = a.log.append(ctx, drafts, options.ExpectedVersion, options.IdempotencyKey, fingerprintString, ticketID)
		if appendErr != nil {
			a.emitFailure("command.failed", operationID, options.CorrelationID, name, "", appendErr)
			return CommandExecution{}, appendErr
		}
	}
	if !commit.Duplicate {
		if err := a.applyEvents(ctx, &command.slice, commit.Events); err != nil {
			var public *Error
			if !errors.As(err, &public) {
				public = newError(ErrInfrastructure, "Slice projection failed.", nil, err)
			}
			a.emit(Observation{Kind: "slice.catch-up.failed", OperationID: operationID, CorrelationID: options.CorrelationID, Slice: name, Cursor: command.slice.cursor, Error: public, Attributes: map[string]any{"durableCommitVersion": commit.Version, "repairRequired": true}})
		}
	}
	if !commit.Duplicate {
		references := make([]EventReference, len(commit.Events))
		for i := range commit.Events {
			references[i] = eventReference(commit.Events[i])
		}
		a.emit(Observation{Kind: "events.persisted", OperationID: operationID, CorrelationID: options.CorrelationID, CommandType: name, Events: references, Version: commit.Version})
	}
	ticketID := commit.ReactionTicketID
	if ticketID == "" {
		ticketID = newID("ticket")
	}
	if commit.Duplicate {
		result := a.reactionResult(ticketID)
		execution := CommandExecution{OperationID: operationID, Events: commit.Events, Version: commit.Version, Duplicate: true, ReactionTicketID: ticketID, Reactions: result}
		a.emit(Observation{Kind: "command.completed", OperationID: operationID, CorrelationID: options.CorrelationID, CommandType: name, Version: commit.Version, Duplicate: true, ReactionTicketID: ticketID})
		return execution, nil
	}
	ticket := &reactionTicket{done: make(chan struct{})}
	a.tickets.Store(ticketID, ticket)
	reactionResult := make(chan error, 1)
	execution := CommandExecution{OperationID: operationID, Events: commit.Events, Version: commit.Version, Duplicate: commit.Duplicate, ReactionTicketID: ticketID, Reactions: reactionResult}
	a.emit(Observation{Kind: "command.completed", OperationID: operationID, CorrelationID: options.CorrelationID, CommandType: name, Version: commit.Version, Duplicate: commit.Duplicate, ReactionTicketID: ticketID})
	a.reactionQueue.enqueue(reactionPass{parent: operationID, correlation: options.CorrelationID, ticketID: ticketID, events: commit.Events, ticket: ticket, result: reactionResult})
	return execution, nil
}

// Reject returns a public Command rejection suitable for a handler.
func Reject(commandType, reason string) error {
	return newError(ErrCommandRejected, fmt.Sprintf("Command %q rejected: %s", commandType, reason), map[string]any{"commandType": commandType, "reason": reason}, nil)
}

func (a *App) Query(ctx context.Context, name string, payload any) (any, error) {
	raw, err := marshalInput(payload)
	if err != nil {
		return nil, newError(ErrInvalidInput, fmt.Sprintf("Invalid query input for %q.", name), nil, err)
	}
	return a.QueryJSON(ctx, name, raw, DispatchOptions{})
}

func (a *App) QueryJSON(ctx context.Context, name string, payload json.RawMessage, options DispatchOptions) (any, error) {
	op := options.OperationID
	if op == "" {
		op = newID("op")
	}
	a.emit(Observation{Kind: "query.started", OperationID: op, CorrelationID: options.CorrelationID, ParentOperationIDs: options.ParentOperationIDs, TriggeringEventIDs: options.TriggeringEventIDs, TriggeringEventOrder: options.TriggeringEventOrder, ReactionPassID: options.ReactionPassID, DeliveryID: options.DeliveryID, QueryType: name})
	query := a.queries[name]
	if query == nil {
		failure := unknownQuery(name)
		a.emit(Observation{Kind: "query.rejected", OperationID: op, CorrelationID: options.CorrelationID, QueryType: name, Error: failure})
		return nil, failure
	}
	query.slice.mu.Lock()
	defer query.slice.mu.Unlock()
	if err := a.catchUp(ctx, &query.slice, name, op, options.CorrelationID); err != nil {
		a.emitFailure("query.failed", op, options.CorrelationID, "", name, err)
		return nil, err
	}
	result, err := query.definition.Handle(ctx, payload)
	if err != nil {
		a.emitFailure("query.failed", op, options.CorrelationID, "", name, err)
		return nil, err
	}
	if _, err := json.Marshal(result); err != nil {
		failure := newError(ErrInvalidOutput, fmt.Sprintf("Invalid query output for %q.", name), nil, err)
		a.emitFailure("query.failed", op, options.CorrelationID, "", name, failure)
		return nil, failure
	}
	a.emit(Observation{Kind: "query.completed", OperationID: op, CorrelationID: options.CorrelationID, QueryType: name})
	return result, nil
}

func (a *App) catchUp(ctx context.Context, slice *sliceRuntime, sliceName, operationID, correlationID string) error {
	events := a.log.Query(slice.cursor, nil)
	return a.catchUpEvents(ctx, slice, sliceName, operationID, correlationID, events)
}

func (a *App) catchUpThrough(ctx context.Context, slice *sliceRuntime, sliceName, operationID, correlationID string, through int64) error {
	events := a.log.Query(slice.cursor, nil)
	for index, event := range events {
		if event.GlobalOrder > through {
			events = events[:index]
			break
		}
	}
	return a.catchUpEvents(ctx, slice, sliceName, operationID, correlationID, events)
}

func (a *App) catchUpEvents(ctx context.Context, slice *sliceRuntime, sliceName, operationID, correlationID string, events []PersistedEvent) error {
	if len(events) == 0 {
		return nil
	}
	from := slice.cursor
	a.emit(Observation{Kind: "slice.catch-up.started", OperationID: operationID, CorrelationID: correlationID, Slice: sliceName, Cursor: from})
	if err := a.applyEvents(ctx, slice, events); err != nil {
		var public *Error
		if !errors.As(err, &public) {
			public = newError(ErrInfrastructure, "Slice catch-up failed.", nil, err)
		}
		a.emit(Observation{Kind: "slice.catch-up.failed", OperationID: operationID, CorrelationID: correlationID, Slice: sliceName, Cursor: slice.cursor, Error: public})
		return err
	}
	a.emit(Observation{Kind: "slice.catch-up.completed", OperationID: operationID, CorrelationID: correlationID, Slice: sliceName, Cursor: slice.cursor, Attributes: map[string]any{"from": from, "eventCount": len(events)}})
	return nil
}
func (a *App) applyEvents(ctx context.Context, slice *sliceRuntime, events []PersistedEvent) error {
	for _, event := range events {
		if apply := slice.apply[event.Type]; apply != nil {
			if err := apply(ctx, event); err != nil {
				return newError(ErrInfrastructure, "Slice projection failed.", map[string]any{"eventType": event.Type}, err)
			}
		}
		slice.cursor = event.GlobalOrder
	}
	return nil
}

func (a *App) afterCommit(ctx context.Context, parent, correlation, ticketID string, events []PersistedEvent, ticket *reactionTicket, result chan<- error) {
	defer func() {
		close(ticket.done)
		close(result)
		time.AfterFunc(a.ticketRetention, func() {
			a.tickets.CompareAndDelete(ticketID, ticket)
		})
	}()
	passOperation := newID("op")
	a.emit(Observation{Kind: "reaction.pass.started", OperationID: passOperation, CorrelationID: correlation, ParentOperationIDs: []string{parent}, TriggeringEventIDs: eventIDs(events), ReactionTicketID: ticketID})
	var failures []error
	for name, reaction := range a.reactions {
		reaction.slice.mu.Lock()
		before := reaction.slice.cursor
		through := before
		if len(events) > 0 {
			through = events[len(events)-1].GlobalOrder
		}
		if err := a.catchUpThrough(ctx, &reaction.slice, name, passOperation, correlation, through); err != nil {
			failures = append(failures, err)
			reaction.slice.mu.Unlock()
			continue
		}
		relevant := make([]PersistedEvent, 0)
		for _, event := range events {
			if event.GlobalOrder > before {
				if _, ok := reaction.definition.Apply[event.Type]; ok {
					relevant = append(relevant, event)
				}
			}
		}
		if len(relevant) > 0 {
			deliveryID, attemptID, op := newID("delivery"), newID("attempt"), newID("op")
			ctxValue := ReactionContext{OperationID: op, CorrelationID: correlation, DeliveryID: deliveryID, AttemptID: attemptID, ScheduledAt: time.Now().UTC()}
			a.emit(Observation{Kind: "reaction.run.started", OperationID: op, CorrelationID: correlation, ParentOperationIDs: []string{passOperation}, TriggeringEventIDs: eventIDs(relevant), TriggeringEventOrder: eventOrder(relevant), ReactionPassID: passOperation, ReactionName: name, ReactionTicketID: ticketID, DeliveryID: deliveryID, AttemptID: attemptID})
			effect, runErr := reaction.definition.Handle(ctx, ctxValue, relevant)
			if runErr == nil {
				if _, marshalErr := json.Marshal(effect); marshalErr != nil {
					runErr = newError(ErrInvalidOutput, fmt.Sprintf("Invalid Reaction output for %q.", name), nil, marshalErr)
				}
			}
			if runErr != nil {
				failures = append(failures, runErr)
				var public *Error
				if !errors.As(runErr, &public) {
					public = newError(ErrInfrastructure, "Reaction run failed.", nil, runErr)
				}
				a.emit(Observation{Kind: "reaction.run.failed", OperationID: op, CorrelationID: correlation, ParentOperationIDs: []string{passOperation}, TriggeringEventIDs: eventIDs(relevant), TriggeringEventOrder: eventOrder(relevant), ReactionPassID: passOperation, ReactionName: name, ReactionTicketID: ticketID, DeliveryID: deliveryID, AttemptID: attemptID, Error: public})
			} else {
				a.emit(Observation{Kind: "reaction.run.completed", OperationID: op, CorrelationID: correlation, ParentOperationIDs: []string{passOperation}, TriggeringEventIDs: eventIDs(relevant), TriggeringEventOrder: eventOrder(relevant), ReactionPassID: passOperation, ReactionName: name, ReactionTicketID: ticketID, DeliveryID: deliveryID, AttemptID: attemptID})
			}
		}
		reaction.slice.mu.Unlock()
	}
	a.invalidateSubscriptions(parent, correlation)
	var err error
	passKind := "reaction.pass.completed"
	if len(failures) > 0 {
		err = newError(ErrReactionFailure, "One or more Reactions failed.", map[string]any{"failureCount": len(failures)}, errors.Join(failures...))
		passKind = "reaction.pass.failed"
	}
	ticket.mu.Lock()
	ticket.err = err
	ticket.mu.Unlock()
	outcome := map[string]any{"failureCount": len(failures)}
	observation := Observation{Kind: passKind, OperationID: passOperation, CorrelationID: correlation, ParentOperationIDs: []string{parent}, TriggeringEventIDs: eventIDs(events), ReactionTicketID: ticketID, Attributes: outcome}
	if err != nil {
		var public *Error
		if errors.As(err, &public) {
			observation.Error = public
		}
	}
	a.emit(observation)
	result <- err
}

func (a *App) ReactionTicket(id string) (ReactionTicketStatus, bool) {
	value, ok := a.tickets.Load(id)
	if !ok {
		return ReactionTicketStatus{}, false
	}
	ticket := value.(*reactionTicket)
	select {
	case <-ticket.done:
		ticket.mu.RLock()
		defer ticket.mu.RUnlock()
		status := ReactionTicketStatus{ID: id, Status: "completed"}
		if ticket.err != nil {
			status.Status = "failed"
			var public *Error
			if errors.As(ticket.err, &public) {
				status.Error = public
			}
		}
		return status, true
	default:
		return ReactionTicketStatus{ID: id, Status: "pending"}, true
	}
}

func (a *App) reactionResult(id string) <-chan error {
	result := make(chan error, 1)
	value, ok := a.tickets.Load(id)
	if !ok {
		result <- newError(ErrReactionFailure, "Reaction ticket was not found or expired.", nil, nil)
		close(result)
		return result
	}
	ticket := value.(*reactionTicket)
	go func() {
		defer close(result)
		<-ticket.done
		ticket.mu.RLock()
		defer ticket.mu.RUnlock()
		result <- ticket.err
	}()
	return result
}

func marshalInput(value any) (json.RawMessage, error) {
	if raw, ok := value.(json.RawMessage); ok {
		return raw, nil
	}
	bytes, err := json.Marshal(value)
	return bytes, err
}
func commandFingerprint(name string, payload json.RawMessage) ([]byte, error) {
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, err
	}
	return json.Marshal(struct {
		Name    string `json:"name"`
		Payload any    `json:"payload"`
	}{Name: name, Payload: value})
}
func eventReference(event PersistedEvent) EventReference {
	return EventReference{EventID: event.ID, Type: event.Type, Order: event.GlobalOrder, CommitVersion: event.CommitVersion, RecordedAt: event.RecordedAt, Attributes: event.Attributes}
}
func eventIDs(events []PersistedEvent) []string {
	ids := make([]string, len(events))
	for i := range events {
		ids[i] = events[i].ID
	}
	return ids
}
func eventOrder(events []PersistedEvent) *EventOrderRange {
	if len(events) == 0 {
		return nil
	}
	return &EventOrderRange{From: events[0].GlobalOrder, To: events[len(events)-1].GlobalOrder}
}

var fallbackID atomic.Uint64

func newID(prefix string) string {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err == nil {
		return prefix + "_" + hex.EncodeToString(bytes)
	}
	return fmt.Sprintf("%s_%d", prefix, fallbackID.Add(1))
}
func (a *App) emit(observation Observation) {
	if a.observe == nil {
		return
	}
	observation.ObservationID = newID("obs")
	observation.ObservedAt = time.Now().UTC()
	func() { defer func() { _ = recover() }(); a.observe(observation) }()
}
func (a *App) emitFailure(kind, operation, correlation, command, query string, err error) {
	var public *Error
	if !errors.As(err, &public) {
		public = newError(ErrInfrastructure, "Runtime operation failed.", nil, err)
	}
	a.emit(Observation{Kind: kind, OperationID: operation, CorrelationID: correlation, CommandType: command, QueryType: query, Error: public})
}
