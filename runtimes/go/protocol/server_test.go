package protocol_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/devagrawal09/specter/runtimes/go/protocol"
	"github.com/devagrawal09/specter/runtimes/go/specter"
)

func TestCapabilityNegotiationAndUnknownOptionalFields(t *testing.T) {
	app := emptyApp(t)
	server := httptest.NewServer((&protocol.Server{App: app, RuntimeVersion: "test"}).Handler())
	defer server.Close()
	body := []byte(`{"protocolVersion":1,"kind":"capabilities.request","requestId":"req-1","required":["commands"],"unknownOptional":true}`)
	response, err := http.Post(server.URL+"/specter/v1/capabilities", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("got HTTP %d", response.StatusCode)
	}
	var result protocol.CapabilitiesResponse
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if result.Runtime.Language != "go" || result.ProtocolVersion != 1 || len(result.Negotiated) != 1 {
		t.Fatalf("unexpected capabilities: %#v", result)
	}
}

func TestRejectsVersionMismatch(t *testing.T) {
	app := emptyApp(t)
	server := httptest.NewServer((&protocol.Server{App: app}).Handler())
	defer server.Close()
	body := []byte(`{"protocolVersion":2,"kind":"capabilities.request","requestId":"req-1"}`)
	response, err := http.Post(server.URL+"/specter/v1/capabilities", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusUpgradeRequired {
		t.Fatalf("got HTTP %d", response.StatusCode)
	}
}

func TestClientServerCommandAndQuery(t *testing.T) {
	var projected string
	command := specter.CommandDefinition{Name: "set", Scenarios: []specter.CommandScenario{{Description: "sets", Input: map[string]string{"value": "yes"}, Expect: []specter.ScenarioEvent{{Type: "set", Payload: map[string]string{"value": "yes"}}}}}, Handle: func(_ context.Context, payload json.RawMessage) ([]specter.EventDraft, error) {
		var value map[string]string
		if err := json.Unmarshal(payload, &value); err != nil {
			return nil, err
		}
		return []specter.EventDraft{{Type: "set", Payload: value}}, nil
	}}
	query := specter.QueryDefinition{Name: "value", Scenarios: []specter.QueryScenario{{Description: "reads", Given: []specter.ScenarioEvent{{Type: "set", Payload: map[string]string{"value": "yes"}}}, Expect: "yes"}}, Apply: map[string]specter.ApplyFunc{"set": func(_ context.Context, event specter.PersistedEvent) error {
		var value map[string]string
		if err := json.Unmarshal(event.Payload, &value); err != nil {
			return err
		}
		projected = value["value"]
		return nil
	}}, Handle: func(context.Context, json.RawMessage) (any, error) { return projected, nil }}
	app, err := specter.NewApp(specter.Config{Events: []string{"set"}, Commands: []specter.CommandDefinition{command}, Queries: []specter.QueryDefinition{query}})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer((&protocol.Server{App: app}).Handler())
	defer server.Close()
	client := &protocol.Client{BaseURL: server.URL + "/specter/v1"}
	commandResponse, err := client.Command(context.Background(), protocol.CommandRequest{OperationID: "op-1", Command: protocol.OperationEnvelope{Type: "set", Payload: json.RawMessage(`{"value":"yes"}`)}})
	if err != nil {
		t.Fatal(err)
	}
	if commandResponse.Status != "committed" {
		t.Fatalf("unexpected response: %#v", commandResponse)
	}
	queryResponse, err := client.Query(context.Background(), protocol.QueryRequest{OperationID: "op-2", Query: protocol.OperationEnvelope{Type: "value", Payload: json.RawMessage(`{}`)}})
	if err != nil {
		t.Fatal(err)
	}
	if queryResponse.Result != "yes" {
		t.Fatalf("unexpected result: %#v", queryResponse.Result)
	}
}

func TestSharedGoldenFixturesDecode(t *testing.T) {
	commandBytes, err := os.ReadFile("../../../protocol/fixtures/command-commit.json")
	if err != nil {
		t.Fatal(err)
	}
	var command protocol.CommandResponse
	if err := json.Unmarshal(commandBytes, &command); err != nil {
		t.Fatal(err)
	}
	if command.Kind != "command.response" || command.Events[0].EventID != "event-1" {
		t.Fatalf("unexpected command fixture: %#v", command)
	}
	observationBytes, err := os.ReadFile("../../../protocol/fixtures/observation-batch.json")
	if err != nil {
		t.Fatal(err)
	}
	var batch protocol.RuntimeObservationBatch
	if err := json.Unmarshal(observationBytes, &batch); err != nil {
		t.Fatal(err)
	}
	if len(batch.Observations) != 1 || batch.Observations[0].Source.InstanceID != "process-1" || batch.Observations[0].Events[0].EventID != "event-1" {
		t.Fatalf("unexpected observation fixture: %#v", batch)
	}
}

func TestSharedObservationFixtureIsAccepted(t *testing.T) {
	fixture, err := os.ReadFile("../../../protocol/fixtures/observation-batch.json")
	if err != nil {
		t.Fatal(err)
	}
	app := emptyApp(t)
	server := httptest.NewServer((&protocol.Server{App: app, AcceptObservations: func(_ context.Context, batch protocol.RuntimeObservationBatch) (protocol.ObservationAcknowledgement, error) {
		return protocol.ObservationAcknowledgement{Accepted: len(batch.Observations)}, nil
	}}).Handler())
	defer server.Close()
	response, err := http.Post(server.URL+"/specter/v1/observations", "application/json", bytes.NewReader(fixture))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("got HTTP %d", response.StatusCode)
	}
	var acknowledgement protocol.ObservationAcknowledgement
	if err := json.NewDecoder(response.Body).Decode(&acknowledgement); err != nil {
		t.Fatal(err)
	}
	if acknowledgement.Accepted != 1 || acknowledgement.Kind != "observations.ack" {
		t.Fatalf("unexpected acknowledgement: %#v", acknowledgement)
	}
}

