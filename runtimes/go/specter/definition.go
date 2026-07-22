package specter

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
)

type ScenarioEvent struct {
	Type    string
	Payload any
}
type CommandScenario struct {
	Description  string
	Given        []ScenarioEvent
	Input        any
	Expect       []ScenarioEvent
	RejectReason string
}
type QueryScenario struct {
	Description string
	Given       []ScenarioEvent
	Input       any
	Expect      any
}
type ReactionScenario struct {
	Description string
	Given       []ScenarioEvent
	Expect      []any
}

type ApplyFunc func(context.Context, PersistedEvent) error
type CommandHandle func(context.Context, json.RawMessage) ([]EventDraft, error)
type QueryHandle func(context.Context, json.RawMessage) (any, error)
type ReactionHandle func(context.Context, ReactionContext, []PersistedEvent) (any, error)

type CommandDefinition struct {
	Name      string
	Apply     map[string]ApplyFunc
	Handle    CommandHandle
	Scenarios []CommandScenario
	allowed   map[string]struct{}
}
type QueryDefinition struct {
	Name      string
	Apply     map[string]ApplyFunc
	Handle    QueryHandle
	Scenarios []QueryScenario
}
type ReactionDefinition struct {
	Name      string
	Apply     map[string]ApplyFunc
	Handle    ReactionHandle
	Scenarios []ReactionScenario
}

// DecodeCommand makes a typed, language-native handler available to the dynamic runtime.
func DecodeCommand[I any](handle func(context.Context, I) ([]EventDraft, error)) CommandHandle {
	return func(ctx context.Context, raw json.RawMessage) ([]EventDraft, error) {
		var input I
		if err := json.Unmarshal(raw, &input); err != nil {
			return nil, newError(ErrInvalidInput, "Invalid command input.", nil, err)
		}
		return handle(ctx, input)
	}
}

func DecodeQuery[I any, O any](handle func(context.Context, I) (O, error)) QueryHandle {
	return func(ctx context.Context, raw json.RawMessage) (any, error) {
		var input I
		if err := json.Unmarshal(raw, &input); err != nil {
			return nil, newError(ErrInvalidInput, "Invalid query input.", nil, err)
		}
		return handle(ctx, input)
	}
}

func DecodeApply[P any](handle func(context.Context, P, PersistedEvent) error) ApplyFunc {
	return func(ctx context.Context, event PersistedEvent) error {
		var payload P
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return newError(ErrInvalidInput, fmt.Sprintf("Invalid payload for Event %q.", event.Type), nil, err)
		}
		return handle(ctx, payload, event)
	}
}

