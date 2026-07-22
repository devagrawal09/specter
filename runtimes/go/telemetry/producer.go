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
const DefaultRetryWindow = 48 * time.Hour

const defaultRetryDelay = time.Second

type ProducerOptions struct {
	Capacity    int
	RetryWindow time.Duration
	RetryDelay  time.Duration
	Now         func() time.Time
}

type ObservationSender interface {
	SendObservations(context.Context, protocol.RuntimeObservationBatch) (protocol.ObservationAcknowledgement, error)
}

type Producer struct {
	client      ObservationSender
	source      protocol.RuntimeSource
	capacity    int
	retryWindow time.Duration
	retryDelay  time.Duration
	now         func() time.Time
	stop        chan struct{}
	done        chan struct{}
	wake        chan struct{}

	queueMu     sync.Mutex
	queue       []protocol.RuntimeObservation
	queueHead   int
	queueSize   int
	pendingSize int
	dropped     int64
	stopped     bool

	sequence  atomic.Int64
	closeOnce sync.Once
}

func NewProducer(client ObservationSender, source protocol.RuntimeSource, capacity int) *Producer {
	return NewProducerWithOptions(client, source, ProducerOptions{Capacity: capacity})
}

func NewProducerWithOptions(client ObservationSender, source protocol.RuntimeSource, options ProducerOptions) *Producer {
	capacity := options.Capacity
	if capacity <= 0 {
		capacity = DefaultQueueCapacity
	}
	retryWindow := options.RetryWindow
	if retryWindow <= 0 {
		retryWindow = DefaultRetryWindow
	}
	retryDelay := options.RetryDelay
	if retryDelay <= 0 {
		retryDelay = defaultRetryDelay
	}
	now := options.Now
	if now == nil {
		now = time.Now
	}
	producer := &Producer{
		client:      client,
		source:      source,
		capacity:    capacity,
		retryWindow: retryWindow,
		retryDelay:  retryDelay,
		now:         now,
		stop:        make(chan struct{}),
		done:        make(chan struct{}),
		wake:        make(chan struct{}, 1),
		queue:       make([]protocol.RuntimeObservation, capacity),
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
	runtimeObservation := protocol.ObservationFromRuntime(observation, p.source, p.sequence.Add(1))
	if p.queueSize+p.pendingSize == p.capacity && p.queueSize == 0 {
		p.dropped++
		p.queueMu.Unlock()
		p.signal()
		return
	}
	if p.queueSize+p.pendingSize == p.capacity {
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
	var pendingSince time.Time
	pendingQueuedCount := 0
	var pendingDroppedCount int64
	stopping := false
	retry := time.NewTimer(time.Hour)
	if !retry.Stop() {
		<-retry.C
	}
	defer retry.Stop()
	for {
		if len(pending) == 0 {
			pending, pendingQueuedCount, pendingDroppedCount = p.takeBatch()
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
			pendingSince = p.now()
		}
		if pendingRequestID == "" {
			pendingRequestID = p.requestID()
		}
		if p.now().Sub(pendingSince) >= p.retryWindow {
			p.releasePending(int64(pendingQueuedCount) + pendingDroppedCount)
			pending = nil
			pendingRequestID = ""
			pendingSince = time.Time{}
			pendingQueuedCount = 0
			pendingDroppedCount = 0
			continue
		}
		batch := protocol.RuntimeObservationBatch{Envelope: protocol.Envelope{RequestID: pendingRequestID}, Observations: pending}
		if p.send(batch) {
			p.releasePending(0)
			pending = nil
			pendingRequestID = ""
			pendingSince = time.Time{}
			pendingQueuedCount = 0
			pendingDroppedCount = 0
			continue
		}
		if stopping {
			if p.send(batch) {
				p.releasePending(0)
				pending = nil
				pendingRequestID = ""
				continue
			}
			return
		}
		retry.Reset(p.retryDelay)
		select {
		case <-retry.C:
		case <-p.stop:
			stopping = true
			if p.send(batch) {
				p.releasePending(0)
				pending = nil
				pendingRequestID = ""
				continue
			}
			return
		}
	}
}

func (p *Producer) lossObservation(dropped int64) protocol.RuntimeObservation {
	observedAt := p.now().UTC()
	sequence := p.sequence.Add(1)
	loss := specter.Observation{ObservationID: fmt.Sprintf("dropped_%d_%d", observedAt.UnixNano(), sequence), Kind: "telemetry.dropped", ObservedAt: observedAt, OperationID: "telemetry", DroppedCount: dropped}
	return protocol.ObservationFromRuntime(loss, p.source, sequence)
}

func (p *Producer) takeBatch() ([]protocol.RuntimeObservation, int, int64) {
	p.queueMu.Lock()
	defer p.queueMu.Unlock()
	count := min(p.queueSize, MaximumBatchSize)
	reportedDropped := int64(0)
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
			reportedDropped = p.dropped
			batch = append(batch, p.lossObservation(reportedDropped))
			p.dropped = 0
		}
	}
	p.pendingSize = len(batch)
	return batch, count, reportedDropped
}

func (p *Producer) releasePending(dropped int64) {
	p.queueMu.Lock()
	p.pendingSize = 0
	p.dropped += dropped
	p.queueMu.Unlock()
}

func (p *Producer) signal() {
	select {
	case p.wake <- struct{}{}:
	default:
	}
}
func (p *Producer) requestID() string {
	return fmt.Sprintf("telemetry_%d_%d", p.now().UTC().UnixNano(), p.sequence.Load())
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
