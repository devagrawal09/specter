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
	client   *protocol.Client
	source   protocol.RuntimeSource
	capacity int
	stop     chan struct{}
	done     chan struct{}
	wake     chan struct{}

	queueMu   sync.Mutex
	queue     []protocol.RuntimeObservation
	queueHead int
	queueSize int
	dropped   int64
	stopped   bool

	sequence  atomic.Int64
	closeOnce sync.Once
}

func NewProducer(client *protocol.Client, source protocol.RuntimeSource, capacity int) *Producer {
	if capacity <= 0 {
		capacity = DefaultQueueCapacity
	}
	producer := &Producer{
		client:   client,
		source:   source,
		capacity: capacity,
		stop:     make(chan struct{}),
		done:     make(chan struct{}),
		wake:     make(chan struct{}, 1),
		queue:    make([]protocol.RuntimeObservation, capacity),
	}
	go producer.run()
	return producer
}

// Observe never blocks application work. When full it drops the oldest queued item.
func (p *Producer) Observe(observation specter.Observation) {
	p.queueMu.Lock()
	if p.stopped {
		p.queueMu.Unlock()
		return
	}
	if observation.Error != nil {
		observation.Error = protocol.PublicError(observation.Error)
	}
	runtimeObservation := protocol.RuntimeObservation{Observation: observation, Sequence: p.sequence.Add(1), Source: p.source}
	if p.queueSize == p.capacity {
		p.queue[p.queueHead] = protocol.RuntimeObservation{}
		p.queueHead = (p.queueHead + 1) % p.capacity
		p.dropped++
		p.queueSize--
	}
	tail := (p.queueHead + p.queueSize) % p.capacity
	p.queue[tail] = runtimeObservation
	p.queueSize++
	p.queueMu.Unlock()
	p.signal()
}

func (p *Producer) Close(ctx context.Context) error {
	p.closeOnce.Do(func() {
		p.queueMu.Lock()
		p.stopped = true
		p.queueMu.Unlock()
		close(p.stop)
	})
	select {
	case <-p.done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (p *Producer) run() {
	defer close(p.done)
	var pending []protocol.RuntimeObservation
	pendingRequestID := ""
	stopping := false
	retry := time.NewTimer(time.Hour)
	if !retry.Stop() {
		<-retry.C
	}
	defer retry.Stop()
	for {
		if len(pending) == 0 {
			pending = p.takeBatch()
			if len(pending) == 0 {
				if stopping {
					return
				}
				select {
				case <-p.wake:
					continue
				case <-p.stop:
					stopping = true
					continue
				}
			}
		}
		if pendingRequestID == "" {
			pendingRequestID = p.requestID()
		}
		batch := protocol.RuntimeObservationBatch{Envelope: protocol.Envelope{RequestID: pendingRequestID}, Observations: pending}
		if p.send(batch) {
			pending = nil
			pendingRequestID = ""
			continue
		}
		if stopping {
			if p.send(batch) {
				pending = nil
				pendingRequestID = ""
				continue
			}
			return
		}
		retry.Reset(time.Second)
		select {
		case <-retry.C:
		case <-p.stop:
			stopping = true
			if p.send(batch) {
				pending = nil
				pendingRequestID = ""
				continue
			}
			return
		}
	}
}

func (p *Producer) lossObservation(dropped int64) protocol.RuntimeObservation {
	observedAt := time.Now().UTC()
	loss := specter.Observation{ObservationID: fmt.Sprintf("dropped_%d", observedAt.UnixNano()), Kind: "telemetry.dropped", ObservedAt: observedAt, OperationID: "telemetry", DroppedCount: dropped}
	return protocol.RuntimeObservation{Observation: loss, Sequence: p.sequence.Add(1), Source: p.source}
}

func (p *Producer) takeBatch() []protocol.RuntimeObservation {
	p.queueMu.Lock()
	defer p.queueMu.Unlock()
	count := min(p.queueSize, MaximumBatchSize)
	batch := make([]protocol.RuntimeObservation, 0, MaximumBatchSize)
	for range count {
		batch = append(batch, p.queue[p.queueHead])
		p.queue[p.queueHead] = protocol.RuntimeObservation{}
		p.queueHead = (p.queueHead + 1) % p.capacity
		p.queueSize--
	}
	if p.queueSize == 0 {
		p.queueHead = 0
		if p.dropped > 0 && len(batch) < MaximumBatchSize {
			batch = append(batch, p.lossObservation(p.dropped))
			p.dropped = 0
		}
	}
	return batch
}

func (p *Producer) signal() {
	select {
	case p.wake <- struct{}{}:
	default:
	}
}
func (p *Producer) requestID() string {
	return fmt.Sprintf("telemetry_%d_%d", time.Now().UTC().UnixNano(), p.sequence.Load())
}
func (p *Producer) send(batch protocol.RuntimeObservationBatch) bool {
	if len(batch.Observations) == 0 {
		return true
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err := p.client.SendObservations(ctx, batch)
	return err == nil
}