func validateDefinitions(commands []CommandDefinition, queries []QueryDefinition, reactions []ReactionDefinition) error {
	names := map[string]string{}
	check := func(kind, name string, scenarioCount int) error {
		if name == "" {
			return newError(ErrConformanceFailed, kind+" name must not be empty.", nil, nil)
		}
		if prior, ok := names[name]; ok {
			return newError(ErrConformanceFailed, fmt.Sprintf("%s %q conflicts with registered %s.", kind, name, prior), nil, nil)
		}
		names[name] = kind
		if scenarioCount == 0 {
			return newError(ErrConformanceFailed, fmt.Sprintf("%s %q requires at least one Scenario.", kind, name), nil, nil)
		}
		return nil
	}
	for i := range commands {
		if err := check("Command", commands[i].Name, len(commands[i].Scenarios)); err != nil {
			return err
		}
		if commands[i].Handle == nil {
			return newError(ErrConformanceFailed, fmt.Sprintf("Command %q requires a handler.", commands[i].Name), nil, nil)
		}
		commands[i].allowed = map[string]struct{}{}
		given := map[string]struct{}{}
		descriptions := map[string]struct{}{}
		for _, scenario := range commands[i].Scenarios {
			if scenario.Description == "" {
				return newError(ErrConformanceFailed, "Scenario description must not be empty.", nil, nil)
			}
			if _, exists := descriptions[scenario.Description]; exists {
				return newError(ErrConformanceFailed, fmt.Sprintf("Duplicate Scenario description %q.", scenario.Description), nil, nil)
			}
			descriptions[scenario.Description] = struct{}{}
			for _, event := range scenario.Given {
				given[event.Type] = struct{}{}
			}
			for _, event := range scenario.Expect {
				commands[i].allowed[event.Type] = struct{}{}
			}
			if scenario.RejectReason == "" && len(scenario.Expect) == 0 {
				return newError(ErrConformanceFailed, fmt.Sprintf("Accepted Command Scenario %q must expect at least one Event.", scenario.Description), nil, nil)
			}
			if scenario.RejectReason != "" && len(scenario.Expect) > 0 {
				return newError(ErrConformanceFailed, fmt.Sprintf("Rejected Command Scenario %q must expect no Events.", scenario.Description), nil, nil)
			}
		}
		if !sameKeys(given, commands[i].Apply) {
			return newError(ErrConformanceFailed, fmt.Sprintf("Command %q Given Event types must exactly match its apply registrations.", commands[i].Name), nil, nil)
		}
	}
	for _, query := range queries {
		if err := check("Query", query.Name, len(query.Scenarios)); err != nil {
			return err
		}
		if query.Handle == nil {
			return newError(ErrConformanceFailed, fmt.Sprintf("Query %q requires a handler.", query.Name), nil, nil)
		}
		given := map[string]struct{}{}
		for _, scenario := range query.Scenarios {
			for _, event := range scenario.Given {
				given[event.Type] = struct{}{}
			}
		}
		if !sameKeys(given, query.Apply) {
			return newError(ErrConformanceFailed, fmt.Sprintf("Query %q Given Event types must exactly match its apply registrations.", query.Name), nil, nil)
		}
	}
	for _, reaction := range reactions {
		if err := check("Reaction", reaction.Name, len(reaction.Scenarios)); err != nil {
			return err
		}
		if reaction.Handle == nil {
			return newError(ErrConformanceFailed, fmt.Sprintf("Reaction %q requires a handler.", reaction.Name), nil, nil)
		}
		given := map[string]struct{}{}
		for _, scenario := range reaction.Scenarios {
			for _, event := range scenario.Given {
				given[event.Type] = struct{}{}
			}
		}
		if !sameKeys(given, reaction.Apply) {
			return newError(ErrConformanceFailed, fmt.Sprintf("Reaction %q Given Event types must exactly match its apply registrations.", reaction.Name), nil, nil)
		}
	}
	return nil
}

func sameKeys[T any](left map[string]struct{}, right map[string]T) bool {
	if len(left) != len(right) {
		return false
	}
	for key := range left {
		if _, ok := right[key]; !ok {
			return false
		}
	}
	return true
}

// TestingT is the subset of testing.T used by the language-native Scenario hooks.
type TestingT interface {
	Helper()
	Errorf(string, ...any)
}
type CommandScenarioExecutor func(given []ScenarioEvent, input any) (events []ScenarioEvent, rejection string)
type QueryScenarioExecutor func(given []ScenarioEvent, input any) any
type ReactionScenarioExecutor func(given []ScenarioEvent) []any

func RunCommandScenarios(t TestingT, scenarios []CommandScenario, execute CommandScenarioExecutor) {
	t.Helper()
	for _, scenario := range scenarios {
		events, rejection := execute(scenario.Given, scenario.Input)
		if !reflect.DeepEqual(events, scenario.Expect) {
			t.Errorf("Scenario %q Events mismatch: got %#v, want %#v", scenario.Description, events, scenario.Expect)
		}
		if rejection != scenario.RejectReason {
			t.Errorf("Scenario %q rejection mismatch: got %q, want %q", scenario.Description, rejection, scenario.RejectReason)
		}
	}
}
func RunQueryScenarios(t TestingT, scenarios []QueryScenario, execute QueryScenarioExecutor) {
	t.Helper()
	for _, scenario := range scenarios {
		result := execute(scenario.Given, scenario.Input)
		if !reflect.DeepEqual(result, scenario.Expect) {
			t.Errorf("Scenario %q Query result mismatch: got %#v, want %#v", scenario.Description, result, scenario.Expect)
		}
	}
}
func RunReactionScenarios(t TestingT, scenarios []ReactionScenario, execute ReactionScenarioExecutor) {
	t.Helper()
	for _, scenario := range scenarios {
		result := execute(scenario.Given)
		if !reflect.DeepEqual(result, scenario.Expect) {
			t.Errorf("Scenario %q Reaction effects mismatch: got %#v, want %#v", scenario.Description, result, scenario.Expect)
		}
	}
}
