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
	"sync"
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

func TestCapabilityClientRejectsMissingOrNullRequiredResponseFields(t *testing.T) {
	for _, test := range []struct {
		name string
		body string
	}{
		{name: "missing supported", body: `{"protocolVersion":1,"kind":"capabilities.response","requestId":"capability-client","runtime":{"language":"go","version":"test"},"negotiated":[]}`},
		{name: "null supported", body: `{"protocolVersion":1,"kind":"capabilities.response","requestId":"capability-client","runtime":{"language":"go","version":"test"},"supported":null,"negotiated":[]}`},
		{name: "duplicate supported", body: `{"protocolVersion":1,"kind":"capabilities.response","requestId":"capability-client","runtime":{"language":"go","version":"test"},"supported":["commands","commands"],"negotiated":[]}`},
		{name: "null runtime language", body: `{"protocolVersion":1,"kind":"capabilities.response","requestId":"capability-client","runtime":{"language":null,"version":"test"},"supported":[],"negotiated":[]}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			client := &protocol.Client{BaseURL: "http://specter.invalid/specter/v1", HTTPClient: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
				return jsonResponse(http.StatusOK, test.body), nil
			})}}
			_, err := client.Capabilities(context.Background(), protocol.CapabilitiesRequest{Envelope: protocol.Envelope{RequestID: "capability-client"}})
			if err == nil {
				t.Fatal("malformed capabilities response was accepted")
			}
		})
	}
}

func TestServerRejectsNullCapabilityArraysAndInvalidObservationBatchShape(t *testing.T) {
	handler := (&protocol.Server{App: emptyApp(t), RuntimeVersion: "test", AcceptObservations: func(context.Context, protocol.RuntimeObservationBatch) (protocol.ObservationAcknowledgement, error) {
		t.Fatal("invalid observation batch reached sink")
		return protocol.ObservationAcknowledgement{}, nil
	}}).Handler()
	for _, body := range []string{
		`{"protocolVersion":1,"kind":"capabilities.request","requestId":"request-1","required":null}`,
		`{"protocolVersion":1,"kind":"capabilities.request","requestId":"request-1","optional":null}`,
		`{"protocolVersion":1,"kind":"capabilities.request","requestId":"request-1","required":["commands","commands"]}`,
	} {
		request := httptest.NewRequest(http.MethodPost, "/specter/v1/capabilities", strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), string(specter.ErrInvalidMessage)) {
			t.Fatalf("null capability array was accepted: HTTP %d %s", response.Code, response.Body.String())
		}
	}
	for _, body := range []string{
		`{"protocolVersion":1,"kind":"observations.batch","requestId":"request-1"}`,
		`{"protocolVersion":1,"kind":"observations.batch","requestId":"request-1","observations":null}`,
	} {
		request := httptest.NewRequest(http.MethodPost, "/specter/v1/observations", strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), string(specter.ErrInvalidMessage)) {
			t.Fatalf("invalid observation batch was accepted: HTTP %d %s", response.Code, response.Body.String())
		}
	}
}

func TestServerDistinguishesInvalidJSONFromInvalidMessage(t *testing.T) {
	handler := (&protocol.Server{App: emptyApp(t)}).Handler()
	for _, test := range []struct {
		name string
		body string
		code specter.ErrorCode
	}{
		{name: "syntax", body: `{`, code: specter.ErrInvalidJSON},
		{name: "null", body: `null`, code: specter.ErrInvalidMessage},
		{name: "schema type", body: `{"protocolVersion":"one","kind":"command.request","requestId":"request-1","operationId":"operation-1","command":{"type":"missing","payload":{}}}`, code: specter.ErrInvalidMessage},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/specter/v1/commands", strings.NewReader(test.body))
			request.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), string(test.code)) {
				t.Fatalf("unexpected classification: HTTP %d %s", response.Code, response.Body.String())
			}
		})
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

func TestPostEndpointsRequireExactJSONMediaType(t *testing.T) {
	handler := (&protocol.Server{App: emptyApp(t)}).Handler()
	body := `{"protocolVersion":1,"kind":"capabilities.request","requestId":"request-1"}`
	for _, test := range []struct {
		contentType string
		want        int
	}{
		{contentType: "application/json", want: http.StatusOK},
		{contentType: "application/json; charset=utf-8", want: http.StatusOK},
		{contentType: "application/jsonx", want: http.StatusUnsupportedMediaType},
		{contentType: "application/json garbage", want: http.StatusUnsupportedMediaType},
	} {
		t.Run(test.contentType, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/specter/v1/capabilities", strings.NewReader(body))
			request.Header.Set("Content-Type", test.contentType)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != test.want {
				t.Fatalf("got HTTP %d: %s", response.Code, response.Body.String())
			}
			if test.want == http.StatusUnsupportedMediaType {
				var result struct {
					Error *specter.Error `json:"error"`
				}
				if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
					t.Fatal(err)
				}
				if result.Error == nil || result.Error.Code != specter.ErrInvalidMessage {
					t.Fatalf("unexpected error: %#v", result.Error)
				}
			}
		})
	}
}

func TestRequestOptionalFieldsRejectNullAndWrongTypes(t *testing.T) {
	handler := (&protocol.Server{App: emptyApp(t)}).Handler()
	type family struct {
		name      string
		path      string
		base      map[string]any
		optionals map[string]any
	}
	common := map[string]any{
		"correlationId":        float64(1),
		"parentOperationIds":   "parent",
		"triggeringEventIds":   "event",
		"triggeringEventOrder": []any{float64(1), float64(2)},
		"reactionPassId":       float64(1),
		"deliveryId":           float64(1),
		"attemptId":            float64(1),
	}
	clone := func(values map[string]any) map[string]any {
		result := make(map[string]any, len(values))
		for name, value := range values {
			result[name] = value
		}
		return result
	}
	commandFields := clone(common)
	commandFields["idempotencyKey"] = float64(1)
	commandFields["expectedVersion"] = "one"
	subscriptionFields := clone(common)
	subscriptionFields["afterSequence"] = "one"
	families := []family{
		{name: "command", path: "/specter/v1/commands", base: map[string]any{"protocolVersion": float64(1), "kind": "command.request", "requestId": "request-1", "operationId": "operation-1", "command": map[string]any{"type": "set", "payload": map[string]any{}}}, optionals: commandFields},
		{name: "query", path: "/specter/v1/queries", base: map[string]any{"protocolVersion": float64(1), "kind": "query.request", "requestId": "request-1", "operationId": "operation-1", "query": map[string]any{"type": "value", "payload": map[string]any{}}}, optionals: common},
		{name: "subscription", path: "/specter/v1/subscriptions", base: map[string]any{"protocolVersion": float64(1), "kind": "subscription.request", "requestId": "request-1", "operationId": "operation-1", "query": map[string]any{"type": "value", "payload": map[string]any{}}}, optionals: subscriptionFields},
	}
	for _, family := range families {
		for field, wrongType := range family.optionals {
			malformedValues := []struct {
				name  string
				value any
			}{{name: "null", value: nil}, {name: "wrong type", value: wrongType}}
			if field == "parentOperationIds" || field == "triggeringEventIds" {
				malformedValues = append(malformedValues, struct {
					name  string
					value any
				}{name: "duplicate values", value: []string{"same", "same"}})
			}
			for _, malformed := range malformedValues {
				t.Run(family.name+" "+field+" "+malformed.name, func(t *testing.T) {
					body := clone(family.base)
					body[field] = malformed.value
					encoded, err := json.Marshal(body)
					if err != nil {
						t.Fatal(err)
					}
					request := httptest.NewRequest(http.MethodPost, family.path, bytes.NewReader(encoded))
					request.Header.Set("Content-Type", "application/json")
					response := httptest.NewRecorder()
					handler.ServeHTTP(response, request)
					if response.Code != http.StatusBadRequest {
						t.Fatalf("got HTTP %d: %s", response.Code, response.Body.String())
					}
					var result struct {
						Error *specter.Error `json:"error"`
					}
					if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
						t.Fatal(err)
					}
					if result.Error == nil || result.Error.Code != specter.ErrInvalidMessage {
						t.Fatalf("unexpected error: %#v", result.Error)
					}
				})
			}
		}
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
		{name: "mismatched operation", body: `{"protocolVersion":1,"kind":"query.response","requestId":"query-request","operationId":"different","result":null}`},
		{name: "missing operation", body: `{"protocolVersion":1,"kind":"query.response","requestId":"query-request","result":null}`},
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
	commandCases := []struct {
		name string
		body string
	}{
		{name: "result and error", body: `{"protocolVersion":1,"kind":"command.response","requestId":"command-request","operationId":"operation-1","status":"committed","version":1,"events":[],"reactionTicketId":"ticket-1","error":{"code":"SPECTER_INFRASTRUCTURE_FAILURE","message":"Runtime operation failed."}}`},
		{name: "missing ticket", body: `{"protocolVersion":1,"kind":"command.response","requestId":"command-request","operationId":"operation-1","status":"committed","version":1,"events":[]}`},
		{name: "empty ticket", body: `{"protocolVersion":1,"kind":"command.response","requestId":"command-request","operationId":"operation-1","status":"duplicate","version":1,"events":[],"reactionTicketId":""}`},
		{name: "mismatched operation", body: `{"protocolVersion":1,"kind":"command.response","requestId":"command-request","operationId":"different","status":"committed","version":1,"events":[],"reactionTicketId":"ticket-1"}`},
		{name: "missing version", body: `{"protocolVersion":1,"kind":"command.response","requestId":"command-request","operationId":"operation-1","status":"committed","events":[],"reactionTicketId":"ticket-1"}`},
		{name: "null events", body: `{"protocolVersion":1,"kind":"command.response","requestId":"command-request","operationId":"operation-1","status":"committed","version":1,"events":null,"reactionTicketId":"ticket-1"}`},
		{name: "missing Event id", body: `{"protocolVersion":1,"kind":"command.response","requestId":"command-request","operationId":"operation-1","status":"committed","version":2,"events":[{"type":"set","order":1,"commitVersion":1,"recordedAt":"2026-07-18T12:00:00Z"}],"reactionTicketId":"ticket-1"}`},
		{name: "empty Event type", body: `{"protocolVersion":1,"kind":"command.response","requestId":"command-request","operationId":"operation-1","status":"committed","version":2,"events":[{"eventId":"event-1","type":"","order":1,"commitVersion":1,"recordedAt":"2026-07-18T12:00:00Z"}],"reactionTicketId":"ticket-1"}`},
		{name: "unsafe Event order", body: `{"protocolVersion":1,"kind":"command.response","requestId":"command-request","operationId":"operation-1","status":"committed","version":2,"events":[{"eventId":"event-1","type":"set","order":9007199254740992,"commitVersion":1,"recordedAt":"2026-07-18T12:00:00Z"}],"reactionTicketId":"ticket-1"}`},
		{name: "non-UTC Event timestamp", body: `{"protocolVersion":1,"kind":"command.response","requestId":"command-request","operationId":"operation-1","status":"committed","version":2,"events":[{"eventId":"event-1","type":"set","order":1,"commitVersion":1,"recordedAt":"2026-07-18T07:00:00-05:00"}],"reactionTicketId":"ticket-1"}`},
		{name: "null Event attributes", body: `{"protocolVersion":1,"kind":"command.response","requestId":"command-request","operationId":"operation-1","status":"committed","version":2,"events":[{"eventId":"event-1","type":"set","order":1,"commitVersion":1,"recordedAt":"2026-07-18T12:00:00Z","attributes":null}],"reactionTicketId":"ticket-1"}`},
		{name: "descending Event order", body: `{"protocolVersion":1,"kind":"command.response","requestId":"command-request","operationId":"operation-1","status":"committed","version":2,"events":[{"eventId":"event-2","type":"set","order":2,"commitVersion":1,"recordedAt":"2026-07-18T12:00:00Z"},{"eventId":"event-1","type":"set","order":1,"commitVersion":2,"recordedAt":"2026-07-18T12:00:01Z"}],"reactionTicketId":"ticket-1"}`},
	}
	for _, test := range commandCases {
		t.Run("command "+test.name, func(t *testing.T) {
			client := &protocol.Client{BaseURL: "http://specter.invalid/specter/v1", HTTPClient: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
				return jsonResponse(http.StatusOK, test.body), nil
			})}}
			if _, err := client.Command(context.Background(), commandRequest); err == nil {
				t.Fatal("expected malformed Command response to be rejected")
			}
		})
	}
	ticketClient := &protocol.Client{BaseURL: "http://specter.invalid/specter/v1", HTTPClient: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return jsonResponse(http.StatusOK, `{"protocolVersion":1,"kind":"reaction-ticket.response","requestId":"ticket-request","reactionTicketId":"ticket-1","status":"completed","error":{"code":"SPECTER_INFRASTRUCTURE_FAILURE","message":"Runtime operation failed."}}`), nil
	})}}
	if _, err := ticketClient.ReactionTicket(context.Background(), "ticket-1", "ticket-request"); err == nil {
		t.Fatal("expected contradictory Reaction ticket response to be rejected")
	}
}

func TestClientRejectsSharedMissingCommandTicketFixture(t *testing.T) {
	fixture, err := os.ReadFile("../../../protocol/fixtures/command-success-missing-ticket.json")
	if err != nil {
		t.Fatal(err)
	}
	client := &protocol.Client{BaseURL: "http://specter.invalid/specter/v1", HTTPClient: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return jsonResponse(http.StatusOK, string(fixture)), nil
	})}}
	request := protocol.CommandRequest{Envelope: protocol.Envelope{RequestID: "missing-ticket-response"}, OperationID: "operation-1", Command: protocol.OperationEnvelope{Type: "set", Payload: json.RawMessage(`{}`)}}
	if _, err := client.Command(context.Background(), request); err == nil {
		t.Fatal("shared missing-ticket fixture was accepted")
	}
}

func TestSubscriptionClientValidatesFailuresAndRequiresTerminalMessage(t *testing.T) {
	request := protocol.SubscriptionRequest{Envelope: protocol.Envelope{RequestID: "subscription-request"}, OperationID: "operation-1", Query: protocol.OperationEnvelope{Type: "value", Payload: json.RawMessage(`{}`)}}
	t.Run("typed non-2xx error", func(t *testing.T) {
		body := `{"protocolVersion":1,"kind":"subscription.error","requestId":"subscription-request","operationId":"operation-1","error":{"code":"SPECTER_UNKNOWN_QUERY","message":"Query type is not registered."}}`
		client := &protocol.Client{BaseURL: "http://specter.invalid/specter/v1", HTTPClient: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
			return jsonResponse(http.StatusBadRequest, body), nil
		})}}
		_, _, err := client.Subscribe(context.Background(), request)
		var public *specter.Error
		if !errors.As(err, &public) || public.Code != specter.ErrUnknownQuery {
			t.Fatalf("expected correlated subscription.error, got %v", err)
		}
	})
	for _, test := range []struct {
		name string
		body string
	}{
		{name: "generic private body", body: `postgres://admin:secret@database.internal/app`},
		{name: "mismatched typed error", body: `{"protocolVersion":1,"kind":"subscription.error","requestId":"different","operationId":"operation-1","error":{"code":"SPECTER_INFRASTRUCTURE_FAILURE","message":"postgres://admin:secret@database.internal/app"}}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			client := &protocol.Client{BaseURL: "http://specter.invalid/specter/v1", HTTPClient: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
				return jsonResponse(http.StatusInternalServerError, test.body), nil
			})}}
			_, _, err := client.Subscribe(context.Background(), request)
			var public *specter.Error
			if !errors.As(err, &public) || public.Code != specter.ErrTransportFailure {
				t.Fatalf("expected sanitized transport error, got %v", err)
			}
			if strings.Contains(err.Error(), "secret") {
				t.Fatal("subscription transport error leaked response body")
			}
		})
	}
	t.Run("unexpected EOF", func(t *testing.T) {
		body := "event: subscription.value\ndata: {\"protocolVersion\":1,\"kind\":\"subscription.value\",\"requestId\":\"subscription-request\",\"operationId\":\"operation-1\",\"sequence\":1,\"result\":null}\n\n"
		client := &protocol.Client{BaseURL: "http://specter.invalid/specter/v1", HTTPClient: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: http.StatusOK, Status: "200 OK", Header: http.Header{"Content-Type": []string{"text/event-stream"}}, Body: io.NopCloser(strings.NewReader(body))}, nil
		})}}
		messages, failures, err := client.Subscribe(context.Background(), request)
		if err != nil {
			t.Fatal(err)
		}
		if message := <-messages; message.Kind != "subscription.value" {
			t.Fatalf("unexpected value: %#v", message)
		}
		failure := <-failures
		if !errors.Is(failure, io.ErrUnexpectedEOF) {
			t.Fatalf("expected unexpected EOF, got %v", failure)
		}
	})
	t.Run("caller cancellation", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		client := &protocol.Client{BaseURL: "http://specter.invalid/specter/v1", HTTPClient: &http.Client{Transport: roundTripFunc(func(httpRequest *http.Request) (*http.Response, error) {
			reader, writer := io.Pipe()
			go func() {
				<-httpRequest.Context().Done()
				_ = writer.CloseWithError(httpRequest.Context().Err())
			}()
			return &http.Response{StatusCode: http.StatusOK, Status: "200 OK", Header: http.Header{"Content-Type": []string{"text/event-stream"}}, Body: reader}, nil
		})}}
		_, failures, err := client.Subscribe(ctx, request)
		if err != nil {
			t.Fatal(err)
		}
		cancel()
		for failure := range failures {
			if failure != nil {
				t.Fatalf("caller cancellation became a stream failure: %v", failure)
			}
		}
	})
	t.Run("SSE blocks accept optional space and multiline data", func(t *testing.T) {
		body := ": keepalive\nevent: subscription.complete\ndata:{\"protocolVersion\":1,\"kind\":\"subscription.complete\",\"requestId\":\"subscription-request\",\ndata: \"operationId\":\"operation-1\"}\nid: ignored\n\n"
		client := &protocol.Client{BaseURL: "http://specter.invalid/specter/v1", HTTPClient: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: http.StatusOK, Status: "200 OK", Header: http.Header{"Content-Type": []string{"text/event-stream"}}, Body: io.NopCloser(strings.NewReader(body))}, nil
		})}}
		messages, failures, err := client.Subscribe(context.Background(), request)
		if err != nil {
			t.Fatal(err)
		}
		message := <-messages
		if message.Kind != "subscription.complete" || message.OperationID != request.OperationID {
			t.Fatalf("unexpected terminal message: %#v", message)
		}
		for failure := range failures {
			if failure != nil {
				t.Fatal(failure)
			}
		}
	})
	t.Run("terminal SSE block is dispatched at EOF", func(t *testing.T) {
		body := "event: subscription.complete\ndata:{\"protocolVersion\":1,\"kind\":\"subscription.complete\",\"requestId\":\"subscription-request\",\"operationId\":\"operation-1\"}\n"
		client := &protocol.Client{BaseURL: "http://specter.invalid/specter/v1", HTTPClient: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: http.StatusOK, Status: "200 OK", Header: http.Header{"Content-Type": []string{"text/event-stream"}}, Body: io.NopCloser(strings.NewReader(body))}, nil
		})}}
		messages, failures, err := client.Subscribe(context.Background(), request)
		if err != nil {
			t.Fatal(err)
		}
		if message := <-messages; message.Kind != "subscription.complete" {
			t.Fatalf("unexpected terminal message: %#v", message)
		}
		for failure := range failures {
			if failure != nil {
				t.Fatal(failure)
			}
		}
	})
	t.Run("CR-only SSE framing is accepted", func(t *testing.T) {
		body := "event: subscription.complete\rdata: {\"protocolVersion\":1,\"kind\":\"subscription.complete\",\"requestId\":\"subscription-request\",\"operationId\":\"operation-1\"}\r\r"
		client := &protocol.Client{BaseURL: "http://specter.invalid/specter/v1", HTTPClient: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: http.StatusOK, Status: "200 OK", Header: http.Header{"Content-Type": []string{"text/event-stream"}}, Body: io.NopCloser(strings.NewReader(body))}, nil
		})}}
		messages, failures, err := client.Subscribe(context.Background(), request)
		if err != nil {
			t.Fatal(err)
		}
		if message := <-messages; message.Kind != "subscription.complete" {
			t.Fatalf("unexpected terminal message: %#v", message)
		}
		for failure := range failures {
			if failure != nil {
				t.Fatal(failure)
			}
		}
	})
}

func TestSubscriptionClientPreservesLatestValueBeforeTerminalAndValidatesSSEMetadata(t *testing.T) {
	request := protocol.SubscriptionRequest{Envelope: protocol.Envelope{RequestID: "subscription-order"}, OperationID: "operation-1", Query: protocol.OperationEnvelope{Type: "value", Payload: json.RawMessage(`{}`)}}
	value := `{"protocolVersion":1,"kind":"subscription.value","requestId":"subscription-order","operationId":"operation-1","sequence":1,"result":"latest"}`
	complete := `{"protocolVersion":1,"kind":"subscription.complete","requestId":"subscription-order","operationId":"operation-1"}`
	t.Run("terminal follows unread latest value", func(t *testing.T) {
		body := "event: subscription.value\ndata: " + value + "\n\nevent: subscription.complete\ndata: " + complete + "\n\n"
		client := &protocol.Client{BaseURL: "http://specter.invalid/specter/v1", HTTPClient: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: http.StatusOK, Status: "200 OK", Header: http.Header{"Content-Type": []string{"text/event-stream"}}, Body: io.NopCloser(strings.NewReader(body))}, nil
		})}}
		messages, failures, err := client.Subscribe(context.Background(), request)
		if err != nil {
			t.Fatal(err)
		}
		if message := <-messages; message.Kind != "subscription.value" || message.Result != "latest" {
			t.Fatalf("latest value was lost: %#v", message)
		}
		if message := <-messages; message.Kind != "subscription.complete" {
			t.Fatalf("terminal did not follow latest value: %#v", message)
		}
		for failure := range failures {
			if failure != nil {
				t.Fatal(failure)
			}
		}
	})
	for _, test := range []struct {
		name string
		body string
		req  protocol.SubscriptionRequest
	}{
		{name: "mismatched event name", body: "event: subscription.complete\ndata: " + value + "\n\n", req: request},
		{name: "missing event name", body: "data: " + value + "\n\n", req: request},
		{name: "duplicate sequence", body: "event: subscription.value\ndata: " + value + "\n\nevent: subscription.value\ndata: " + value + "\n\n", req: request},
		{name: "sequence not beyond afterSequence", body: "event: subscription.value\ndata: " + value + "\n\n", req: func() protocol.SubscriptionRequest {
			copy := request
			after := int64(1)
			copy.AfterSequence = &after
			return copy
		}()},
	} {
		t.Run(test.name, func(t *testing.T) {
			client := &protocol.Client{BaseURL: "http://specter.invalid/specter/v1", HTTPClient: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: http.StatusOK, Status: "200 OK", Header: http.Header{"Content-Type": []string{"text/event-stream"}}, Body: io.NopCloser(strings.NewReader(test.body))}, nil
			})}}
			_, failures, err := client.Subscribe(context.Background(), test.req)
			if err != nil {
				t.Fatal(err)
			}
			if failure := <-failures; failure == nil {
				t.Fatal("invalid SSE stream was accepted")
			}
		})
	}
}

func TestSubscriptionClientRejectsSharedContradictoryFixtures(t *testing.T) {
	request := protocol.SubscriptionRequest{Envelope: protocol.Envelope{RequestID: "subscription-response"}, OperationID: "subscription-1", Query: protocol.OperationEnvelope{Type: "value", Payload: json.RawMessage(`{}`)}}
	for _, name := range []string{"subscription-value-with-error.json", "subscription-error-with-result.json", "subscription-complete-with-sequence.json"} {
		t.Run(name, func(t *testing.T) {
			fixture, err := os.ReadFile("../../../protocol/fixtures/" + name)
			if err != nil {
				t.Fatal(err)
			}
			var compact bytes.Buffer
			if err := json.Compact(&compact, fixture); err != nil {
				t.Fatal(err)
			}
			var envelope protocol.Envelope
			if err := json.Unmarshal(fixture, &envelope); err != nil {
				t.Fatal(err)
			}
			body := "event: " + envelope.Kind + "\ndata: " + compact.String() + "\n\n"
			client := &protocol.Client{BaseURL: "http://specter.invalid/specter/v1", HTTPClient: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: http.StatusOK, Status: "200 OK", Header: http.Header{"Content-Type": []string{"text/event-stream"}}, Body: io.NopCloser(strings.NewReader(body))}, nil
			})}}
			_, failures, err := client.Subscribe(context.Background(), request)
			if err != nil {
				t.Fatal(err)
			}
			if failure := <-failures; failure == nil {
				t.Fatal("shared contradictory subscription fixture was accepted")
			}
		})
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
		{name: "null accepted", status: http.StatusOK, body: `{"protocolVersion":1,"kind":"observations.ack","requestId":"observation-request","accepted":null,"duplicates":1}`},
		{name: "null duplicates", status: http.StatusOK, body: `{"protocolVersion":1,"kind":"observations.ack","requestId":"observation-request","accepted":1,"duplicates":null}`},
		{name: "null rejected ids", status: http.StatusOK, body: `{"protocolVersion":1,"kind":"observations.ack","requestId":"observation-request","accepted":1,"duplicates":0,"rejectedObservationIds":null}`},
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

func TestProtocolAttemptIDReachesRuntimeObservations(t *testing.T) {
	var mu sync.Mutex
	var observations []specter.Observation
	query := specter.QueryDefinition{Name: "value", Scenarios: []specter.QueryScenario{{Description: "reads", Expect: "ok"}}, Handle: func(context.Context, json.RawMessage) (any, error) { return "ok", nil }}
	app, err := specter.NewApp(specter.Config{Queries: []specter.QueryDefinition{query}, Observe: func(observation specter.Observation) {
		mu.Lock()
		observations = append(observations, observation)
		mu.Unlock()
	}})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = app.Close(context.Background()) }()
	server := httptest.NewServer((&protocol.Server{App: app}).Handler())
	defer server.Close()
	client := &protocol.Client{BaseURL: server.URL + "/specter/v1"}
	causes := []struct {
		operation string
		run       func() error
	}{
		{operation: "command-operation", run: func() error {
			_, err := client.Command(context.Background(), protocol.CommandRequest{OperationID: "command-operation", AttemptID: "attempt-2", Command: protocol.OperationEnvelope{Type: "missing", Payload: json.RawMessage(`{}`)}})
			return err
		}},
		{operation: "query-operation", run: func() error {
			_, err := client.Query(context.Background(), protocol.QueryRequest{OperationID: "query-operation", AttemptID: "attempt-2", Query: protocol.OperationEnvelope{Type: "value", Payload: json.RawMessage(`{}`)}})
			return err
		}},
	}
	if err := causes[0].run(); err == nil {
		t.Fatal("missing Command unexpectedly succeeded")
	}
	if err := causes[1].run(); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	messages, failures, err := client.Subscribe(ctx, protocol.SubscriptionRequest{OperationID: "subscription-operation", AttemptID: "attempt-2", Query: protocol.OperationEnvelope{Type: "value", Payload: json.RawMessage(`{}`)}})
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	if message := <-messages; message.Kind != "subscription.value" {
		cancel()
		t.Fatalf("unexpected subscription value: %#v", message)
	}
	cancel()
	for failure := range failures {
		if failure != nil {
			t.Fatal(failure)
		}
	}
	mu.Lock()
	defer mu.Unlock()
	for _, operation := range []string{"command-operation", "query-operation", "subscription-operation"} {
		var matched []specter.Observation
		for _, observation := range observations {
			if observation.OperationID == operation {
				matched = append(matched, observation)
			}
		}
		if len(matched) != 2 {
			t.Fatalf("operation %s emitted %d observations: %#v", operation, len(matched), matched)
		}
		for _, observation := range matched {
			if observation.AttemptID != "attempt-2" {
				t.Fatalf("operation %s lost attemptId in %#v", operation, observation)
			}
		}
		if matched[1].Outcome == "" {
			t.Fatalf("operation %s terminal observation omitted outcome: %#v", operation, matched[1])
		}
	}
}

func TestUnknownReactionTicketReturnsCorrelatedPublicError(t *testing.T) {
	server := httptest.NewServer((&protocol.Server{App: emptyApp(t)}).Handler())
	defer server.Close()
	client := &protocol.Client{BaseURL: server.URL + "/specter/v1"}
	response, err := client.ReactionTicket(context.Background(), "missing-ticket", "ticket-request")
	var public *specter.Error
	if !errors.As(err, &public) || public.Code != specter.ErrReactionTicketNotFound {
		t.Fatalf("expected public ticket-not-found error, got response %#v, error %v", response, err)
	}
	if response.RequestID != "ticket-request" || response.ReactionTicketID != "missing-ticket" || response.Status != "failed" {
		t.Fatalf("ticket-not-found response was not correlated: %#v", response)
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

func TestObservationOutcomeAndAttemptArePreservedThroughSink(t *testing.T) {
	received := make(chan protocol.RuntimeObservation, 1)
	handler := (&protocol.Server{App: emptyApp(t), AcceptObservations: func(_ context.Context, batch protocol.RuntimeObservationBatch) (protocol.ObservationAcknowledgement, error) {
		received <- batch.Observations[0]
		return protocol.ObservationAcknowledgement{Accepted: 1}, nil
	}}).Handler()
	body := `{"protocolVersion":1,"kind":"observations.batch","requestId":"request-1","observations":[{"observationId":"observation-1","sequence":1,"observedAt":"2026-07-18T12:00:00.000Z","kind":"command.completed","operationId":"operation-1","attemptId":"attempt-2","outcome":"succeeded","source":{"application":"todo","environment":"test","runtimeLanguage":"go","runtimeVersion":"test","instanceId":"instance","eventLogId":"log"}}]}`
	request := httptest.NewRequest(http.MethodPost, "/specter/v1/observations", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("got HTTP %d: %s", response.Code, response.Body.String())
	}
	observation := <-received
	if observation.AttemptID != "attempt-2" || observation.Outcome != "succeeded" {
		t.Fatalf("sink lost observation fields: %#v", observation)
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
		{name: "null required sequence", mutate: func(value map[string]any) { value["sequence"] = nil }},
		{name: "null required source", mutate: func(value map[string]any) { value["source"] = nil }},
		{name: "negative cursor", mutate: func(value map[string]any) { value["cursor"] = float64(-1) }},
		{name: "null cursor", mutate: func(value map[string]any) { value["cursor"] = nil }},
		{name: "unsafe dropped count", mutate: func(value map[string]any) { value["droppedCount"] = float64(9007199254740992) }},
		{name: "null dropped count", mutate: func(value map[string]any) { value["droppedCount"] = nil }},
		{name: "negative version", mutate: func(value map[string]any) { value["version"] = float64(-1) }},
		{name: "unsafe version", mutate: func(value map[string]any) { value["version"] = float64(9007199254740992) }},
		{name: "null version", mutate: func(value map[string]any) { value["version"] = nil }},
		{name: "null Events", mutate: func(value map[string]any) { value["events"] = nil }},
		{name: "null attributes", mutate: func(value map[string]any) { value["attributes"] = nil }},
		{name: "null error", mutate: func(value map[string]any) { value["error"] = nil }},
		{name: "null causal array", mutate: func(value map[string]any) { value["parentOperationIds"] = nil }},
		{name: "invalid outcome", mutate: func(value map[string]any) { value["outcome"] = "maybe" }},
		{name: "null outcome", mutate: func(value map[string]any) { value["outcome"] = nil }},
		{name: "descending triggering range", mutate: func(value map[string]any) {
			value["triggeringEventOrder"] = map[string]any{"from": float64(2), "to": float64(1)}
		}},
		{name: "negative triggering range", mutate: func(value map[string]any) {
			value["triggeringEventOrder"] = map[string]any{"from": float64(-1), "to": float64(1)}
		}},
		{name: "null triggering range", mutate: func(value map[string]any) { value["triggeringEventOrder"] = nil }},
		{name: "null triggering range endpoint", mutate: func(value map[string]any) {
			value["triggeringEventOrder"] = map[string]any{"from": nil, "to": float64(1)}
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
		{name: "null Event order", mutate: func(value map[string]any) {
			event := validEvent()
			event["order"] = nil
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
