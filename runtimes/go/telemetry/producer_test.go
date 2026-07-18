package telemetry_test

import (
	"context"
	"net/http/httptest"
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
