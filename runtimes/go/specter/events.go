package specter

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sync"
	"time"
)

type EventDraft struct {
	Type       string         `json:"type"`
	Payload    any            `json:"payload"`
	Attributes map[string]any `json:"attributes,omitempty"`
}

type PersistedEvent struct {
	ID            string          `json:"id"`
	Type          string          `json:"type"`
	Payload       json.RawMessage `json:"payload"`
	Attributes    map[string]any  `json:"attributes,omitempty"`
	GlobalOrder   int64           `json:"globalOrder"`
	CommitVersion int64           `json:"commitVersion"`
	RecordedAt    time.Time       `json:"recordedAt"`
}

type Commit struct {
	Events           []PersistedEvent
	Version          int64
	Duplicate        bool
	IdempotencyKey   string
	ReactionTicketID string
}

type storedCommit struct {
	Commit
	fingerprint string
}

// MemoryEventLog is an atomic, ordered, process-local reference Event Log.
type MemoryEventLog struct {
	mu            sync.RWMutex
	transactionMu sync.Mutex
	events        []PersistedEvent
	commits       map[string]storedCommit
	now           func() time.Time
}

func NewMemoryEventLog() *MemoryEventLog {
	return &MemoryEventLog{commits: make(map[string]storedCommit), now: time.Now}
}

func (l *MemoryEventLog) Version() int64 {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return int64(len(l.events))
}

func (l *MemoryEventLog) Query(after int64, types map[string]struct{}) []PersistedEvent {
	l.mu.RLock()
	defer l.mu.RUnlock()
	out := make([]PersistedEvent, 0)
	for _, event := range l.events {
		if event.GlobalOrder <= after {
			continue
		}
		if len(types) > 0 {
			if _, ok := types[event.Type]; !ok {
				continue
			}
		}
		out = append(out, cloneEvent(event))
	}
	return out
}

func (l *MemoryEventLog) findCommit(key, fingerprint string) (Commit, bool, error) {
	if key == "" {
		return Commit{}, false, nil
	}
	l.mu.RLock()
	defer l.mu.RUnlock()
	prior, ok := l.commits[key]
	if !ok {
		return Commit{}, false, nil
	}
	if prior.fingerprint != fingerprint {
		return Commit{}, false, newError(ErrIdempotencyConflict, fmt.Sprintf("Idempotency key %q was already used for a different Command.", key), map[string]any{"idempotencyKey": key}, nil)
	}
	result := prior.Commit
	result.Duplicate = true
	result.Events = cloneEvents(result.Events)
	return result, true, nil
}

func (l *MemoryEventLog) append(ctx context.Context, drafts []EventDraft, expected *int64, key, fingerprint, reactionTicketID string) (Commit, error) {
	if err := ctx.Err(); err != nil {
		return Commit{}, err
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if key != "" {
		if prior, ok := l.commits[key]; ok {
			if prior.fingerprint != fingerprint {
				return Commit{}, newError(ErrIdempotencyConflict, fmt.Sprintf("Idempotency key %q was already used for a different Command.", key), map[string]any{"idempotencyKey": key}, nil)
			}
			result := prior.Commit
			result.Duplicate = true
			result.Events = cloneEvents(result.Events)
			return result, nil
		}
	}
	version := int64(len(l.events))
	if expected != nil && *expected != version {
		return Commit{}, newError(ErrVersionConflict, fmt.Sprintf("Event Log version conflict: expected %d, received %d.", *expected, version), map[string]any{"expectedVersion": *expected, "actualVersion": version}, nil)
	}
	when := l.now().UTC()
	committed := make([]PersistedEvent, len(drafts))
	commitVersion := version + int64(len(drafts))
	for i, draft := range drafts {
		payload, err := json.Marshal(draft.Payload)
		if err != nil {
			return Commit{}, newError(ErrInvalidOutput, "Command emitted a non-JSON Event payload.", nil, err)
		}
		order := version + int64(i) + 1
		hash := sha256.Sum256([]byte(fmt.Sprintf("%d:%s:%s", order, draft.Type, payload)))
		committed[i] = PersistedEvent{ID: hex.EncodeToString(hash[:16]), Type: draft.Type, Payload: payload, Attributes: draft.Attributes, GlobalOrder: order, CommitVersion: commitVersion, RecordedAt: when}
	}
	l.events = append(l.events, committed...)
	result := Commit{Events: cloneEvents(committed), Version: commitVersion, IdempotencyKey: key, ReactionTicketID: reactionTicketID}
	if key != "" {
		l.commits[key] = storedCommit{Commit: result, fingerprint: fingerprint}
	}
	return result, nil
}

func cloneEvents(in []PersistedEvent) []PersistedEvent {
	out := make([]PersistedEvent, len(in))
	for i := range in {
		out[i] = cloneEvent(in[i])
	}
	return out
}
func cloneEvent(in PersistedEvent) PersistedEvent {
	in.Payload = append(json.RawMessage(nil), in.Payload...)
	return in
}
