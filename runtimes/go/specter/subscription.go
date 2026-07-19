package specter

import (
	"context"
	"encoding/json"
	"sync"
	"sync/atomic"
)

type SubscriptionValue struct {
	Value any
	Err   error
}
type Subscription struct {
	ID         uint64
	C          <-chan SubscriptionValue
	app        *App
	query      string
	payload    json.RawMessage
	options    DispatchOptions
	values     chan SubscriptionValue
	ctx        context.Context
	cancel     context.CancelFunc
	closeOnce  sync.Once
	sendMu     sync.Mutex
	generation atomic.Uint64
}

func (a *App) Subscribe(ctx context.Context, query string, payload any) (*Subscription, error) {
	raw, err := marshalInput(payload)
	if err != nil {
		return nil, err
	}
	return a.SubscribeJSON(ctx, query, raw, DispatchOptions{})
}

func (a *App) SubscribeJSON(ctx context.Context, query string, payload json.RawMessage, options DispatchOptions) (*Subscription, error) {
	if err := a.beginOperation(); err != nil {
		return nil, err
	}
	if a.queries[query] == nil {
		a.endOperation()
		return nil, unknownQuery(query)
	}
	ctx, cancel := context.WithCancel(ctx)
	values := make(chan SubscriptionValue, 1)
	sub := &Subscription{ID: a.nextSubscription.Add(1), C: values, app: a, query: query, payload: payload, options: options, values: values, ctx: ctx, cancel: cancel}
	initialGeneration := sub.generation.Add(1)
	a.subMu.Lock()
	a.subscriptions[sub.ID] = sub
	a.subMu.Unlock()
	a.endOperation()
	if err := sub.refresh(initialGeneration, options); err != nil {
		sub.Close()
		return nil, err
	}
	go func() { <-ctx.Done(); sub.Close() }()
	return sub, nil
}

func (a *App) closeSubscriptions() {
	a.subMu.Lock()
	subscriptions := make([]*Subscription, 0, len(a.subscriptions))
	for _, sub := range a.subscriptions {
		subscriptions = append(subscriptions, sub)
	}
	a.subMu.Unlock()
	for _, sub := range subscriptions {
		sub.Close()
	}
}

func (s *Subscription) Close() {
	s.closeOnce.Do(func() {
		s.cancel()
		s.app.subMu.Lock()
		delete(s.app.subscriptions, s.ID)
		s.app.subMu.Unlock()
		s.sendMu.Lock()
		close(s.values)
		s.sendMu.Unlock()
	})
}

func (s *Subscription) refresh(generation uint64, options DispatchOptions) error {
	value, err := s.app.QueryJSON(s.ctx, s.query, s.payload, options)
	if err != nil && s.ctx.Err() != nil {
		return s.ctx.Err()
	}
	s.sendMu.Lock()
	defer s.sendMu.Unlock()
	if s.ctx.Err() != nil {
		return s.ctx.Err()
	}
	// A slower refresh must never replace the result of a later invalidation.
	if generation != s.generation.Load() {
		return nil
	}
	item := SubscriptionValue{Value: value, Err: err}
	select {
	case s.values <- item:
	default:
		select {
		case <-s.values:
		default:
		}
		select {
		case s.values <- item:
		case <-s.ctx.Done():
			return s.ctx.Err()
		}
	}
	return nil
}

func (a *App) invalidateSubscriptions(parent, correlation string) {
	a.subMu.Lock()
	subscriptions := make([]*Subscription, 0, len(a.subscriptions))
	for _, sub := range a.subscriptions {
		subscriptions = append(subscriptions, sub)
	}
	a.subMu.Unlock()
	for _, sub := range subscriptions {
		generation := sub.generation.Add(1)
		operation := newID("op")
		a.emit(Observation{Kind: "subscription.invalidated", OperationID: operation, CorrelationID: correlation, ParentOperationIDs: []string{parent}, QueryType: sub.query})
		options := sub.options
		options.OperationID = newID("op")
		options.CorrelationID = correlation
		options.ParentOperationIDs = []string{operation}
		options.TriggeringEventIDs = nil
		options.TriggeringEventOrder = nil
		options.ReactionPassID = ""
		options.DeliveryID = ""
		options.AttemptID = ""
		_ = sub.refresh(generation, options)
	}
}
