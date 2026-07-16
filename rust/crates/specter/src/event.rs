use std::{
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use async_trait::async_trait;
use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;
use tokio::sync::Mutex;

use crate::{Result, SpecterError};

pub trait DomainEvent: Serialize + DeserializeOwned + Send + Sync + 'static {
    const TYPE: &'static str;
}

#[derive(Clone)]
pub struct EventDefinition {
    event_type: &'static str,
    decode: fn(Value) -> Result<Value>,
}

impl EventDefinition {
    pub fn of<E: DomainEvent>() -> Self {
        Self {
            event_type: E::TYPE,
            decode: decode_payload::<E>,
        }
    }

    pub fn event_type(&self) -> &'static str {
        self.event_type
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

#[async_trait]
pub trait EventLog: Send + Sync {
    async fn load(&self) -> Result<Vec<PersistedEvent>>;
    async fn append(&self, events: Vec<EventDraft>) -> Result<Vec<PersistedEvent>>;
}

#[derive(Default)]
pub struct InMemoryEventLog {
    events: Mutex<Vec<PersistedEvent>>,
}

impl InMemoryEventLog {
    pub fn shared() -> Arc<Self> {
        Arc::new(Self::default())
    }
}

#[async_trait]
impl EventLog for InMemoryEventLog {
    async fn load(&self) -> Result<Vec<PersistedEvent>> {
        Ok(self.events.lock().await.clone())
    }

    async fn append(&self, drafts: Vec<EventDraft>) -> Result<Vec<PersistedEvent>> {
        let mut events = self.events.lock().await;
        let recorded_at_unix_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| SpecterError::EventLog(error.to_string()))?
            .as_millis();
        let mut appended = Vec::with_capacity(drafts.len());

        for draft in drafts {
            let order = events.len() as u64 + 1;
            let event = PersistedEvent {
                id: format!("event-{order}"),
                order,
                recorded_at_unix_ms,
                event_type: draft.event_type,
                payload: draft.payload,
            };
            events.push(event.clone());
            appended.push(event);
        }

        Ok(appended)
    }
}
