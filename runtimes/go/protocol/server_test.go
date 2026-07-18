package protocol_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
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

func TestAllPostFamiliesRejectVersionMismatchAndTrailingJSON(t *testing.T) {
	handler := (&protocol.Server{App: emptyApp(t)}).Handler()
	families := []struct {
		path string
		kind string
	}{
		{path: "/specter/v1/capabilities", kind: "capabilities.request"},
		{path: "/specter/v1/commands", kind: "command.request"},
		{path: "/specter/v1/queries", kind: "query.request"},
		{path: "/specter/v1/subscriptions", kind: "subscription.request"},
		{path: "/specter/v1/observations", kind: "observations.batch"},
	}
	for _, family := range families {
		t.Run(family.kind+" version", func(t *testing.T) {
			body := fmt.Sprintf(`{"protocolVersion":2,"kind":%q,"requestId":"request-1"}`, family.kind)
			request := httptest.NewRequest(http.MethodPost, family.path, strings.NewReader(body))
			request.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != http.StatusUpgradeRequired {
				t.Fatalf("got HTTP %d", response.Code)
			}
		})
		t.Run(family.kind+" trailing JSON", func(t *testing.T) {
			body := fmt.Sprintf(`{"protocolVersion":1,"kind":%q,"requestId":"request-1"} {}`, family.kind)
			request := httptest.NewRequest(http.MethodPost, family.path, strings.NewReader(body))
			request.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != http.StatusBadRequest {
				t.Fatalf("got HTTP %d", response.Code)
			}
			var result struct {
				Error *specter.Error `json:"error"`
			}
			if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
				t.Fatal(err)
			}
			if result.Error == nil || result.Error.Code != specter.ErrInvalidJSON {
				t.Fatalf("unexpected error: %#v", result.Error)
			}
		})
	}
}

func TestClientRejectsMalformedAndContradictoryResponses(t *testing.T) {
	queryRequest := protocol.QueryRequest{Envelope: protocol.Envelope{RequestID: "query-request"}, OperationID: "operation-1", Query: protocol.OperationEnvelope{Type: "value", Payload: json.RawMessage(`{}`)}}
	queryCases := []struct {
		name string
		body string
	}{
		{name: "result and error", body: `{"protocolVersion":1,"kind":"query.response","requestId":"query-request","operationId":"operation-1","result":"secret","error":{"code":"SPECTER_INFRASTRUCTURE_FAILURE","message":"Runtime operation failed."}}`},
		{name: "neither result nor error", body: `{"protocolVersion":1,"kind":"query.response","requestId":"query-request","operationId":"operation-1"}`},
	}
	for _, test := range queryCases {
		t.Run(test.name, func(t *testing.T) {
			client := &protocol.Client{BaseURL: "http://specter.invalid/specter/v1", HTTPClient: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
				return jsonResponse(http.StatusOK, test.body), nil
			})}}
			if _, err := client.Query(context.Background(), queryRequest); err == nil {
				t.Fatal("expected contradictory Query response to be rejected")
			}
		})
	}
	commandRequest := protocol.CommandRequest{Envelope: protocol.Envelope{RequestID: "command-request"}, OperationID: "operation-1", Command: protocol.OperationEnvelope{Type: "set", Payload: json.RawMessage(`{}`)}}
	client := &protocol.Client{BaseURL: "http://specter.invalid/specter/v1", HTTPClient: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return jsonResponse(http.StatusOK, `{"protocolVersion":1,"kind":"command.response","requestId":"command-request","operationId":"operation-1","status":"committed","version":1,"events":[],"error":{"code":"SPECTER_INFRASTRUCTURE_FAILURE","message":"Runtime operation failed."}}`), nil
	})}}
	if _, err := client.Command(context.Background(), commandRequest); err == nil {
		t.Fatal("expected contradictory Command response to be rejected")
	}
	ticketClient := &protocol.Client{BaseURL: "http://specter.invalid/specter/v1", HTTPClient: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return jsonResponse(http.StatusOK, `{"protocolVersion":1,"kind":"reaction-ticket.response","requestId":"ticket-request","reactionTicketId":"ticket-1","status":"completed","error":{"code":"SPECTER_INFRASTRUCTURE_FAILURE","message":"Runtime operation failed."}}`), nil
	})}}
	if _, err := ticketClient.ReactionTicket(context.Background(), "ticket-1", "ticket-request"); err == nil {
		t.Fatal("expected contradictory Reaction ticket response to be rejected")
	}
}

