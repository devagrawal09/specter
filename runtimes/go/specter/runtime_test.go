package specter_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/devagrawal09/specter/runtimes/go/specter"
)

type addInput struct {
	ID string `json:"id"`
}
type added struct {
	ID string `json:"id"`
}

func TestCommandQueryReactionAndDuplicate(t *testing.T) {
	var commandState []string
	var queryState []string
	var reactions atomic.Int64
	scenarios := []specter.CommandScenario{{Description: "adds", Input: addInput{ID: "one"}, Expect: []specter.ScenarioEvent{{Type: "added", Payload: added{ID: "one"}}}}, {Description: "rejects existing", Given: []specter.ScenarioEvent{{Type: "added", Payload: added{ID: "one"}}}, Input: addInput{ID: "one"}, RejectReason: "already exists"}}
	command := specter.CommandDefinition{Name: "add", Scenarios: scenarios, Apply: map[string]specter.ApplyFunc{"added": specter.DecodeApply(func(_ context.Context, payload added, _ specter.PersistedEvent) error {
		commandState = append(commandState, payload.ID)
		return nil
	})}, Handle: specter.DecodeCommand(func(_ context.Context, input addInput) ([]specter.EventDraft, error) {
		for _, id := range commandState {
			if id == input.ID {
				return nil, specter.Reject("add", "already exists")
			}
		}
		return []specter.EventDraft{{Type: "added", Payload: added{ID: input.ID}}}, nil
	})}
	query := specter.QueryDefinition{Name: "all", Scenarios: []specter.QueryScenario{{Description: "lists", Given: []specter.ScenarioEvent{{Type: "added", Payload: added{ID: "one"}}}, Input: struct{}{}, Expect: []string{"one"}}}, Apply: map[string]specter.ApplyFunc{"added": specter.DecodeApply(func(_ context.Context, payload added, _ specter.PersistedEvent) error {
		queryState = append(queryState, payload.ID)
		return nil
	})}, Handle: specter.DecodeQuery(func(_ context.Context, _ struct{}) ([]string, error) {
		return append([]string(nil), queryState...), nil
	})}
	reaction := specter.ReactionDefinition{Name: "notice", Scenarios: []specter.ReactionScenario{{Description: "notices", Given: []specter.ScenarioEvent{{Type: "added", Payload: added{ID: "one"}}}, Expect: []any{"one"}}}, Apply: map[string]specter.ApplyFunc{"added": func(context.Context, specter.PersistedEvent) error { return nil }}, Handle: func(context.Context, specter.ReactionContext, []specter.PersistedEvent) (any, error) {
		reactions.Add(1)
		return "sent", nil
	}}
	app, err := specter.NewApp(specter.Config{Events: []string{"added"}, Commands: []specter.CommandDefinition{command}, Queries: []specter.QueryDefinition{query}, Reactions: []specter.ReactionDefinition{reaction}})
	if err != nil {
		t.Fatal(err)
	}
	execution, err := app.Command(context.Background(), "add", addInput{ID: "one"}, specter.DispatchOptions{IdempotencyKey: "key-1"})
	if err != nil {
		t.Fatal(err)
	}
	if execution.Version != 1 || execution.Duplicate || len(execution.Events) != 1 {
		t.Fatalf("unexpected execution: %#v", execution)
	}
	if err := <-execution.Reactions; err != nil {
		t.Fatal(err)
	}
	if reactions.Load() != 1 {
		t.Fatalf("got %d Reaction runs", reactions.Load())
	}
	result, err := app.Query(context.Background(), "all", struct{}{})
	if err != nil {
		t.Fatal(err)
	}
	values := result.([]string)
	if len(values) != 1 || values[0] != "one" {
		t.Fatalf("unexpected Query result: %#v", result)
	}
	duplicate, err := app.Command(context.Background(), "add", addInput{ID: "one"}, specter.DispatchOptions{IdempotencyKey: "key-1"})
	if err != nil {
		t.Fatal(err)
	}
	if !duplicate.Duplicate {
		t.Fatal("expected duplicate receipt")
	}
	if duplicate.ReactionTicketID != execution.ReactionTicketID {
		t.Fatalf("duplicate ticket %q does not match original %q", duplicate.ReactionTicketID, execution.ReactionTicketID)
	}
	if err := <-duplicate.Reactions; err != nil {
		t.Fatal(err)
	}
	if reactions.Load() != 1 {
		t.Fatal("duplicate reran Reaction")
	}
}

