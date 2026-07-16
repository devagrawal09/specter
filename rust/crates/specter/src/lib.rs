//! An experimental Rust port of Specter 0.3's vertically sliced, event-sourced runtime.
//!
//! The crate keeps specifications independent from implementations, validates
//! scenario and event conformance when an app is built, and exposes commands
//! and queries through typed references plus transport-friendly erased envelopes.

mod app;
mod error;
mod event;
mod scenario;
mod slice;
mod spec;

pub mod testing;

pub use app::{
    CommandExecution, CommandOptions, QuerySubscription, ReactionDeliveryContext, ReactionTicket,
    SpecterApp, SpecterAppBuilder, SpecterObservation, SpecterObserver,
};
pub use error::{
    ConformanceDiagnostic, ConformanceErrors, Result, ScenarioFailure, ScenarioFailures,
    SpecterError,
};
pub use event::{
    DomainEvent, EventDefinition, EventDraft, EventLog, EventLogAppendOptions,
    EventLogAppendResult, EventLogCommit, EventLogTransaction, InMemoryEventLog, PersistedEvent,
};
pub use scenario::{
    CommandScenario, QueryScenario, ReactionScenario, ScenarioEvent, event, typed_event,
};
pub use slice::{CommandSlice, QuerySlice, ReactionSlice};
pub use spec::{
    CommandEnvelope, CommandRef, CommandSpec, QueryEnvelope, QueryRef, QuerySpec, ReactionSpec,
    command, query, reaction,
};