func TestObservationClientRequiresExactAcknowledgement(t *testing.T) {
	batch := protocol.RuntimeObservationBatch{Envelope: protocol.Envelope{RequestID: "observation-request"}, Observations: []protocol.RuntimeObservation{{Observation: specter.Observation{ObservationID: "observation-1"}}}}
	tests := []struct {
		name   string
		status int
		body   string
	}{
		{name: "malformed", status: http.StatusOK, body: `{`},
		{name: "mismatched request", status: http.StatusOK, body: `{"protocolVersion":1,"kind":"observations.ack","requestId":"different","accepted":1,"duplicates":0}`},
		{name: "partial", status: http.StatusOK, body: `{"protocolVersion":1,"kind":"observations.ack","requestId":"observation-request","accepted":0,"duplicates":0}`},
		{name: "empty", status: http.StatusOK, body: `{"protocolVersion":1,"kind":"observations.ack","requestId":"observation-request"}`},
		{name: "non-2xx", status: http.StatusServiceUnavailable, body: `{"protocolVersion":1,"kind":"observations.ack","requestId":"observation-request","accepted":1,"duplicates":0}`},
		{name: "unknown rejected id", status: http.StatusOK, body: `{"protocolVersion":1,"kind":"observations.ack","requestId":"observation-request","accepted":0,"duplicates":0,"rejectedObservationIds":["different"]}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			client := &protocol.Client{BaseURL: "http://specter.invalid/specter/v1", HTTPClient: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
				return jsonResponse(test.status, test.body), nil
			})}}
			if _, err := client.SendObservations(context.Background(), batch); err == nil {
				t.Fatal("expected acknowledgement to be rejected")
			}
		})
	}
	client := &protocol.Client{BaseURL: "http://specter.invalid/specter/v1", HTTPClient: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return jsonResponse(http.StatusOK, `{"protocolVersion":1,"kind":"observations.ack","requestId":"observation-request","accepted":0,"duplicates":0,"rejectedObservationIds":["observation-1"]}`), nil
	})}}
	if _, err := client.SendObservations(context.Background(), batch); err != nil {
		t.Fatalf("explicitly rejected observation was not exactly accounted for: %v", err)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

func jsonResponse(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Status: fmt.Sprintf("%d test", status), Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(body))}
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

func TestQueryAndSubscriptionPreserveSuccessfulNullResults(t *testing.T) {
	query := specter.QueryDefinition{
		Name:      "nothing",
		Scenarios: []specter.QueryScenario{{Description: "returns JSON null", Expect: nil}},
		Handle:    func(context.Context, json.RawMessage) (any, error) { return nil, nil },
	}
	app, err := specter.NewApp(specter.Config{Queries: []specter.QueryDefinition{query}})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer((&protocol.Server{App: app}).Handler())
	defer server.Close()
	client := &protocol.Client{BaseURL: server.URL + "/specter/v1"}
	queryResponse, err := client.Query(context.Background(), protocol.QueryRequest{OperationID: "query-null", Query: protocol.OperationEnvelope{Type: "nothing", Payload: json.RawMessage(`{}`)}})
	if err != nil {
		t.Fatal(err)
	}
	if queryResponse.Result != nil || queryResponse.Error != nil {
		t.Fatalf("unexpected null Query response: %#v", queryResponse)
	}

	ctx, cancel := context.WithCancel(context.Background())
	messages, failures, err := client.Subscribe(ctx, protocol.SubscriptionRequest{OperationID: "subscription-null", Query: protocol.OperationEnvelope{Type: "nothing", Payload: json.RawMessage(`{}`)}})
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	select {
	case message := <-messages:
		if message.Kind != "subscription.value" || message.Result != nil || message.Error != nil {
			t.Fatalf("unexpected null subscription value: %#v", message)
		}
	case failure := <-failures:
		cancel()
		t.Fatalf("subscription failed before its null value: %v", failure)
	case <-time.After(time.Second):
		cancel()
		t.Fatal("subscription did not emit its null value")
	}
	cancel()
	for range failures {
	}
}

func TestFailedQueryAndSubscriptionMessagesOmitResult(t *testing.T) {
	failure := &specter.Error{Code: specter.ErrInfrastructure, Message: "Runtime operation failed."}
	queryBytes, err := json.Marshal(protocol.QueryResponse{Envelope: protocol.Envelope{ProtocolVersion: 1, Kind: "query.response", RequestID: "query"}, OperationID: "operation", Result: "must-not-appear", Error: failure})
	if err != nil {
		t.Fatal(err)
	}
	subscriptionBytes, err := json.Marshal(protocol.SubscriptionMessage{Envelope: protocol.Envelope{ProtocolVersion: 1, Kind: "subscription.error", RequestID: "subscription"}, OperationID: "operation", Result: "must-not-appear", Error: failure})
	if err != nil {
		t.Fatal(err)
	}
	for name, encoded := range map[string][]byte{"query": queryBytes, "subscription": subscriptionBytes} {
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(encoded, &fields); err != nil {
			t.Fatal(err)
		}
		if _, exists := fields["result"]; exists {
			t.Fatalf("%s error response contained result: %s", name, encoded)
		}
		if _, exists := fields["error"]; !exists {
			t.Fatalf("%s error response omitted error: %s", name, encoded)
		}
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

func TestMalformedRuntimeObservationsAreRejected(t *testing.T) {
	validEvent := func() map[string]any {
		return map[string]any{"eventId": "event-1", "type": "todo-added", "order": float64(1), "recordedAt": "2026-07-18T12:00:00.000Z", "commitVersion": float64(1)}
	}
	tests := []struct {
		name   string
		mutate func(map[string]any)
	}{
		{name: "non-Z observed timestamp", mutate: func(value map[string]any) { value["observedAt"] = "2026-07-18T12:00:00+00:00" }},
		{name: "negative cursor", mutate: func(value map[string]any) { value["cursor"] = float64(-1) }},
		{name: "unsafe dropped count", mutate: func(value map[string]any) { value["droppedCount"] = float64(9007199254740992) }},
		{name: "descending triggering range", mutate: func(value map[string]any) {
			value["triggeringEventOrder"] = map[string]any{"from": float64(2), "to": float64(1)}
		}},
		{name: "negative triggering range", mutate: func(value map[string]any) {
			value["triggeringEventOrder"] = map[string]any{"from": float64(-1), "to": float64(1)}
		}},
		{name: "empty optional causal id", mutate: func(value map[string]any) { value["correlationId"] = "" }},
		{name: "empty parent id", mutate: func(value map[string]any) { value["parentOperationIds"] = []any{"parent", ""} }},
		{name: "duplicate parent id", mutate: func(value map[string]any) { value["parentOperationIds"] = []any{"parent", "parent"} }},
		{name: "duplicate triggering event id", mutate: func(value map[string]any) { value["triggeringEventIds"] = []any{"event-1", "event-1"} }},
		{name: "missing Event identity", mutate: func(value map[string]any) {
			event := validEvent()
			delete(event, "eventId")
			value["events"] = []any{event}
		}},
		{name: "non-Z Event timestamp", mutate: func(value map[string]any) {
			event := validEvent()
			event["recordedAt"] = "2026-07-18T12:00:00+00:00"
			value["events"] = []any{event}
		}},
		{name: "negative Event order", mutate: func(value map[string]any) {
			event := validEvent()
			event["order"] = float64(-1)
			value["events"] = []any{event}
		}},
		{name: "unsafe Event commit version", mutate: func(value map[string]any) {
			event := validEvent()
			event["commitVersion"] = float64(9007199254740992)
			value["events"] = []any{event}
		}},
	}
	app := emptyApp(t)
	handler := (&protocol.Server{App: app, AcceptObservations: func(context.Context, protocol.RuntimeObservationBatch) (protocol.ObservationAcknowledgement, error) {
		t.Fatal("collector accepted a malformed runtime observation")
		return protocol.ObservationAcknowledgement{}, nil
	}}).Handler()
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			observation := map[string]any{
				"observationId": "observation-1",
				"sequence":      float64(1),
				"observedAt":    "2026-07-18T12:00:00.000Z",
				"kind":          "command.started",
				"operationId":   "operation-1",
				"source": map[string]any{
					"application": "todo", "environment": "test", "runtimeLanguage": "go", "runtimeVersion": "test", "instanceId": "instance", "eventLogId": "log",
				},
			}
			test.mutate(observation)
			body, err := json.Marshal(map[string]any{"protocolVersion": 1, "kind": "observations.batch", "requestId": "request-1", "observations": []any{observation}})
			if err != nil {
				t.Fatal(err)
			}
			request := httptest.NewRequest(http.MethodPost, "/specter/v1/observations", bytes.NewReader(body))
			request.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != http.StatusBadRequest {
				t.Fatalf("got HTTP %d: %s", response.Code, response.Body.String())
			}
			var result protocol.ObservationAcknowledgement
			if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
				t.Fatal(err)
			}
			if result.Error == nil || result.Error.Code != specter.ErrInvalidMessage {
				t.Fatalf("unexpected error: %#v", result.Error)
			}
		})
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