func TestCommandEmittingNoEventsIsRejectedBeforeAppend(t *testing.T) {
	command := specter.CommandDefinition{
		Name:      "add",
		Scenarios: []specter.CommandScenario{{Description: "adds", Input: addInput{ID: "one"}, Expect: []specter.ScenarioEvent{{Type: "added", Payload: added{ID: "one"}}}}},
		Handle:    func(context.Context, json.RawMessage) ([]specter.EventDraft, error) { return nil, nil },
	}
	app, err := specter.NewApp(specter.Config{Events: []string{"added"}, Commands: []specter.CommandDefinition{command}})
	if err != nil {
		t.Fatal(err)
	}
	_, err = app.Command(context.Background(), "add", addInput{ID: "one"}, specter.DispatchOptions{IdempotencyKey: "empty"})
	var public *specter.Error
	if !errors.As(err, &public) || public.Code != specter.ErrCommandRejected {
		t.Fatalf("expected zero-Event Command rejection, got %v", err)
	}
	if app.EventLog().Version() != 0 || len(app.EventLog().Query(0, nil)) != 0 {
		t.Fatal("zero-Event Command changed the Event Log")
	}
}

func TestQueuedReactionPassesDoNotSkipLaterCommits(t *testing.T) {
	started := make(chan struct{}, 1)
	release := make(chan struct{})
	var runCount atomic.Int64
	seen := make(chan string, 3)
	command := specter.CommandDefinition{Name: "add", Scenarios: []specter.CommandScenario{{Description: "adds", Input: addInput{ID: "one"}, Expect: []specter.ScenarioEvent{{Type: "added", Payload: added{ID: "one"}}}}}, Handle: specter.DecodeCommand(func(_ context.Context, input addInput) ([]specter.EventDraft, error) {
		return []specter.EventDraft{{Type: "added", Payload: added{ID: input.ID}}}, nil
	})}
	reaction := specter.ReactionDefinition{Name: "notice", Scenarios: []specter.ReactionScenario{{Description: "notices", Given: []specter.ScenarioEvent{{Type: "added", Payload: added{ID: "one"}}}, Expect: []any{"one"}}}, Apply: map[string]specter.ApplyFunc{"added": func(context.Context, specter.PersistedEvent) error { return nil }}, Handle: func(_ context.Context, _ specter.ReactionContext, events []specter.PersistedEvent) (any, error) {
		if runCount.Add(1) == 1 {
			started <- struct{}{}
			<-release
		}
		var payload added
		if err := json.Unmarshal(events[0].Payload, &payload); err != nil {
			return nil, err
		}
		seen <- payload.ID
		return payload.ID, nil
	}}
	app, err := specter.NewApp(specter.Config{Events: []string{"added"}, Commands: []specter.CommandDefinition{command}, Reactions: []specter.ReactionDefinition{reaction}})
	if err != nil {
		t.Fatal(err)
	}
	executions := make([]specter.CommandExecution, 0, 3)
	first, err := app.Command(context.Background(), "add", addInput{ID: "one"}, specter.DispatchOptions{})
	if err != nil {
		t.Fatal(err)
	}
	executions = append(executions, first)
	<-started
	for _, id := range []string{"two", "three"} {
		execution, err := app.Command(context.Background(), "add", addInput{ID: id}, specter.DispatchOptions{})
		if err != nil {
			t.Fatal(err)
		}
		executions = append(executions, execution)
	}
	close(release)
	for _, execution := range executions {
		if err := <-execution.Reactions; err != nil {
			t.Fatal(err)
		}
	}
	close(seen)
	var got []string
	for id := range seen {
		got = append(got, id)
	}
	if len(got) != 3 || got[0] != "one" || got[1] != "two" || got[2] != "three" {
		t.Fatalf("expected every queued commit to run, got %#v", got)
	}
}

