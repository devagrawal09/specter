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

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}
