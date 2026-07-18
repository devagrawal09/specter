package specter_test

import (
	"context"
	"encoding/json"
	"errors"
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
	if err := <-duplicate.Reactions; err != nil {
		t.Fatal(err)
	}
	if reactions.Load() != 1 {
		t.Fatal("duplicate reran Reaction")
	}
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