func TestReactionPanicsFailOnlyTheirPassAndDoNotStrandClose(t *testing.T) {
	for _, panicAt := range []string{"apply", "handle"} {
		t.Run(panicAt, func(t *testing.T) {
			var panicOnce atomic.Bool
			panicOnce.Store(true)
			var runs atomic.Int64
			command := specter.CommandDefinition{Name: "add", Scenarios: []specter.CommandScenario{{Description: "adds", Input: addInput{ID: "one"}, Expect: []specter.ScenarioEvent{{Type: "added", Payload: added{ID: "one"}}}}}, Handle: specter.DecodeCommand(func(_ context.Context, input addInput) ([]specter.EventDraft, error) {
				return []specter.EventDraft{{Type: "added", Payload: added{ID: input.ID}}}, nil
			})}
			reaction := specter.ReactionDefinition{Name: "panic-once", Scenarios: []specter.ReactionScenario{{Description: "runs", Given: []specter.ScenarioEvent{{Type: "added", Payload: added{ID: "one"}}}, Expect: []any{"ok"}}}, Apply: map[string]specter.ApplyFunc{"added": func(context.Context, specter.PersistedEvent) error {
				if panicAt == "apply" && panicOnce.CompareAndSwap(true, false) {
					panic("apply secret")
				}
				return nil
			}}, Handle: func(context.Context, specter.ReactionContext, []specter.PersistedEvent) (any, error) {
				if panicAt == "handle" && panicOnce.CompareAndSwap(true, false) {
					panic("handler secret")
				}
				runs.Add(1)
				return "ok", nil
			}}
			app, err := specter.NewApp(specter.Config{Events: []string{"added"}, Commands: []specter.CommandDefinition{command}, Reactions: []specter.ReactionDefinition{reaction}})
			if err != nil {
				t.Fatal(err)
			}
			first, err := app.Command(context.Background(), "add", addInput{ID: "one"}, specter.DispatchOptions{})
			if err != nil {
				t.Fatal(err)
			}
			second, err := app.Command(context.Background(), "add", addInput{ID: "two"}, specter.DispatchOptions{})
			if err != nil {
				t.Fatal(err)
			}
			var public *specter.Error
			if err := <-first.Reactions; !errors.As(err, &public) || public.Code != specter.ErrReactionFailure {
				t.Fatalf("panic ticket was not failed: %v", err)
			}
			if err := <-second.Reactions; err != nil {
				t.Fatalf("later Reaction pass was stranded: %v", err)
			}
			if runs.Load() != 1 {
				t.Fatalf("expected later Reaction to run once, got %d", runs.Load())
			}
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			if err := app.Close(ctx); err != nil {
				t.Fatalf("Close was stranded after panic: %v", err)
			}
		})
	}
}

func TestReactionQueueDoesNotBlockCommandsBeyondFormerCapacity(t *testing.T) {
	const commandCount = 1_100
	started := make(chan struct{})
	release := make(chan struct{})
	var startOnce sync.Once
	var runs atomic.Int64
	command := specter.CommandDefinition{Name: "add", Scenarios: []specter.CommandScenario{{Description: "adds", Input: addInput{ID: "one"}, Expect: []specter.ScenarioEvent{{Type: "added", Payload: added{ID: "one"}}}}}, Handle: specter.DecodeCommand(func(_ context.Context, input addInput) ([]specter.EventDraft, error) {
		return []specter.EventDraft{{Type: "added", Payload: added{ID: input.ID}}}, nil
	})}
	reaction := specter.ReactionDefinition{Name: "blocked", Scenarios: []specter.ReactionScenario{{Description: "handles an add", Given: []specter.ScenarioEvent{{Type: "added", Payload: added{ID: "one"}}}, Expect: []any{"ok"}}}, Apply: map[string]specter.ApplyFunc{"added": func(context.Context, specter.PersistedEvent) error { return nil }}, Handle: func(context.Context, specter.ReactionContext, []specter.PersistedEvent) (any, error) {
		startOnce.Do(func() {
			close(started)
			<-release
		})
		runs.Add(1)
		return "ok", nil
	}}
	app, err := specter.NewApp(specter.Config{Events: []string{"added"}, Commands: []specter.CommandDefinition{command}, Reactions: []specter.ReactionDefinition{reaction}})
	if err != nil {
		t.Fatal(err)
	}
	executions := make([]specter.CommandExecution, 0, commandCount)
	first, err := app.Command(context.Background(), "add", addInput{ID: "0"}, specter.DispatchOptions{})
	if err != nil {
		t.Fatal(err)
	}
	executions = append(executions, first)
	<-started
	issued := make(chan error, 1)
	go func() {
		for index := 1; index < commandCount; index++ {
			execution, commandErr := app.Command(context.Background(), "add", addInput{ID: fmt.Sprintf("%d", index)}, specter.DispatchOptions{})
			if commandErr != nil {
				issued <- commandErr
				return
			}
			executions = append(executions, execution)
		}
		issued <- nil
	}()
	select {
	case err := <-issued:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("Commands blocked behind the Reaction scheduler")
	}
	close(release)
	for _, execution := range executions {
		if err := <-execution.Reactions; err != nil {
			t.Fatal(err)
		}
	}
	if got := runs.Load(); got != commandCount {
		t.Fatalf("expected %d Reaction runs, got %d", commandCount, got)
	}
}

