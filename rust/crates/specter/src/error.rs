use std::fmt::{self, Display, Formatter};

use thiserror::Error;

pub type Result<T> = std::result::Result<T, SpecterError>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConformanceDiagnostic {
    pub code: &'static str,
    pub message: String,
    pub slice_name: Option<String>,
    pub scenario_description: Option<String>,
    pub event_type: Option<String>,
}

impl ConformanceDiagnostic {
    pub(crate) fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            slice_name: None,
            scenario_description: None,
            event_type: None,
        }
    }

    pub(crate) fn for_slice(mut self, slice_name: impl Into<String>) -> Self {
        self.slice_name = Some(slice_name.into());
        self
    }

    pub(crate) fn for_scenario(mut self, description: impl Into<String>) -> Self {
        self.scenario_description = Some(description.into());
        self
    }

    pub(crate) fn for_event(mut self, event_type: impl Into<String>) -> Self {
        self.event_type = Some(event_type.into());
        self
    }
}

impl Display for ConformanceDiagnostic {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        write!(formatter, "[{}]", self.code)?;
        if let Some(slice_name) = &self.slice_name {
            write!(formatter, " slice {slice_name:?}")?;
        }
        if let Some(description) = &self.scenario_description {
            write!(formatter, " scenario {description:?}")?;
        }
        if let Some(event_type) = &self.event_type {
            write!(formatter, " event {event_type:?}")?;
        }
        write!(formatter, ": {}", self.message)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConformanceErrors(pub Vec<ConformanceDiagnostic>);

impl Display for ConformanceErrors {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        writeln!(
            formatter,
            "Specter conformance failed with {} issue{}:",
            self.0.len(),
            if self.0.len() == 1 { "" } else { "s" }
        )?;
        for (index, diagnostic) in self.0.iter().enumerate() {
            writeln!(formatter, "{}. {diagnostic}", index + 1)?;
        }
        Ok(())
    }
}

impl std::error::Error for ConformanceErrors {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScenarioFailure {
    pub slice_name: String,
    pub scenario_description: String,
    pub message: String,
}

impl Display for ScenarioFailure {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "slice {:?}, scenario {:?}: {}",
            self.slice_name, self.scenario_description, self.message
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScenarioFailures(pub Vec<ScenarioFailure>);

impl Display for ScenarioFailures {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        writeln!(
            formatter,
            "{} Specter scenario{} failed:",
            self.0.len(),
            if self.0.len() == 1 { "" } else { "s" }
        )?;
        for (index, failure) in self.0.iter().enumerate() {
            writeln!(formatter, "{}. {failure}", index + 1)?;
        }
        Ok(())
    }
}

impl std::error::Error for ScenarioFailures {}

#[derive(Debug, Error)]
pub enum SpecterError {
    #[error("serialization failed: {0}")]
    Serialization(String),

    #[error("Event {event_type:?} did not round-trip losslessly through its schema")]
    LossyEventPayload { event_type: String },

    #[error("unknown Event type: {0}")]
    UnknownEvent(String),

    #[error("unknown command: {0}")]
    UnknownCommand(String),

    #[error("unknown query: {0}")]
    UnknownQuery(String),

    #[error("invalid input for {slice_name:?}: {message}")]
    InvalidInput { slice_name: String, message: String },

    #[error("command rejected: {0}")]
    RejectedCommand(String),

    #[error("command {0:?} emitted no Events")]
    CommandEmittedNoEvents(String),

    #[error("command {slice_name:?} emitted unauthorized Event {event_type:?}")]
    UnauthorizedEvent {
        slice_name: String,
        event_type: String,
    },

    #[error("reaction drain exceeded {0} passes")]
    ReactionLoopLimit(usize),

    #[error("{0}")]
    Conformance(#[from] ConformanceErrors),

    #[error("{0}")]
    Scenarios(#[from] ScenarioFailures),

    #[error("event log failure: {0}")]
    EventLog(String),

    #[error("{0}")]
    Message(String),
}

impl SpecterError {
    pub fn rejected(reason: impl Into<String>) -> Self {
        Self::RejectedCommand(reason.into())
    }
}

impl From<serde_json::Error> for SpecterError {
    fn from(error: serde_json::Error) -> Self {
        Self::Serialization(error.to_string())
    }
}
