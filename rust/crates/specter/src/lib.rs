//! An experimental Rust port of Specter's vertically sliced, event-sourced runtime.
//!
//! The crate keeps specifications independent from implementations, validates
//! scenario and event conformance when an app is built, and exposes commands
//! and queries through typed-payload envelopes.

mod app;
mod error;
mod event;
mod scenario;
mod slice;
mod spec;

pub mod testing;

pub use app::{SpecterApp, SpecterAppBuilder};
pub use error::{
    ConformanceDiagnostic, ConformanceErrors, Result, ScenarioFailure, ScenarioFailures,
    SpecterError,
};
pub use event::{
    DomainEvent, EventDefinition, EventDraft, EventLog, InMemoryEventLog, PersistedEvent,
};
pub use scenario::{
    CommandScenario, QueryScenario, ReactionScenario, ScenarioEvent, event, typed_event,
};
pub use slice::{CommandSlice, QuerySlice, ReactionSlice};
pub use spec::{
    CommandEnvelope, CommandSpec, QueryEnvelope, QuerySpec, ReactionSpec, command, query, reaction,
};