func TestAppCloseDrainsQueuedReactionsAndIsIdempotent(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	var startOnce sync.Once
	var runs atomic.Int64
	command := specter.CommandDefinition{Name: "add", Scenarios: []specter.CommandScenario{{Description: "adds", Input: addInput{ID: "one"}, Expect: []specter.ScenarioEvent{{Type: "added", Payload: added{ID: "one"}}}}}, Handle: specter.DecodeCommand(func(_ context.Context, input addInput) ([]specter.EventDraft, error) {
		return []specter.EventDraft{{Type: "added", Payload: added{ID: input.ID}}}, nil
	})}
	reaction := specter.ReactionDefinition{Name: "count", Scenarios: []specter.ReactionScenario{{Description: "counts", Given: []specter.ScenarioEvent{{Type: "added", Payload: added{ID: "one"}}}, Expect: []any{struct{}{}}}}, Apply: map[string]specter.ApplyFunc{"added": func(context.Context, specter.PersistedEvent) error { return nil }}, Handle: func(context.Context, specter.ReactionContext, []specter.PersistedEvent) (any, error) {
		startOnce.Do(func() { close(started) })
		<-release
		runs.Add(1)
		return struct{}{}, nil
	}}
	app, err := specter.NewApp(specter.Config{Events: []string{"added"}, Commands: []specter.CommandDefinition{command}, Reactions: []specter.ReactionDefinition{reaction}})
	if err != nil {
		t.Fatal(err)
	}
	executions := make([]specter.CommandExecution, 0, 3)
	for _, id := range []string{"one", "two", "three"} {
		execution, commandErr := app.Command(context.Background(), "add", addInput{ID: id}, specter.DispatchOptions{})
		if commandErr != nil {
			t.Fatal(commandErr)
		}
		executions = append(executions, execution)
	}
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("Reaction scheduler did not start")
	}
	closed := make(chan error, 1)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		closed <- app.Close(ctx)
	}()
	select {
	case err := <-closed:
		t.Fatalf("Close returned before queued Reactions drained: %v", err)
	case <-time.After(25 * time.Millisecond):
	}
	close(release)
	if err := <-closed; err != nil {
		t.Fatal(err)
	}
	for _, execution := range executions {
		if err := <-execution.Reactions; err != nil {
			t.Fatal(err)
		}
	}
	if runs.Load() != int64(len(executions)) {
		t.Fatalf("Close dropped Reaction passes: ran %d of %d", runs.Load(), len(executions))
	}
	if err := app.Close(context.Background()); err != nil {
		t.Fatalf("second Close failed: %v", err)
	}
	version := app.EventLog().Version()
	if _, err := app.Command(context.Background(), "add", addInput{ID: "after-close"}, specter.DispatchOptions{}); err == nil {
		t.Fatal("closed App accepted a Command")
	}
	if app.EventLog().Version() != version {
		t.Fatal("Command after Close changed the Event Log")
	}
}