func TestSharedMalformedCommandIsRejected(t *testing.T) {
	fixture, err := os.ReadFile("../../../protocol/fixtures/malformed-command.json")
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer((&protocol.Server{App: emptyApp(t)}).Handler())
	defer server.Close()
	response, err := http.Post(server.URL+"/specter/v1/commands", "application/json", bytes.NewReader(fixture))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("got HTTP %d", response.StatusCode)
	}
	var body struct {
		Error *specter.Error `json:"error"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Error == nil || body.Error.Code != specter.ErrInvalidMessage {
		t.Fatalf("unexpected error: %#v", body.Error)
	}
}

func TestQueryAndSubscriptionFailuresAreRedactedAndTerminal(t *testing.T) {
	privateMessage := "postgres://admin:secret@database.internal/app"
	var fail atomic.Bool
	command := specter.CommandDefinition{Name: "change", Scenarios: []specter.CommandScenario{{Description: "changes", Input: struct{}{}, Expect: []specter.ScenarioEvent{{Type: "changed", Payload: struct{}{}}}}}, Handle: func(context.Context, json.RawMessage) ([]specter.EventDraft, error) {
		return []specter.EventDraft{{Type: "changed", Payload: struct{}{}}}, nil
	}}
	query := specter.QueryDefinition{Name: "value", Scenarios: []specter.QueryScenario{{Description: "reads", Given: []specter.ScenarioEvent{{Type: "changed", Payload: struct{}{}}}, Expect: "ok"}}, Apply: map[string]specter.ApplyFunc{"changed": func(context.Context, specter.PersistedEvent) error { return nil }}, Handle: func(context.Context, json.RawMessage) (any, error) {
		if fail.Load() {
			return nil, errors.New(privateMessage)
		}
		return "ok", nil
	}}
	app, err := specter.NewApp(specter.Config{Events: []string{"changed"}, Commands: []specter.CommandDefinition{command}, Queries: []specter.QueryDefinition{query}})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer((&protocol.Server{App: app}).Handler())
	defer server.Close()
	client := &protocol.Client{BaseURL: server.URL + "/specter/v1"}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	messages, failures, err := client.Subscribe(ctx, protocol.SubscriptionRequest{OperationID: "subscription-op", Query: protocol.OperationEnvelope{Type: "value", Payload: json.RawMessage(`{}`)}})
	if err != nil {
		t.Fatal(err)
	}
	initial := <-messages
	if initial.Kind != "subscription.value" || initial.Result != "ok" {
		t.Fatalf("unexpected initial subscription message: %#v", initial)
	}
	fail.Store(true)
	queryResponse, err := client.Query(ctx, protocol.QueryRequest{OperationID: "query-op", Query: protocol.OperationEnvelope{Type: "value", Payload: json.RawMessage(`{}`)}})
	if err == nil || queryResponse.Error == nil {
		t.Fatalf("expected public Query error, got %#v", queryResponse)
	}
	if queryResponse.Error.Message == privateMessage {
		t.Fatal("Query leaked a private runtime error")
	}
	execution, err := app.Command(ctx, "change", struct{}{}, specter.DispatchOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if err := <-execution.Reactions; err != nil {
		t.Fatal(err)
	}
	select {
	case message := <-messages:
		if message.Kind != "subscription.error" || message.Error == nil {
			t.Fatalf("expected subscription.error, got %#v", message)
		}
		if message.Error.Message == privateMessage {
			t.Fatal("subscription leaked a private runtime error")
		}
	case <-ctx.Done():
		t.Fatal("subscription did not emit an error")
	}
	select {
	case _, open := <-messages:
		if open {
			t.Fatal("subscription remained open after subscription.error")
		}
	case <-ctx.Done():
		t.Fatal("subscription did not close after subscription.error")
	}
	for failure := range failures {
		if failure != nil {
			t.Fatal(failure)
		}
	}
}

func emptyApp(t *testing.T) *specter.App {
	t.Helper()
	app, err := specter.NewApp(specter.Config{})
	if err != nil {
		t.Fatal(err)
	}
	return app
}
