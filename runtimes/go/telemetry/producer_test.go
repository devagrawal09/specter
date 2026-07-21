package telemetry_test

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/devagrawal09/specter/runtimes/go/protocol"
	"github.com/devagrawal09/specter/runtimes/go/specter"
	"github.com/devagrawal09/specter/runtimes/go/telemetry"
)

func TestProducerEnrichesAndBatchesObservations(t *testing.T) {
	received := make(chan protocol.RuntimeObservationBatch, 1)
	app, err := specter.NewApp(specter.Config{})
	if err != nil {
		t.Fatal(err)
	}
	handler := (&protocol.Server{App: app, AcceptObservations: func(_ context.Context, batch protocol.RuntimeObservationBatch) (protocol.ObservationAcknowledgement, error) {
		received <- batch
		return protocol.ObservationAcknowledgement{Accepted: len(batch.Observations)}, nil
	}}).Handler()
	server := httptest.NewServer(handler)
	defer server.Close()
	source := protocol.RuntimeSource{Application: "test", Environment: "test", RuntimeLanguage: "go", RuntimeVersion: "test", InstanceID: "instance", EventLogID: "log"}
	producer := telemetry.NewProducer(&protocol.Client{BaseURL: server.URL + "/specter/v1"}, source, 8)
	producer.Observe(specter.Observation{ObservationID: "observation-1", ObservedAt: time.Now().UTC(), Kind: "command.started", OperationID: "operation-1"})
	select {
	case batch := <-received:
		if len(batch.Observations) != 1 || batch.Observations[0].Sequence != 1 || batch.Observations[0].Source.InstanceID != "instance" {
			t.Fatalf("unexpected batch: %#v", batch)
		}
	case <-time.After(time.Second):
		t.Fatal("producer did not deliver")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := producer.Close(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestObserveDoesNotBlockDuringCollectorOutage(t *testing.T) {
	producer := telemetry.NewProducer(&protocol.Client{BaseURL: "http://127.0.0.1:1/specter/v1"}, protocol.RuntimeSource{Application: "test", Environment: "test", RuntimeLanguage: "go", RuntimeVersion: "test", InstanceID: "instance", EventLogID: "log"}, 1)
	started := time.Now()
	for index := 0; index < 100; index++ {
		producer.Observe(specter.Observation{ObservationID: "observation", ObservedAt: time.Now().UTC(), Kind: "command.started", OperationID: "operation"})
	}
	if time.Since(started) > 100*time.Millisecond {
		t.Fatal("Observe blocked application work")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	_ = producer.Close(ctx)
}

func TestProducerRetriesTheSameImmutableBatchUntilExactlyAcknowledged(t *testing.T) {
	requests := make(chan protocol.RuntimeObservationBatch, 2)
	var attempts atomic.Int64
	client := &protocol.Client{BaseURL: "http://specter.invalid/specter/v1", HTTPClient: &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		var batch protocol.RuntimeObservationBatch
		if err := json.NewDecoder(request.Body).Decode(&batch); err != nil {
			return nil, err
		}
		requests <- batch
		accepted := 0
		if attempts.Add(1) > 1 {
			accepted = len(batch.Observations)
		}
		body := fmt.Sprintf(`{"protocolVersion":1,"kind":"observations.ack","requestId":%q,"accepted":%d,"duplicates":0}`, batch.RequestID, accepted)
		return &http.Response{StatusCode: http.StatusOK, Status: "200 OK", Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(body))}, nil
	})}}
	producer := telemetry.NewProducer(client, protocol.RuntimeSource{Application: "test", Environment: "test", RuntimeLanguage: "go", RuntimeVersion: "test", InstanceID: "instance", EventLogID: "log"}, 8)
	producer.Observe(specter.Observation{ObservationID: "observation-1", ObservedAt: time.Now().UTC(), Kind: "command.started", OperationID: "operation-1"})
	var first, second protocol.RuntimeObservationBatch
	select {
	case first = <-requests:
	case <-time.After(time.Second):
		t.Fatal("producer did not send the first batch")
	}
	select {
	case second = <-requests:
	case <-time.After(2 * time.Second):
		t.Fatal("producer did not retry a partial acknowledgement")
	}
	if first.RequestID == "" || second.RequestID != first.RequestID {
		t.Fatalf("retry changed request ID: %q then %q", first.RequestID, second.RequestID)
	}
	if len(first.Observations) != 1 || len(second.Observations) != 1 || second.Observations[0].ObservationID != first.Observations[0].ObservationID {
		t.Fatalf("retry changed pending observations: %#v then %#v", first.Observations, second.Observations)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := producer.Close(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestProducerExpiresAnUnacknowledgedBatchAtTheRetryHorizonAndReportsItsLoss(t *testing.T) {
	requests := make(chan protocol.RuntimeObservationBatch, 2)
	var attempts atomic.Int64
	var currentTime atomic.Int64
	currentTime.Store(time.Date(2026, 7, 18, 12, 0, 0, 0, time.UTC).UnixNano())
	client := &protocol.Client{BaseURL: "http://specter.invalid/specter/v1", HTTPClient: &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		var batch protocol.RuntimeObservationBatch
		if err := json.NewDecoder(request.Body).Decode(&batch); err != nil {
			return nil, err
		}
		requests <- batch
		accepted := 0
		if attempts.Add(1) > 1 {
			accepted = len(batch.Observations)
		}
		body := fmt.Sprintf(`{"protocolVersion":1,"kind":"observations.ack","requestId":%q,"accepted":%d,"duplicates":0}`, batch.RequestID, accepted)
		return jsonResponse(body), nil
	})}}
	producer := telemetry.NewProducerWithOptions(client, testSource(), telemetry.ProducerOptions{
		Capacity:    8,
		RetryWindow: time.Second,
		RetryDelay:  100 * time.Millisecond,
		Now: func() time.Time {
			return time.Unix(0, currentTime.Load()).UTC()
		},
	})
	producer.Observe(testObservation("observation-1", nil))
	first := receiveBatch(t, requests, time.Second)
	currentTime.Add(int64(2 * time.Second))
	second := receiveBatch(t, requests, time.Second)

	if first.RequestID == second.RequestID {
		t.Fatalf("expired batch retained request ID %q", first.RequestID)
	}
	if len(second.Observations) != 1 || second.Observations[0].Kind != "telemetry.dropped" || second.Observations[0].DroppedCount != 1 {
		t.Fatalf("expired batch loss was not reported: %#v", second.Observations)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := producer.Close(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestProducerSanitizesObservationErrorsBeforeTransmission(t *testing.T) {
	received := make(chan protocol.RuntimeObservationBatch, 1)
	client := &protocol.Client{BaseURL: "http://specter.invalid/specter/v1", HTTPClient: &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		var batch protocol.RuntimeObservationBatch
		if err := json.NewDecoder(request.Body).Decode(&batch); err != nil {
			return nil, err
		}
		received <- batch
		body := fmt.Sprintf(`{"protocolVersion":1,"kind":"observations.ack","requestId":%q,"accepted":%d,"duplicates":0}`, batch.RequestID, len(batch.Observations))
		return jsonResponse(body), nil
	})}}
	producer := telemetry.NewProducer(client, testSource(), 8)
	secret := "postgres://admin:secret@database.internal/app"
	producer.Observe(testObservation("observation-1", &specter.Error{Code: specter.ErrInvalidInput, Message: secret, Details: map[string]any{"credential": secret}}))
	producer.Observe(testObservation("observation-2", &specter.Error{Code: specter.ErrorCode("PRIVATE_DATABASE_ERROR"), Message: secret, Details: map[string]any{"credential": secret}}))

	var observations []protocol.RuntimeObservation
	deadline := time.After(time.Second)
	for len(observations) < 2 {
		select {
		case batch := <-received:
			observations = append(observations, batch.Observations...)
		case <-deadline:
			t.Fatal("producer did not transmit sanitized observations")
		}
	}
	if observations[0].Error == nil || observations[0].Error.Code != specter.ErrInvalidInput || observations[0].Error.Message != "Operation input is invalid." || observations[0].Error.Details != nil {
		t.Fatalf("coded error was not sanitized: %#v", observations[0].Error)
	}
	if observations[1].Error == nil || observations[1].Error.Code != specter.ErrInfrastructure || observations[1].Error.Message != "Runtime operation failed." || observations[1].Error.Details != nil {
		t.Fatalf("unknown error was not sanitized: %#v", observations[1].Error)
	}
	encoded, err := json.Marshal(observations)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), secret) {
		t.Fatal("transmitted observations leaked a private runtime error")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := producer.Close(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestProducerPreservesSequenceOrderAcrossOverflowRetryAndClose(t *testing.T) {
	requests := make(chan protocol.RuntimeObservationBatch, 4)
	var attempts atomic.Int64
	client := &protocol.Client{BaseURL: "http://specter.invalid/specter/v1", HTTPClient: &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		var batch protocol.RuntimeObservationBatch
		if err := json.NewDecoder(request.Body).Decode(&batch); err != nil {
			return nil, err
		}
		requests <- batch
		accepted := len(batch.Observations)
		if attempts.Add(1) == 1 {
			accepted = 0
		}
		body := fmt.Sprintf(`{"protocolVersion":1,"kind":"observations.ack","requestId":%q,"accepted":%d,"duplicates":0}`, batch.RequestID, accepted)
		return jsonResponse(body), nil
	})}}
	producer := telemetry.NewProducer(client, testSource(), 3)
	producer.Observe(testObservation("observation-1", nil))
	first := receiveBatch(t, requests, time.Second)
	for sequence := 2; sequence <= 8; sequence++ {
		producer.Observe(testObservation(fmt.Sprintf("observation-%d", sequence), nil))
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := producer.Close(ctx); err != nil {
		t.Fatal(err)
	}
	retry := receiveBatch(t, requests, time.Second)
	remaining := receiveBatch(t, requests, time.Second)
	if len(first.Observations) != 1 || first.Observations[0].Sequence != 1 {
		t.Fatalf("unexpected initial batch: %#v", first.Observations)
	}
	if retry.RequestID != first.RequestID || len(retry.Observations) != 1 || retry.Observations[0].Sequence != 1 {
		t.Fatalf("retry changed pending batch: %#v then %#v", first, retry)
	}
	wantSequences := []int64{6, 7, 8, 9}
	if len(remaining.Observations) != len(wantSequences) {
		t.Fatalf("unexpected post-overflow batch: %#v", remaining.Observations)
	}
	for index, want := range wantSequences {
		if remaining.Observations[index].Sequence != want {
			t.Fatalf("sequence order changed at %d: got %d, want %d", index, remaining.Observations[index].Sequence, want)
		}
	}
	loss := remaining.Observations[len(remaining.Observations)-1]
	if loss.Kind != "telemetry.dropped" || loss.DroppedCount != 4 {
		t.Fatalf("unexpected loss observation: %#v", loss)
	}
}

func testSource() protocol.RuntimeSource {
	return protocol.RuntimeSource{Application: "test", Environment: "test", RuntimeLanguage: "go", RuntimeVersion: "test", InstanceID: "instance", EventLogID: "log"}
}

func testObservation(id string, failure *specter.Error) specter.Observation {
	return specter.Observation{ObservationID: id, ObservedAt: time.Now().UTC(), Kind: "command.failed", OperationID: "operation", Error: failure}
}

func receiveBatch(t *testing.T, batches <-chan protocol.RuntimeObservationBatch, timeout time.Duration) protocol.RuntimeObservationBatch {
	t.Helper()
	select {
	case batch := <-batches:
		return batch
	case <-time.After(timeout):
		t.Fatal("producer did not deliver a batch")
		return protocol.RuntimeObservationBatch{}
	}
}

func jsonResponse(body string) *http.Response {
	return &http.Response{StatusCode: http.StatusOK, Status: "200 OK", Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(body))}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}
