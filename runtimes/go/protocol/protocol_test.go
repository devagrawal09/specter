package protocol_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/devagrawal09/specter/runtimes/go/protocol"
	"github.com/devagrawal09/specter/runtimes/go/specter"
)

func TestSharedObservationFixturesConform(t *testing.T) {
	fixtureRoot := "../../../protocol/fixtures"
	manifestData, err := os.ReadFile(filepath.Join(fixtureRoot, "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		Cases []struct {
			Name      string            `json:"name"`
			File      string            `json:"file"`
			Valid     bool              `json:"valid"`
			ErrorCode specter.ErrorCode `json:"errorCode"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(manifestData, &manifest); err != nil {
		t.Fatal(err)
	}
	seenInvalidEventOrdering := false
	for _, testCase := range manifest.Cases {
		t.Run(testCase.Name, func(t *testing.T) {
			contents, err := os.ReadFile(filepath.Join(fixtureRoot, testCase.File))
			if err != nil {
				t.Fatal(err)
			}
			err = protocol.ValidateMessageJSON(contents)
			if testCase.Valid {
				if err != nil {
					t.Fatalf("valid fixture failed: %v", err)
				}
				return
			}
			var failure *specter.Error
			if err == nil || !errors.As(err, &failure) {
				t.Fatalf("invalid fixture passed or returned an unstructured error: %v", err)
			}
			if failure.Code != testCase.ErrorCode {
				t.Fatalf("got error code %s, want %s", failure.Code, testCase.ErrorCode)
			}
		})
		if testCase.File == "invalid-event-ordering.json" {
			seenInvalidEventOrdering = true
		}
	}
	if !seenInvalidEventOrdering {
		t.Fatal("shared manifest did not exercise invalid Event ordering")
	}
}

func TestObservationValidationIgnoresUnknownOptionalFields(t *testing.T) {
	body := `{"protocolVersion":1,"kind":"observations.batch","requestId":"request-1","futureBatchField":{"enabled":true},"observations":[{"observationId":"observation-1","sequence":1,"observedAt":"2026-07-18T12:00:00Z","kind":"command.started","operationId":"operation-1","futureObservationField":"value","source":{"application":"todo","environment":"test","runtimeLanguage":"go","runtimeVersion":"test","instanceId":"instance","eventLogId":"log","futureSourceField":1}}]}`
	var batch protocol.RuntimeObservationBatch
	if err := json.Unmarshal([]byte(body), &batch); err != nil {
		t.Fatal(err)
	}
	if err := protocol.ValidateObservationBatch(batch); err != nil {
		t.Fatal(err)
	}
}

func TestObservationValidationRejectsMalformedAndMismatchedBatches(t *testing.T) {
	tests := []struct {
		name string
		body string
		code specter.ErrorCode
	}{
		{name: "version mismatch", body: validBatchJSON(2, "observations.batch", "2026-07-18T12:00:00Z", 1), code: specter.ErrProtocolVersionMismatch},
		{name: "wrong kind", body: validBatchJSON(1, "command.request", "2026-07-18T12:00:00Z", 1), code: specter.ErrInvalidMessage},
		{name: "missing observations", body: `{"protocolVersion":1,"kind":"observations.batch","requestId":"request-1"}`, code: specter.ErrInvalidMessage},
		{name: "non UTC timestamp", body: validBatchJSON(1, "observations.batch", "2026-07-18T07:00:00-05:00", 1), code: specter.ErrInvalidMessage},
		{name: "negative sequence", body: validBatchJSON(1, "observations.batch", "2026-07-18T12:00:00Z", -1), code: specter.ErrInvalidMessage},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var batch protocol.RuntimeObservationBatch
			if err := json.Unmarshal([]byte(test.body), &batch); err != nil {
				t.Fatal(err)
			}
			err := protocol.ValidateObservationBatch(batch)
			var failure *specter.Error
			if err == nil || !errors.As(err, &failure) {
				t.Fatalf("expected structured validation failure, got %v", err)
			}
			if failure.Code != test.code {
				t.Fatalf("got %#v, want code %s", failure, test.code)
			}
		})
	}
}

func TestObservationValidationRejectsProgrammaticNullObservations(t *testing.T) {
	batch := protocol.RuntimeObservationBatch{
		Envelope: protocol.Envelope{
			ProtocolVersion: protocol.Version,
			Kind:            "observations.batch",
			RequestID:       "request-1",
		},
	}
	if err := protocol.ValidateObservationBatch(batch); err == nil {
		t.Fatal("accepted a batch that would encode observations as null")
	}
}

func TestObservationClientSendsOnlyTheIngestionRequestAndValidatesAck(t *testing.T) {
	var path, method string
	client := &protocol.ObservationClient{
		BaseURL: "http://collector.invalid/specter/v1",
		HTTPClient: &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
			path, method = request.URL.Path, request.Method
			var batch protocol.RuntimeObservationBatch
			if err := json.NewDecoder(request.Body).Decode(&batch); err != nil {
				return nil, err
			}
			body := fmt.Sprintf(`{"protocolVersion":1,"kind":"observations.ack","requestId":%q,"accepted":1,"duplicates":0}`, batch.RequestID)
			return jsonResponse(body), nil
		})},
	}
	acknowledgement, err := client.SendObservations(context.Background(), protocol.RuntimeObservationBatch{Observations: []protocol.RuntimeObservation{validObservation()}})
	if err != nil {
		t.Fatal(err)
	}
	if path != "/specter/v1/observations" || method != http.MethodPost {
		t.Fatalf("sent %s %s", method, path)
	}
	if acknowledgement.Accepted != 1 || acknowledgement.Kind != "observations.ack" {
		t.Fatalf("unexpected acknowledgement: %#v", acknowledgement)
	}
}

func TestObservationClientRejectsMismatchedAndPartialAcknowledgements(t *testing.T) {
	tests := []string{
		`{"protocolVersion":1,"kind":"observations.ack","requestId":"wrong","accepted":1,"duplicates":0}`,
		`{"protocolVersion":1,"kind":"observations.ack","requestId":"request-1","accepted":0,"duplicates":0}`,
	}
	for _, body := range tests {
		client := &protocol.ObservationClient{
			BaseURL: "http://collector.invalid/specter/v1",
			HTTPClient: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
				return jsonResponse(body), nil
			})},
		}
		_, err := client.SendObservations(context.Background(), protocol.RuntimeObservationBatch{
			Envelope:     protocol.Envelope{RequestID: "request-1"},
			Observations: []protocol.RuntimeObservation{validObservation()},
		})
		if err == nil {
			t.Fatalf("accepted invalid acknowledgement %s", body)
		}
	}
}

func validObservation() protocol.RuntimeObservation {
	return protocol.RuntimeObservation{
		Observation: specter.Observation{ObservationID: "observation-1", Kind: "command.started", ObservedAt: time.Date(2026, 7, 18, 12, 0, 0, 0, time.UTC), OperationID: "operation-1"},
		Sequence:    1,
		Source:      protocol.RuntimeSource{Application: "todo", Environment: "test", RuntimeLanguage: "go", RuntimeVersion: "test", InstanceID: "instance", EventLogID: "log"},
	}
}

func validBatchJSON(version int, kind, observedAt string, sequence int64) string {
	return fmt.Sprintf(`{"protocolVersion":%d,"kind":%q,"requestId":"request-1","observations":[{"observationId":"observation-1","sequence":%d,"observedAt":%q,"kind":"command.started","operationId":"operation-1","source":{"application":"todo","environment":"test","runtimeLanguage":"go","runtimeVersion":"test","instanceId":"instance","eventLogId":"log"}}]}`, version, kind, sequence, observedAt)
}

func jsonResponse(body string) *http.Response {
	return &http.Response{StatusCode: http.StatusOK, Status: "200 OK", Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(body))}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (function roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}
