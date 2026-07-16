use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use async_trait::async_trait;
use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;
use tokio::sync::{Mutex, OwnedMutexGuard};

use crate::{Result, SpecterError};

pub trait DomainEvent: Serialize + DeserializeOwned + Send + Sync + 'static {
    const TYPE: &'static str;
}

#[derive(Clone)]
pub struct EventDefinition {
    event_type: &'static str,
    rust_type: std::any::TypeId,
    decode: fn(Value) -> Result<Value>,
}

impl EventDefinition {
    pub fn of<E: DomainEvent>() -> Self {
        Self {
            event_type: E::TYPE,
            rust_type: std::any::TypeId::of::<E>(),
            decode: decode_payload::<E>,
        }
    }

    pub fn event_type(&self) -> &'static str {
        self.event_type
    }

    pub fn rust_type(&self) -> std::any::TypeId {
        self.rust_type
    }

    pub fn decode(&self, payload: Value) -> Result<Value> {
        (self.decode)(payload)
    }
}

fn decode_payload<E: DomainEvent>(payload: Value) -> Result<Value> {
    let decoded: E = serde_json::from_value(payload.clone()).map_err(|error| {
        SpecterError::Serialization(format!("invalid payload for {:?}: {error}", E::TYPE))
    })?;
    let round_trip = serde_json::to_value(decoded)?;
    if round_trip != payload {
        return Err(SpecterError::LossyEventPayload {
            event_type: E::TYPE.to_owned(),
        });
    }
    Ok(round_trip)
}

#[derive(Debug, Clone, PartialEq)]
pub struct EventDraft {
    pub event_type: String,
    pub payload: Value,
}

impl EventDraft {
    pub fn new<E: DomainEvent>(payload: E) -> Result<Self> {
        Ok(Self {
            event_type: E::TYPE.to_owned(),
            payload: serde_json::to_value(payload)?,
        })
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PersistedEvent {
    pub id: String,
    pub order: u64,
    pub recorded_at_unix_ms: u128,
    pub event_type: String,
    pub payload: Value,
}

impl PersistedEvent {
    pub(crate) fn scenario(order: u64, event_type: String, payload: Value) -> Self {
        Self {
            id: format!("scenario-event-{order}"),
            order,
            recorded_at_unix_ms: 0,
            event_type,
            payload,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct EventLogCommit {
    pub events: Vec<PersistedEvent>,
    pub version: u64,
    pub idempotency_key: Option<String>,
    pub fingerprint: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct EventLogAppendResult {
    pub commit: EventLogCommit,
    pub duplicate: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct EventLogAppendOptions {
    pub expected_version: Option<u64>,
    pub idempotency_key: Option<String>,
    pub fingerprint: Option<String>,
}

/// A serialized Event Log transaction. Implementations must keep this guard
/// exclusive until it is dropped, so catch-up, decision, and append observe one
/// stable durable history.
#[async_trait]
pub trait EventLogTransaction: Send {
    async fn query(
        &mut self,
        after_order: u64,
        event_types: &[String],
    ) -> Result<Vec<PersistedEvent>>;
    async fn current_version(&mut self) -> Result<u64>;
    async fn find_commit(&mut self, idempotency_key: &str) -> Result<Option<EventLogCommit>>;
    async fn append(
        &mut self,
        events: Vec<EventDraft>,
        options: EventLogAppendOptions,
    ) -> Result<EventLogAppendResult>;
}

#[async_trait]
pub trait EventLog: Send + Sync {
    async fn transaction(&self) -> Result<Box<dyn EventLogTransaction>>;
}

#[derive(Default)]
struct InMemoryState {
    events: Vec<PersistedEvent>,
    commits: HashMap<String, EventLogCommit>,
}

#[derive(Default)]
pub struct InMemoryEventLog {
    state: Arc<Mutex<InMemoryState>>,
}

impl InMemoryEventLog {
    pub fn shared() -> Arc<Self> {
        Arc::new(Self::default())
    }
}

struct InMemoryTransaction {
    state: OwnedMutexGuard<InMemoryState>,
}

#[async_trait]
impl EventLog for InMemoryEventLog {
    async fn transaction(&self) -> Result<Box<dyn EventLogTransaction>> {
        Ok(Box::new(InMemoryTransaction {
            state: Arc::clone(&self.state).lock_owned().await,
        }))
    }
}

#[async_trait]
impl EventLogTransaction for InMemoryTransaction {
    async fn query(
        &mut self,
        after_order: u64,
        event_types: &[String],
    ) -> Result<Vec<PersistedEvent>> {
        let selected: HashSet<_> = event_types.iter().map(String::as_str).collect();
        Ok(self
            .state
            .events
            .iter()
            .filter(|event| {
                event.order > after_order && selected.contains(event.event_type.as_str())
            })
            .cloned()
            .collect())
    }

    async fn current_version(&mut self) -> Result<u64> {
        Ok(self.state.events.len() as u64)
    }

    async fn find_commit(&mut self, idempotency_key: &str) -> Result<Option<EventLogCommit>> {
        Ok(self.state.commits.get(idempotency_key).cloned())
    }

    async fn append(
        &mut self,
        drafts: Vec<EventDraft>,
        options: EventLogAppendOptions,
    ) -> Result<EventLogAppendResult> {
        if let Some(key) = options.idempotency_key.as_deref()
            && let Some(commit) = self.state.commits.get(key)
        {
            if commit.fingerprint != options.fingerprint {
                return Err(SpecterError::IdempotencyConflict {
                    idempotency_key: key.to_owned(),
                });
            }
            return Ok(EventLogAppendResult {
                commit: commit.clone(),
                duplicate: true,
            });
        }

        let actual_version = self.state.events.len() as u64;
        if let Some(expected_version) = options.expected_version
            && expected_version != actual_version
        {
            return Err(SpecterError::VersionConflict {
                expected_version,
                actual_version,
            });
        }

        let recorded_at_unix_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| SpecterError::EventLog(error.to_string()))?
            .as_millis();
        let mut appended = Vec::with_capacity(drafts.len());

        for draft in drafts {
            let order = self.state.events.len() as u64 + 1;
            let event = PersistedEvent {
                id: format!("event-{order}"),
                order,
                recorded_at_unix_ms,
                event_type: draft.event_type,
                payload: draft.payload,
            };
            self.state.events.push(event.clone());
            appended.push(event);
        }

        let commit = EventLogCommit {
            events: appended,
            version: self.state.events.len() as u64,
            idempotency_key: options.idempotency_key.clone(),
            fingerprint: options.fingerprint,
        };
        if let Some(key) = options.idempotency_key {
            self.state.commits.insert(key, commit.clone());
        }

        Ok(EventLogAppendResult {
            commit,
            duplicate: false,
        })
    }
}
