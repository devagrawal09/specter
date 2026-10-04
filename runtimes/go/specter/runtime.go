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

type Config struct {
	Events                  []string
	EventLog                *MemoryEventLog
	Commands                []CommandDefinition
	Queries                 []QueryDefinition
	Reactions               []ReactionDefinition
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
	subMu            sync.Mutex
	subscriptions    map[uint64]*Subscription
	nextSubscription atomic.Uint64
	tickets          sync.Map
	ticketRetention  time.Duration
	reactionQueue    reactionScheduler
	lifecycleMu      sync.RWMutex
	closed           bool
	closeOnce        sync.Once
}

const DefaultReactionTicketRetention = 5 * time.Minute

type reactionScheduler struct {
	mu       sync.Mutex
	queue    []reactionPass
	running  bool
	closed   bool
	done     chan struct{}
	doneOnce sync.Once
	process  func(reactionPass)
}

func newReactionScheduler(process func(reactionPass)) reactionScheduler {
	return reactionScheduler{done: make(chan struct{}), process: process}
}

func (s *reactionScheduler) enqueue(pass reactionPass) bool {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return false
	}
	s.queue = append(s.queue, pass)
	if !s.running {
		s.running = true
		go s.run()
	}
	s.mu.Unlock()
	return true
}

func (s *reactionScheduler) run() {
	for {
		s.mu.Lock()
		if len(s.queue) == 0 {
			s.running = false
			closed := s.closed
			s.mu.Unlock()
			if closed {
				s.doneOnce.Do(func() { close(s.done) })
			}
			return
		}
		pass := s.queue[0]
		s.queue[0] = reactionPass{}
		s.queue = s.queue[1:]
		s.mu.Unlock()
		s.process(pass)
	}
}

func (s *reactionScheduler) close() {
	s.mu.Lock()
	s.closed = true
	idle := !s.running && len(s.queue) == 0
	s.mu.Unlock()
	if idle {
		s.doneOnce.Do(func() { close(s.done) })
	}
}

type reactionPass struct {
	ticketID string
	events   []PersistedEvent
	ticket   *reactionTicket
	result   chan<- error
}

type DispatchOptions struct {
	IdempotencyKey  string
	ExpectedVersion *int64
}

type CommandExecution struct {
	Events           []PersistedEvent `json:"events"`
	Version          int64            `json:"version"`
	Duplicate        bool             `json:"duplicate"`
	ReactionTicketID string           `json:"reactionTicketId"`
	Reactions        <-chan error     `json:"-"`
}

type ReactionContext struct {
	DeliveryID  string    `json:"deliveryId"`
	ScheduledAt time.Time `json:"scheduledAt"`
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
	app := &App{log: config.EventLog, events: map[string]struct{}{}, commands: map[string]*commandRuntime{}, queries: map[string]*queryRuntime{}, reactions: map[string]*reactionRuntime{}, subscriptions: map[uint64]*Subscription{}, ticketRetention: config.ReactionTicketRetention}
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
	app.reactionQueue = newReactionScheduler(func(pass reactionPass) {
		app.afterCommit(context.Background(), pass.ticketID, pass.events, pass.ticket, pass.result)
	})
	return app, nil
}

func (a *App) EventLog() *MemoryEventLog { return a.log }