func TestDurableCommandSurvivesProjectionFailureAndRepairsOnNextCommand(t *testing.T) {
	var attempts atomic.Int64
	var observationsMu sync.Mutex
	var observations []specter.Observation
	command := specter.CommandDefinition{Name: "add", Scenarios: []specter.CommandScenario{{Description: "adds", Given: []specter.ScenarioEvent{{Type: "added", Payload: added{ID: "prior"}}}, Input: addInput{ID: "one"}, Expect: []specter.ScenarioEvent{{Type: "added", Payload: added{ID: "one"}}}}}, Apply: map[string]specter.ApplyFunc{"added": func(context.Context, specter.PersistedEvent) error {
		if attempts.Add(1) == 1 {
			return errors.New("projection unavailable")
		}
		return nil
	}}, Handle: specter.DecodeCommand(func(_ context.Context, input addInput) ([]specter.EventDraft, error) {
		return []specter.EventDraft{{Type: "added", Payload: added{ID: input.ID}}}, nil
	})}
	app, err := specter.NewApp(specter.Config{Events: []string{"added"}, Commands: []specter.CommandDefinition{command}, Observe: func(observation specter.Observation) {
		observationsMu.Lock()
		observations = append(observations, observation)
		observationsMu.Unlock()
	}})
	if err != nil {
		t.Fatal(err)
	}
	first, err := app.Command(context.Background(), "add", addInput{ID: "one"}, specter.DispatchOptions{})
	if err != nil {
		t.Fatalf("durable Command was reported as rejected: %v", err)
	}
	if first.Version != 1 || len(first.Events) != 1 || app.EventLog().Version() != 1 {
		t.Fatalf("durable commit was not preserved: %#v", first)
	}
	if err := <-first.Reactions; err != nil {
		t.Fatal(err)
	}
	observationsMu.Lock()
	foundRepair := false
	for _, observation := range observations {
		if observation.Kind == "slice.catch-up.failed" && observation.Attributes["repairRequired"] == true {
			foundRepair = true
		}
	}
	observationsMu.Unlock()
	if !foundRepair {
		t.Fatal("projection repair requirement was not observed")
	}
	second, err := app.Command(context.Background(), "add", addInput{ID: "two"}, specter.DispatchOptions{})
	if err != nil {
		t.Fatalf("next Command did not repair the projection: %v", err)
	}
	if err := <-second.Reactions; err != nil {
		t.Fatal(err)
	}
	if attempts.Load() != 3 {
		t.Fatalf("expected failed apply, repaired apply, and new apply; got %d attempts", attempts.Load())
	}
}

