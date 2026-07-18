// Package telemetry provides non-blocking, best-effort runtime observation delivery.
package telemetry

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/devagrawal09/specter/runtimes/go/protocol"
	"github.com/devagrawal09/specter/runtimes/go/specter"
)

const DefaultQueueCapacity = 10_000
const MaximumBatchSize = 100

type Producer struct {
	client    *protocol.Client
	source    protocol.RuntimeSource
	queue     chan protocol.RuntimeObservation
	stop      chan struct{}
	done      chan struct{}
	dropped   atomic.Int64
	sequence  atomic.Int64
	closeOnce sync.Once
}

func NewProducer(client *protocol.Client, source protocol.RuntimeSource, capacity int) *Producer {
	if capacity <= 0 {
		capacity = DefaultQueueCapacity
	}
	producer := &Producer{client: client, source: source, queue: make(chan protocol.RuntimeObservation, capacity), stop: make(chan struct{}), done: make(chan struct{})}
	go producer.run()
	return producer
}

// Observe never blocks application work. When full it drops the oldest queued item.
func (p *Producer) Observe(observation specter.Observation) {
	runtimeObservation := protocol.RuntimeObservation{Observation: observation, Sequence: p.sequence.Add(1), Source: p.source}
	select {
	case p.queue <- runtimeObservation:
		return
	default:
	}
	select {
	case <-p.queue:
		p.dropped.Add(1)
	default:
	}
	select {
	case p.queue <- runtimeObservation:
	default:
		p.dropped.Add(1)
	}
}

func (p *Producer) Close(ctx context.Context) error {
	p.closeOnce.Do(func() { close(p.stop) })
	select {
	case <-p.done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (p *Producer) run() {
	defer close(p.done)
	pending := make([]protocol.RuntimeObservation, 0, MaximumBatchSize)
	retry := time.NewTimer(time.Hour)
	if !retry.Stop() {
		<-retry.C
	}
	defer retry.Stop()
	for {
		if len(pending) == 0 {
			if dropped := p.dropped.Swap(0); dropped > 0 {
				pending = append(pending, p.lossObservation(dropped))
			} else {
				select {
				case observation := <-p.queue:
					pending = append(pending, observation)
				case <-p.stop:
					p.drain(&pending)
					p.send(pending)
					return
				}
			}
		}
		for len(pending) < MaximumBatchSize {
			select {
			case observation := <-p.queue:
				pending = append(pending, observation)
			default:
				goto send
			}
		}
	send:
		if len(pending) < MaximumBatchSize {
			if dropped := p.dropped.Swap(0); dropped > 0 {
				pending = append(pending, p.lossObservation(dropped))
			}
		}
		if p.send(pending) {
			pending = pending[:0]
			continue
		}
		retry.Reset(time.Second)
		select {
		case <-retry.C:
		case <-p.stop:
			p.drain(&pending)
			p.send(pending)
			return
		}
	}
}

func (p *Producer) lossObservation(dropped int64) protocol.RuntimeObservation {
	observedAt := time.Now().UTC()
	loss := specter.Observation{ObservationID: fmt.Sprintf("dropped_%d", observedAt.UnixNano()), Kind: "telemetry.dropped", ObservedAt: observedAt, OperationID: "telemetry", DroppedCount: dropped}
	return protocol.RuntimeObservation{Observation: loss, Sequence: p.sequence.Add(1), Source: p.source}
}
func (p *Producer) drain(pending *[]protocol.RuntimeObservation) {
	for len(*pending) < MaximumBatchSize {
		select {
		case observation := <-p.queue:
			*pending = append(*pending, observation)
		default:
			return
		}
	}
}
func (p *Producer) send(observations []protocol.RuntimeObservation) bool {
	if len(observations) == 0 {
		return true
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	ack, err := p.client.SendObservations(ctx, protocol.RuntimeObservationBatch{Observations: observations})
	return err == nil && len(ack.RejectedObservationIDs) == 0
}