// Close rejects new operations, closes active subscriptions, and waits for all
// already-committed Reaction passes to finish. It is safe to call repeatedly.
func (a *App) Close(ctx context.Context) error {
	a.closeOnce.Do(func() {
		a.lifecycleMu.Lock()
		a.closed = true
		a.reactionQueue.close()
		a.lifecycleMu.Unlock()
		a.closeSubscriptions()
	})
	select {
	case <-a.reactionQueue.done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (a *App) beginOperation() error {
	a.lifecycleMu.RLock()
	if a.closed {
		a.lifecycleMu.RUnlock()
		return newError(ErrInfrastructure, "Specter App is closed.", nil, nil)
	}
	return nil
}

func (a *App) endOperation() {
	a.lifecycleMu.RUnlock()
}

func (a *App) Command(ctx context.Context, name string, payload any, options DispatchOptions) (CommandExecution, error) {
	raw, err := marshalInput(payload)
	if err != nil {
		return CommandExecution{}, newError(ErrInvalidInput, fmt.Sprintf("Invalid command input for %q.", name), nil, err)
	}
	return a.CommandJSON(ctx, name, raw, options)
}

func (a *App) CommandJSON(ctx context.Context, name string, payload json.RawMessage, options DispatchOptions) (CommandExecution, error) {
	if err := a.beginOperation(); err != nil {
		return CommandExecution{}, err
	}
	defer a.endOperation()
	command := a.commands[name]
	if command == nil {
		return CommandExecution{}, unknownCommand(name)
	}
	a.log.transactionMu.Lock()
	defer a.log.transactionMu.Unlock()
	command.slice.mu.Lock()
	defer command.slice.mu.Unlock()
	if err := a.catchUp(ctx, &command.slice); err != nil {
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
		return CommandExecution{}, lookupErr
	}
	if !duplicate {
		ticketID := newID("ticket")
		drafts, handleErr := command.definition.Handle(ctx, payload)
		if handleErr != nil {
			var public *Error
			if errors.As(handleErr, &public) && public.Code != ErrCommandRejected {
				return CommandExecution{}, public
			}
			if !errors.As(handleErr, &public) {
				public = newError(ErrCommandRejected, fmt.Sprintf("Command %q rejected: %s", name, handleErr), map[string]any{"commandType": name}, handleErr)
			}
			return CommandExecution{}, public
		}
		if len(drafts) == 0 {
			failure := newError(ErrCommandRejected, fmt.Sprintf("Command %q rejected: Command emitted no Events.", name), map[string]any{"commandType": name}, nil)
			return CommandExecution{}, failure
		}
		for _, draft := range drafts {
			if _, ok := a.events[draft.Type]; !ok {
				failure := newError(ErrUnknownEvent, fmt.Sprintf("Unknown Event type: %q.", draft.Type), map[string]any{"eventType": draft.Type}, nil)
				return CommandExecution{}, failure
			}
			if _, ok := command.definition.allowed[draft.Type]; !ok {
				failure := newError(ErrConformanceFailed, fmt.Sprintf("Command %q emitted Event %q absent from its Scenarios.", name, draft.Type), nil, nil)
				return CommandExecution{}, failure
			}
		}
		var appendErr error
		commit, appendErr = a.log.append(ctx, drafts, options.ExpectedVersion, options.IdempotencyKey, fingerprintString, ticketID)
		if appendErr != nil {
			return CommandExecution{}, appendErr
		}
	}
	if !commit.Duplicate {
		_ = a.applyEvents(ctx, &command.slice, commit.Events)
	}
	ticketID := commit.ReactionTicketID
	if ticketID == "" {
		ticketID = newID("ticket")
	}
	if commit.Duplicate {
		result := a.reactionResult(ticketID)
		execution := CommandExecution{Events: commit.Events, Version: commit.Version, Duplicate: true, ReactionTicketID: ticketID, Reactions: result}
		return execution, nil
	}
	ticket := &reactionTicket{done: make(chan struct{})}
	a.tickets.Store(ticketID, ticket)
	reactionResult := make(chan error, 1)
	execution := CommandExecution{Events: commit.Events, Version: commit.Version, Duplicate: commit.Duplicate, ReactionTicketID: ticketID, Reactions: reactionResult}
	a.reactionQueue.enqueue(reactionPass{ticketID: ticketID, events: commit.Events, ticket: ticket, result: reactionResult})
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
	return a.QueryJSON(ctx, name, raw)
}

func (a *App) QueryJSON(ctx context.Context, name string, payload json.RawMessage) (any, error) {
	if err := a.beginOperation(); err != nil {
		return nil, err
	}
	defer a.endOperation()
	query := a.queries[name]
	if query == nil {
		return nil, unknownQuery(name)
	}
	query.slice.mu.Lock()
	defer query.slice.mu.Unlock()
	if err := a.catchUp(ctx, &query.slice); err != nil {
		return nil, err
	}
	result, err := query.definition.Handle(ctx, payload)
	if err != nil {
		return nil, err
	}
	if _, err := json.Marshal(result); err != nil {
		failure := newError(ErrInvalidOutput, fmt.Sprintf("Invalid query output for %q.", name), nil, err)
		return nil, failure
	}
	return result, nil
}

func (a *App) catchUp(ctx context.Context, slice *sliceRuntime) error {
	events := a.log.Query(slice.cursor, nil)
	return a.catchUpEvents(ctx, slice, events)
}

func (a *App) catchUpThrough(ctx context.Context, slice *sliceRuntime, through int64) error {
	events := a.log.Query(slice.cursor, nil)
	for index, event := range events {
		if event.GlobalOrder > through {
			events = events[:index]
			break
		}
	}
	return a.catchUpEvents(ctx, slice, events)
}

func (a *App) catchUpEvents(ctx context.Context, slice *sliceRuntime, events []PersistedEvent) error {
	if len(events) == 0 {
		return nil
	}
	if err := a.applyEvents(ctx, slice, events); err != nil {
		return err
	}
	return nil
}
func (a *App) applyEvents(ctx context.Context, slice *sliceRuntime, events []PersistedEvent) (err error) {
	var currentEvent *PersistedEvent
	defer func() {
		if recovered := recover(); recovered != nil {
			details := map[string]any{}
			if currentEvent != nil {
				details["eventType"] = currentEvent.Type
			}
			err = newError(ErrInfrastructure, "Slice projection panicked.", details, fmt.Errorf("panic: %v", recovered))
		}
	}()
	for index := range events {
		event := events[index]
		currentEvent = &event
		if apply := slice.apply[event.Type]; apply != nil {
			if err := apply(ctx, event); err != nil {
				return newError(ErrInfrastructure, "Slice projection failed.", map[string]any{"eventType": event.Type}, err)
			}
		}
		slice.cursor = event.GlobalOrder
	}
	currentEvent = nil
	return nil
}

func (a *App) afterCommit(ctx context.Context, ticketID string, events []PersistedEvent, ticket *reactionTicket, result chan<- error) {
	var failures []error
	defer func() {
		if recovered := recover(); recovered != nil {
			failures = append(failures, reactionPanicError(recovered))
		}
		var err error
		if len(failures) > 0 {
			err = newError(ErrReactionFailure, "One or more Reactions failed.", map[string]any{"failureCount": len(failures)}, errors.Join(failures...))
		}
		ticket.mu.Lock()
		ticket.err = err
		ticket.mu.Unlock()
		result <- err
		close(ticket.done)
		close(result)
		time.AfterFunc(a.ticketRetention, func() {
			a.tickets.CompareAndDelete(ticketID, ticket)
		})
	}()
	for name, reaction := range a.reactions {
		func() {
			reaction.slice.mu.Lock()
			defer reaction.slice.mu.Unlock()
			defer func() {
				if recovered := recover(); recovered != nil {
					failures = append(failures, reactionPanicError(recovered))
				}
			}()
			before := reaction.slice.cursor
			through := before
			if len(events) > 0 {
				through = events[len(events)-1].GlobalOrder
			}
			if err := a.catchUpThrough(ctx, &reaction.slice, through); err != nil {
				failures = append(failures, err)
				return
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
				deliveryID := fmt.Sprintf("%s:%d", name, relevant[0].CommitVersion)
				ctxValue := ReactionContext{DeliveryID: deliveryID, ScheduledAt: time.Now().UTC()}
				effect, runErr := runReactionHandler(reaction.definition.Handle, ctx, ctxValue, relevant)
				if runErr == nil {
					if _, marshalErr := json.Marshal(effect); marshalErr != nil {
						runErr = newError(ErrInvalidOutput, fmt.Sprintf("Invalid Reaction output for %q.", name), nil, marshalErr)
					}
				}
				if runErr != nil {
					failures = append(failures, runErr)
				}
			}
		}()
	}
	a.invalidateSubscriptions()
}

func reactionPanicError(recovered any) error {
	return newError(ErrInfrastructure, "Reaction execution panicked.", nil, fmt.Errorf("panic: %v", recovered))
}

func runReactionHandler(handle ReactionHandle, ctx context.Context, reactionContext ReactionContext, events []PersistedEvent) (effect any, err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = reactionPanicError(recovered)
		}
	}()
	return handle(ctx, reactionContext, events)
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

var fallbackID atomic.Uint64

func newID(prefix string) string {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err == nil {
		return prefix + "_" + hex.EncodeToString(bytes)
	}
	return fmt.Sprintf("%s_%d", prefix, fallbackID.Add(1))
}
