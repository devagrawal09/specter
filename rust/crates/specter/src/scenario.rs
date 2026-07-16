use serde::Serialize;
use serde_json::Value;

use crate::DomainEvent;

#[derive(Debug, Clone, PartialEq)]
pub struct ScenarioEvent {
    pub event_type: String,
    pub example_payload: Value,
}

pub fn event(event_type: impl Into<String>, payload: impl Serialize) -> ScenarioEvent {
    ScenarioEvent {
        event_type: event_type.into(),
        example_payload: example(payload),
    }
}

/// Convenience helper for tests that intentionally share a typed Event
/// payload with an implementation. Production specifications should normally
/// use [`event`] with a string Event type and an independent example payload.
pub fn typed_event<E: DomainEvent>(payload: E) -> ScenarioEvent {
    event(E::TYPE, payload)
}

pub(crate) fn example(value: impl Serialize) -> Value {
    serde_json::to_value(value).expect("Specter scenario examples must serialize")
}

#[derive(Debug, Clone)]
pub struct CommandScenario {
    pub description: String,
    pub given: Vec<ScenarioEvent>,
    pub when: Value,
    pub expect: Vec<ScenarioEvent>,
    pub reject_reason: Option<String>,
}

impl CommandScenario {
    pub fn accepted(
        description: impl Into<String>,
        given: Vec<ScenarioEvent>,
        when: impl Serialize,
        expect: Vec<ScenarioEvent>,
    ) -> Self {
        assert!(
            !expect.is_empty(),
            "an accepted Command Scenario must expect at least one Event"
        );
        Self {
            description: description.into(),
            given,
            when: example(when),
            expect,
            reject_reason: None,
        }
    }

    pub fn rejected(
        description: impl Into<String>,
        given: Vec<ScenarioEvent>,
        when: impl Serialize,
        reason: impl Into<String>,
    ) -> Self {
        Self {
            description: description.into(),
            given,
            when: example(when),
            expect: Vec::new(),
            reject_reason: Some(reason.into()),
        }
    }
}

#[derive(Debug, Clone)]
pub struct QueryScenario {
    pub description: String,
    pub given: Vec<ScenarioEvent>,
    pub when: Value,
    pub expect: Value,
}

impl QueryScenario {
    pub fn new(
        description: impl Into<String>,
        given: Vec<ScenarioEvent>,
        when: impl Serialize,
        expect: impl Serialize,
    ) -> Self {
        Self {
            description: description.into(),
            given,
            when: example(when),
            expect: example(expect),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ReactionScenario {
    pub description: String,
    pub given: Vec<ScenarioEvent>,
    pub expect: Vec<Value>,
}

impl ReactionScenario {
    pub fn new(
        description: impl Into<String>,
        given: Vec<ScenarioEvent>,
        expect: Vec<Value>,
    ) -> Self {
        Self {
            description: description.into(),
            given,
            expect,
        }
    }

    pub fn effects<T: Serialize>(effects: impl IntoIterator<Item = T>) -> Vec<Value> {
        effects.into_iter().map(example).collect()
    }
}