func TestCompletedReactionTicketsExpire(t *testing.T) {
	command := specter.CommandDefinition{Name: "add", Scenarios: []specter.CommandScenario{{Description: "adds", Input: addInput{ID: "one"}, Expect: []specter.ScenarioEvent{{Type: "added", Payload: added{ID: "one"}}}}}, Handle: specter.DecodeCommand(func(_ context.Context, input addInput) ([]specter.EventDraft, error) {
		return []specter.EventDraft{{Type: "added", Payload: added{ID: input.ID}}}, nil
	})}
	app, err := specter.NewApp(specter.Config{Events: []string{"added"}, Commands: []specter.CommandDefinition{command}, ReactionTicketRetention: 10 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	execution, err := app.Command(context.Background(), "add", addInput{ID: "one"}, specter.DispatchOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if err := <-execution.Reactions; err != nil {
		t.Fatal(err)
	}
	if _, ok := app.ReactionTicket(execution.ReactionTicketID); !ok {
		t.Fatal("ticket disappeared before its retention window")
	}
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if _, ok := app.ReactionTicket(execution.ReactionTicketID); !ok {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("completed Reaction ticket did not expire")
}

func TestSubscriptionKeepsLatestValue(t *testing.T) {
	var values []string
	command := specter.CommandDefinition{Name: "add", Scenarios: []specter.CommandScenario{{Description: "adds after an existing value", Given: []specter.ScenarioEvent{{Type: "added", Payload: added{ID: "prior"}}}, Input: addInput{ID: "next"}, Expect: []specter.ScenarioEvent{{Type: "added", Payload: added{ID: "next"}}}}}, Apply: map[string]specter.ApplyFunc{"added": specter.DecodeApply(func(_ context.Context, payload added, _ specter.PersistedEvent) error { return nil })}, Handle: specter.DecodeCommand(func(_ context.Context, input addInput) ([]specter.EventDraft, error) {
		return []specter.EventDraft{{Type: "added", Payload: added{ID: input.ID}}}, nil
	})}
	query := specter.QueryDefinition{Name: "all", Scenarios: []specter.QueryScenario{{Description: "lists", Given: []specter.ScenarioEvent{{Type: "added", Payload: added{ID: "one"}}}, Expect: []string{"one"}}}, Apply: map[string]specter.ApplyFunc{"added": specter.DecodeApply(func(_ context.Context, payload added, _ specter.PersistedEvent) error {
		values = append(values, payload.ID)
		return nil
	})}, Handle: specter.DecodeQuery(func(_ context.Context, _ struct{}) ([]string, error) { return append([]string(nil), values...), nil })}
	app, err := specter.NewApp(specter.Config{Events: []string{"added"}, Commands: []specter.CommandDefinition{command}, Queries: []specter.QueryDefinition{query}})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	subscription, err := app.Subscribe(ctx, "all", struct{}{})
	if err != nil {
		t.Fatal(err)
	}
	defer subscription.Close()
	<-subscription.C
	for _, id := range []string{"one", "two", "three"} {
		execution, err := app.Command(ctx, "add", addInput{ID: id}, specter.DispatchOptions{})
		if err != nil {
			t.Fatal(err)
		}
		<-execution.Reactions
	}
	select {
	case item := <-subscription.C:
		got := item.Value.([]string)
		if got[len(got)-1] != "three" {
			t.Fatalf("expected latest value, got %#v", got)
		}
	case <-time.After(time.Second):
		t.Fatal("subscription did not update")
	}
}

func TestSubscriptionDropsStaleInitialRefreshAndLinksInvalidationCausality(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	var blockOnce sync.Once
	var values []string
	var observationsMu sync.Mutex
	var observations []specter.Observation
	invalidationObserved := make(chan struct{})
	var invalidationOnce sync.Once
	command := specter.CommandDefinition{Name: "add", Scenarios: []specter.CommandScenario{{Description: "adds", Input: addInput{ID: "one"}, Expect: []specter.ScenarioEvent{{Type: "added", Payload: added{ID: "one"}}}}}, Handle: specter.DecodeCommand(func(_ context.Context, input addInput) ([]specter.EventDraft, error) {
		return []specter.EventDraft{{Type: "added", Payload: added{ID: input.ID}}}, nil
	})}
	query := specter.QueryDefinition{Name: "all", Scenarios: []specter.QueryScenario{{Description: "lists", Given: []specter.ScenarioEvent{{Type: "added", Payload: added{ID: "one"}}}, Expect: []string{"one"}}}, Apply: map[string]specter.ApplyFunc{"added": specter.DecodeApply(func(_ context.Context, payload added, _ specter.PersistedEvent) error {
		values = append(values, payload.ID)
		return nil
	})}, Handle: specter.DecodeQuery(func(_ context.Context, _ struct{}) ([]string, error) {
		snapshot := append([]string(nil), values...)
		blockOnce.Do(func() {
			close(started)
			<-release
		})
		return snapshot, nil
	})}
	app, err := specter.NewApp(specter.Config{Events: []string{"added"}, Commands: []specter.CommandDefinition{command}, Queries: []specter.QueryDefinition{query}, Observe: func(observation specter.Observation) {
		observationsMu.Lock()
		observations = append(observations, observation)
		observationsMu.Unlock()
		if observation.Kind == "subscription.invalidated" {
			invalidationOnce.Do(func() { close(invalidationObserved) })
		}
	}})
	if err != nil {
		t.Fatal(err)
	}
	type subscriptionResult struct {
		sub *specter.Subscription
		err error
	}
	created := make(chan subscriptionResult, 1)
	go func() {
		sub, subscribeErr := app.SubscribeJSON(context.Background(), "all", json.RawMessage(`{}`), specter.DispatchOptions{OperationID: "initial-refresh"})
		created <- subscriptionResult{sub: sub, err: subscribeErr}
	}()
	<-started
	execution, err := app.Command(context.Background(), "add", addInput{ID: "one"}, specter.DispatchOptions{OperationID: "command-parent", CorrelationID: "correlation-1"})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-invalidationObserved:
	case <-time.After(time.Second):
		t.Fatal("subscription was not invalidated")
	}
	close(release)
	createdSubscription := <-created
	if createdSubscription.err != nil {
		t.Fatal(createdSubscription.err)
	}
	defer createdSubscription.sub.Close()
	if err := <-execution.Reactions; err != nil {
		t.Fatal(err)
	}
	select {
	case item := <-createdSubscription.sub.C:
		got := item.Value.([]string)
		if len(got) != 1 || got[0] != "one" {
			t.Fatalf("stale initial refresh replaced invalidated value: %#v", got)
		}
	case <-time.After(time.Second):
		t.Fatal("subscription did not publish invalidation refresh")
	}
	observationsMu.Lock()
	defer observationsMu.Unlock()
	var invalidationOperation string
	for _, observation := range observations {
		if observation.Kind == "subscription.invalidated" {
			invalidationOperation = observation.OperationID
			if len(observation.ParentOperationIDs) != 1 || observation.ParentOperationIDs[0] != "command-parent" {
				t.Fatalf("invalidation lost Command cause: %#v", observation)
			}
		}
	}
	if invalidationOperation == "" {
		t.Fatal("missing subscription.invalidated observation")
	}
	foundRefresh := false
	for _, observation := range observations {
		if observation.Kind == "query.started" && observation.OperationID != "initial-refresh" && len(observation.ParentOperationIDs) == 1 && observation.ParentOperationIDs[0] == invalidationOperation {
			foundRefresh = observation.CorrelationID == "correlation-1"
		}
	}
	if !foundRefresh {
		t.Fatal("refresh Query was not assigned a fresh operation causally parented to the invalidation")
	}
}

func TestExpectedVersionAndIdempotencyConflict(t *testing.T) {
	command := specter.CommandDefinition{Name: "add", Scenarios: []specter.CommandScenario{{Description: "adds", Input: addInput{ID: "one"}, Expect: []specter.ScenarioEvent{{Type: "added", Payload: added{ID: "one"}}}}}, Handle: specter.DecodeCommand(func(_ context.Context, input addInput) ([]specter.EventDraft, error) {
		return []specter.EventDraft{{Type: "added", Payload: added{ID: input.ID}}}, nil
	})}
	app, err := specter.NewApp(specter.Config{Events: []string{"added"}, Commands: []specter.CommandDefinition{command}})
	if err != nil {
		t.Fatal(err)
	}
	zero := int64(0)
	execution, err := app.Command(context.Background(), "add", addInput{ID: "one"}, specter.DispatchOptions{ExpectedVersion: &zero, IdempotencyKey: "same"})
	if err != nil {
		t.Fatal(err)
	}
	<-execution.Reactions
	_, err = app.Command(context.Background(), "add", addInput{ID: "different"}, specter.DispatchOptions{IdempotencyKey: "same"})
	var public *specter.Error
	if !errors.As(err, &public) || public.Code != specter.ErrIdempotencyConflict {
		t.Fatalf("expected idempotency conflict, got %v", err)
	}
	_, err = app.Command(context.Background(), "add", addInput{ID: "two"}, specter.DispatchOptions{ExpectedVersion: &zero})
	if !errors.As(err, &public) || public.Code != specter.ErrVersionConflict {
		t.Fatalf("expected version conflict, got %v", err)
	}
}

func TestConformanceRequiresExactGivenApplySet(t *testing.T) {
	_, err := specter.NewApp(specter.Config{Commands: []specter.CommandDefinition{{Name: "bad", Scenarios: []specter.CommandScenario{{Description: "bad", Input: struct{}{}, Expect: []specter.ScenarioEvent{{Type: "made", Payload: struct{}{}}}}}, Apply: map[string]specter.ApplyFunc{"unmentioned": func(context.Context, specter.PersistedEvent) error { return nil }}, Handle: func(context.Context, json.RawMessage) ([]specter.EventDraft, error) { return nil, nil }}}})
	var public *specter.Error
	if !errors.As(err, &public) || public.Code != specter.ErrConformanceFailed {
		t.Fatalf("expected conformance failure, got %v", err)
	}
}
