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
	handler := http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		var batch protocol.RuntimeObservationBatch
		if err := json.NewDecoder(request.Body).Decode(&batch); err != nil {
			t.Error(err)
			writer.WriteHeader(http.StatusBadRequest)
			return
		}
		received <- batch
		writer.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(writer).Encode(protocol.ObservationAcknowledgement{
			Envelope: protocol.Envelope{ProtocolVersion: protocol.Version, Kind: "observations.ack", RequestID: batch.RequestID},
			Accepted: protocol.SafeInteger(len(batch.Observations)),
		})
	})
	server := httptest.NewServer(handler)
	defer server.Close()
	source := protocol.RuntimeSource{Application: "test", Environment: "test", RuntimeLanguage: "go", RuntimeVersion: "test", InstanceID: "instance", EventLogID: "log"}
	producer := telemetry.NewProducer(&protocol.ObservationClient{CollectorURL: server.URL}, source, 8)
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
	producer := telemetry.NewProducer(&protocol.ObservationClient{CollectorURL: "http://127.0.0.1:1"}, protocol.RuntimeSource{Application: "test", Environment: "test", RuntimeLanguage: "go", RuntimeVersion: "test", InstanceID: "instance", EventLogID: "log"}, 1)
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
	client := &protocol.ObservationClient{CollectorURL: "http://specter.invalid", HTTPClient: &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
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

func TestProducerSnapshotsNestedCallerDataBeforeRetry(t *testing.T) {
	sender := newControlledSender()
	fixed := time.Date(2026, 7, 18, 12, 0, 0, 0, time.UTC)
	producer := telemetry.NewProducerWithOptions(sender, testSource(), telemetry.ProducerOptions{Capacity: 8, RetryDelay: time.Millisecond, Now: func() time.Time { return fixed }})
	parents := []string{"parent-1"}
	causes := []string{"event-1"}
	attributes := map[string]any{"nested": map[string]any{"value": "original"}, "items": []any{"original"}}
	eventAttributes := map[string]any{"channel": "original"}
	errorDetails := map[string]any{"credential": "must-not-cross"}
	observation := specter.Observation{
		ObservationID: "observation-1", ObservedAt: fixed, Kind: "command.failed", OperationID: "operation-1",
		ParentOperationIDs: parents, TriggeringEventIDs: causes, Attributes: attributes,
		Events: []specter.EventReference{{EventID: "event-1", Type: "todo-added", Order: 1, CommitVersion: 1, RecordedAt: fixed, Attributes: eventAttributes}},
		Error:  &specter.Error{Code: specter.ErrInvalidInput, Message: "private", Details: errorDetails},
	}
	producer.Observe(observation)
	first := sender.receive(t)
	parents[0] = "mutated-parent"
	causes[0] = "mutated-event"
	attributes["nested"].(map[string]any)["value"] = "mutated"
	attributes["items"].([]any)[0] = "mutated"
	eventAttributes["channel"] = "mutated"
	errorDetails["credential"] = "mutated"
	sender.release(false)
	second := sender.receive(t)
	sender.release(true)

	if string(first) != string(second) {
		t.Fatalf("retry bytes changed after caller mutation:\nfirst:  %s\nsecond: %s", first, second)
	}
	if strings.Contains(string(second), "mutated") || strings.Contains(string(second), "must-not-cross") {
		t.Fatalf("retry contained caller-owned or private data: %s", second)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := producer.Close(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestProducerCapacityIncludesPendingAtOneAndLossIDsStayUnique(t *testing.T) {
	sender := newControlledSender()
	fixed := time.Date(2026, 7, 18, 12, 0, 0, 0, time.UTC)
	producer := telemetry.NewProducerWithOptions(sender, testSource(), telemetry.ProducerOptions{Capacity: 1, RetryDelay: time.Millisecond, Now: func() time.Time { return fixed }})
	producer.Observe(testObservation("observation-1", nil))
	first := decodeBatch(t, sender.receive(t))
	producer.Observe(testObservation("observation-2", nil))
	sender.release(true)
	firstLoss := decodeBatch(t, sender.receive(t))
	producer.Observe(testObservation("observation-3", nil))
	sender.release(true)
	secondLoss := decodeBatch(t, sender.receive(t))
	sender.release(true)

	if len(first.Observations) != 1 || first.Observations[0].ObservationID != "observation-1" {
		t.Fatalf("unexpected first pending batch: %#v", first.Observations)
	}
	if len(firstLoss.Observations) != 1 || firstLoss.Observations[0].Kind != "telemetry.dropped" || firstLoss.Observations[0].DroppedCount != 1 {
		t.Fatalf("capacity-one loss was not reported: %#v", firstLoss.Observations)
	}
	if len(secondLoss.Observations) != 1 || secondLoss.Observations[0].Kind != "telemetry.dropped" || secondLoss.Observations[0].DroppedCount != 1 {
		t.Fatalf("second capacity-one loss was not reported: %#v", secondLoss.Observations)
	}
	if firstLoss.Observations[0].ObservationID == secondLoss.Observations[0].ObservationID {
		t.Fatalf("fixed clock produced duplicate loss ID %q", firstLoss.Observations[0].ObservationID)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := producer.Close(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestProducerCapacityAcrossMaximumBatchBoundary(t *testing.T) {
	sender := newControlledSender()
	producer := telemetry.NewProducerWithOptions(sender, testSource(), telemetry.ProducerOptions{Capacity: telemetry.MaximumBatchSize + 1, RetryDelay: time.Millisecond})
	producer.Observe(testObservation("observation-1", nil))
	first := decodeBatch(t, sender.receive(t))
	for index := 2; index <= telemetry.MaximumBatchSize+2; index++ {
		producer.Observe(testObservation(fmt.Sprintf("observation-%d", index), nil))
	}
	sender.release(true)
	boundary := decodeBatch(t, sender.receive(t))
	sender.release(true)
	loss := decodeBatch(t, sender.receive(t))
	sender.release(true)

	if len(first.Observations) != 1 || len(boundary.Observations) != telemetry.MaximumBatchSize {
		t.Fatalf("unexpected batch sizes at capacity boundary: %d then %d", len(first.Observations), len(boundary.Observations))
	}
	if boundary.Observations[0].ObservationID != "observation-3" || boundary.Observations[len(boundary.Observations)-1].ObservationID != "observation-102" {
		t.Fatalf("drop-oldest boundary retained the wrong observations: %q through %q", boundary.Observations[0].ObservationID, boundary.Observations[len(boundary.Observations)-1].ObservationID)
	}
	if len(loss.Observations) != 1 || loss.Observations[0].Kind != "telemetry.dropped" || loss.Observations[0].DroppedCount != 1 {
		t.Fatalf("batch-boundary loss was not reported: %#v", loss.Observations)
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
	client := &protocol.ObservationClient{CollectorURL: "http://specter.invalid", HTTPClient: &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
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
	client := &protocol.ObservationClient{CollectorURL: "http://specter.invalid", HTTPClient: &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
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
	if observations[0].Error == nil || observations[0].Error.Code != string(specter.ErrInvalidInput) || observations[0].Error.Message != "Operation input is invalid." || observations[0].Error.Details != nil {
		t.Fatalf("coded error was not sanitized: %#v", observations[0].Error)
	}
	if observations[1].Error == nil || observations[1].Error.Code != string(specter.ErrInfrastructure) || observations[1].Error.Message != "Runtime operation failed." || observations[1].Error.Details != nil {
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
	client := &protocol.ObservationClient{CollectorURL: "http://specter.invalid", HTTPClient: &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
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
	wantSequences := []int64{7, 8, 9}
	if len(remaining.Observations) != len(wantSequences) {
		t.Fatalf("unexpected post-overflow batch: %#v", remaining.Observations)
	}
	for index, want := range wantSequences {
		if int64(remaining.Observations[index].Sequence) != want {
			t.Fatalf("sequence order changed at %d: got %d, want %d", index, remaining.Observations[index].Sequence, want)
		}
	}
	loss := remaining.Observations[len(remaining.Observations)-1]
	if loss.Kind != "telemetry.dropped" || loss.DroppedCount != 5 {
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

type controlledSender struct {
	bodies   chan []byte
	releases chan bool
}

func newControlledSender() *controlledSender {
	return &controlledSender{bodies: make(chan []byte, 8), releases: make(chan bool, 8)}
}

func (sender *controlledSender) SendObservations(ctx context.Context, batch protocol.RuntimeObservationBatch) (protocol.ObservationAcknowledgement, error) {
	body, err := json.Marshal(batch)
	if err != nil {
		return protocol.ObservationAcknowledgement{}, err
	}
	sender.bodies <- body
	select {
	case success := <-sender.releases:
		if !success {
			return protocol.ObservationAcknowledgement{}, fmt.Errorf("response lost")
		}
		return protocol.ObservationAcknowledgement{Envelope: protocol.Envelope{ProtocolVersion: protocol.Version, Kind: "observations.ack", RequestID: batch.RequestID}, Accepted: protocol.SafeInteger(len(batch.Observations))}, nil
	case <-ctx.Done():
		return protocol.ObservationAcknowledgement{}, ctx.Err()
	}
}

func (sender *controlledSender) receive(t *testing.T) []byte {
	t.Helper()
	select {
	case body := <-sender.bodies:
		return body
	case <-time.After(time.Second):
		t.Fatal("producer did not send a controlled batch")
		return nil
	}
}

func (sender *controlledSender) release(success bool) {
	sender.releases <- success
}

func decodeBatch(t *testing.T, body []byte) protocol.RuntimeObservationBatch {
	t.Helper()
	var batch protocol.RuntimeObservationBatch
	if err := json.Unmarshal(body, &batch); err != nil {
		t.Fatal(err)
	}
	return batch
}
