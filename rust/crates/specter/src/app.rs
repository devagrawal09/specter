use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;
use tokio::sync::Mutex;

use crate::{
    CommandEnvelope, CommandSlice, ConformanceDiagnostic, ConformanceErrors, DomainEvent,
    EventDefinition, EventDraft, EventLog, InMemoryEventLog, PersistedEvent, QueryEnvelope,
    QuerySlice, ReactionSlice, Result, ScenarioFailure, ScenarioFailures, SpecterError,
    slice::{DynCommandSlice, DynQuerySlice, DynReactionSlice},
    spec::SliceMetadata,
};

const MAX_REACTION_PASSES: usize = 1_024;

pub struct SpecterAppBuilder {
    events: Vec<EventDefinition>,
    event_log: Arc<dyn EventLog>,
    commands: Vec<Arc<dyn DynCommandSlice>>,
    queries: Vec<Arc<dyn DynQuerySlice>>,
    reactions: Vec<Arc<dyn DynReactionSlice>>,
}

impl Default for SpecterAppBuilder {
    fn default() -> Self {
        Self {
            events: Vec::new(),
            event_log: InMemoryEventLog::shared(),
            commands: Vec::new(),
            queries: Vec::new(),
            reactions: Vec::new(),
        }
    }
}

impl SpecterAppBuilder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn event<E: DomainEvent>(mut self) -> Self {
        self.events.push(EventDefinition::of::<E>());
        self
    }

    pub fn event_definition(mut self, definition: EventDefinition) -> Self {
        self.events.push(definition);
        self
    }

    pub fn event_log(mut self, event_log: Arc<dyn EventLog>) -> Self {
        self.event_log = event_log;
        self
    }

    pub fn command<I, S>(mut self, slice: CommandSlice<I, S>) -> Self
    where
        I: DeserializeOwned + Send + Sync + 'static,
        S: Clone + Send + Sync + 'static,
    {
        self.commands.push(Arc::new(slice));
        self
    }

    pub fn query<I, O, S>(mut self, slice: QuerySlice<I, O, S>) -> Self
    where
        I: DeserializeOwned + Send + Sync + 'static,
        O: DeserializeOwned + Send + Sync + 'static,
        S: Clone + Send + Sync + 'static,
    {
        self.queries.push(Arc::new(slice));
        self
    }

    pub fn reaction<O, S>(mut self, slice: ReactionSlice<O, S>) -> Self
    where
        O: DeserializeOwned + Send + Sync + 'static,
        S: Clone + Send + Sync + 'static,
    {
        self.reactions.push(Arc::new(slice));
        self
    }

    pub async fn build(self) -> Result<SpecterApp> {
        let event_definitions =
            collect_conformance(&self.events, &self.commands, &self.queries, &self.reactions)?;

        let commands = self
            .commands
            .into_iter()
            .map(|slice| (slice.metadata().name, slice))
            .collect();
        let queries = self
            .queries
            .into_iter()
            .map(|slice| (slice.metadata().name, slice))
            .collect();
        let reactions = self
            .reactions
            .into_iter()
            .map(|slice| (slice.metadata().name, slice))
            .collect();

        Ok(SpecterApp {
            inner: Arc::new(AppInner {
                event_definitions,
                event_log: self.event_log,
                commands,
                queries,
                reactions,
                operation: Mutex::new(()),
            }),
        })
    }
}

struct AppInner {
    event_definitions: HashMap<String, EventDefinition>,
    event_log: Arc<dyn EventLog>,
    commands: HashMap<String, Arc<dyn DynCommandSlice>>,
    queries: HashMap<String, Arc<dyn DynQuerySlice>>,
    reactions: HashMap<String, Arc<dyn DynReactionSlice>>,
    operation: Mutex<()>,
}

#[derive(Clone)]
pub struct SpecterApp {
    inner: Arc<AppInner>,
}

impl SpecterApp {
    pub async fn command(&self, envelope: CommandEnvelope) -> Result<Vec<PersistedEvent>> {
        let _operation = self.inner.operation.lock().await;
        let appended = self.run_command_locked(envelope).await?;
        self.drain_reactions_locked().await?;
        Ok(appended)
    }

    pub async fn command_typed(
        &self,
        command_type: impl Into<String>,
        payload: impl Serialize,
    ) -> Result<Vec<PersistedEvent>> {
        self.command(CommandEnvelope::new(command_type, payload)?)
            .await
    }

    pub async fn query(&self, envelope: QueryEnvelope) -> Result<Value> {
        let _operation = self.inner.operation.lock().await;
        let query = self
            .inner
            .queries
            .get(&envelope.r#type)
            .ok_or_else(|| SpecterError::UnknownQuery(envelope.r#type.clone()))?;
        let events = self.inner.event_log.load().await?;
        query.execute(envelope.payload, &events).await
    }

    pub async fn query_as<O: DeserializeOwned>(&self, envelope: QueryEnvelope) -> Result<O> {
        let output = self.query(envelope).await?;
        serde_json::from_value(output).map_err(Into::into)
    }

    pub async fn query_typed<I: Serialize, O: DeserializeOwned>(
        &self,
        query_type: impl Into<String>,
        payload: I,
    ) -> Result<O> {
        self.query_as(QueryEnvelope::new(query_type, payload)?)
            .await
    }

    pub async fn events(&self) -> Result<Vec<PersistedEvent>> {
        self.inner.event_log.load().await
    }

    pub async fn assert_scenarios(&self) -> Result<()> {
        let mut failures = Vec::new();

        let mut command_names: Vec<_> = self.inner.commands.keys().cloned().collect();
        command_names.sort();
        for name in command_names {
            failures.extend(self.inner.commands[&name].scenario_failures().await);
        }

        let mut query_names: Vec<_> = self.inner.queries.keys().cloned().collect();
        query_names.sort();
        for name in query_names {
            failures.extend(self.inner.queries[&name].scenario_failures().await);
        }

        let mut reaction_names: Vec<_> = self.inner.reactions.keys().cloned().collect();
        reaction_names.sort();
        for name in reaction_names {
            failures.extend(self.inner.reactions[&name].scenario_failures().await);
        }

        if failures.is_empty() {
            Ok(())
        } else {
            Err(ScenarioFailures(failures).into())
        }
    }

    async fn run_command_locked(&self, envelope: CommandEnvelope) -> Result<Vec<PersistedEvent>> {
        let command = self
            .inner
            .commands
            .get(&envelope.r#type)
            .ok_or_else(|| SpecterError::UnknownCommand(envelope.r#type.clone()))?;
        let events = self.inner.event_log.load().await?;
        let drafts = command.execute(envelope.payload, &events).await?;

        if drafts.is_empty() {
            return Err(SpecterError::CommandEmittedNoEvents(envelope.r#type));
        }

        let allowed_event_types = command.allowed_event_types();
        let mut decoded = Vec::with_capacity(drafts.len());
        for draft in drafts {
            if !allowed_event_types.contains(&draft.event_type) {
                return Err(SpecterError::UnauthorizedEvent {
                    slice_name: envelope.r#type.clone(),
                    event_type: draft.event_type,
                });
            }
            decoded.push(self.decode_event(draft)?);
        }

        self.inner.event_log.append(decoded).await
    }

    fn decode_event(&self, draft: EventDraft) -> Result<EventDraft> {
        let definition = self
            .inner
            .event_definitions
            .get(&draft.event_type)
            .ok_or_else(|| SpecterError::UnknownEvent(draft.event_type.clone()))?;
        Ok(EventDraft {
            event_type: draft.event_type,
            payload: definition.decode(draft.payload)?,
        })
    }

    async fn drain_reactions_locked(&self) -> Result<()> {
        let mut reaction_names: Vec<_> = self.inner.reactions.keys().cloned().collect();
        reaction_names.sort();

        for _pass in 0..MAX_REACTION_PASSES {
            let events = self.inner.event_log.load().await?;
            let mut commands = Vec::new();
            for name in &reaction_names {
                if let Some(command) = self.inner.reactions[name].evaluate(&events).await? {
                    commands.push(command);
                }
            }
            if commands.is_empty() {
                return Ok(());
            }
            for command in commands {
                self.run_command_locked(command).await?;
            }
        }

        Err(SpecterError::ReactionLoopLimit(MAX_REACTION_PASSES))
    }
}

fn collect_conformance(
    event_definitions: &[EventDefinition],
    commands: &[Arc<dyn DynCommandSlice>],
    queries: &[Arc<dyn DynQuerySlice>],
    reactions: &[Arc<dyn DynReactionSlice>],
) -> Result<HashMap<String, EventDefinition>> {
    let mut diagnostics = Vec::new();
    let mut definitions = HashMap::new();

    for definition in event_definitions {
        let event_type = definition.event_type();
        if definitions.contains_key(event_type) {
            diagnostics.push(
                ConformanceDiagnostic::new(
                    "duplicate-event-type",
                    "Register exactly one EventDefinition for each Event type.",
                )
                .for_event(event_type),
            );
            continue;
        }
        if !is_kebab_case(event_type) {
            diagnostics.push(
                ConformanceDiagnostic::new(
                    "event-type-format",
                    "Event types must use kebab-case (for example, \"todo-added\").",
                )
                .for_event(event_type),
            );
        }
        definitions.insert(event_type.to_owned(), definition.clone());
    }

    if commands.is_empty() {
        diagnostics.push(ConformanceDiagnostic::new(
            "missing-command-slice",
            "At least one completed Command Slice must be registered.",
        ));
    }

    let mut metadata = Vec::new();
    metadata.extend(commands.iter().map(|slice| slice.metadata()));
    metadata.extend(queries.iter().map(|slice| slice.metadata()));
    metadata.extend(reactions.iter().map(|slice| slice.metadata()));

    let mut names = HashSet::new();
    let mut covered_event_types = HashSet::new();
    for slice in &metadata {
        validate_slice_metadata(
            slice,
            &definitions,
            &mut names,
            &mut covered_event_types,
            &mut diagnostics,
        );
    }

    for command in commands {
        diagnostics.extend(command.validate_examples(&definitions));
    }
    for query in queries {
        diagnostics.extend(query.validate_examples(&definitions));
    }
    for reaction in reactions {
        diagnostics.extend(reaction.validate_examples(&definitions));
    }

    for event_type in definitions.keys() {
        if !covered_event_types.contains(event_type) {
            diagnostics.push(
                ConformanceDiagnostic::new(
                    "event-without-scenario",
                    "Every registered Event must appear in a Scenario Given or accepted Command outcome.",
                )
                .for_event(event_type),
            );
        }
    }

    if diagnostics.is_empty() {
        Ok(definitions)
    } else {
        Err(ConformanceErrors(diagnostics).into())
    }
}

fn validate_slice_metadata(
    slice: &SliceMetadata,
    definitions: &HashMap<String, EventDefinition>,
    names: &mut HashSet<String>,
    covered_event_types: &mut HashSet<String>,
    diagnostics: &mut Vec<ConformanceDiagnostic>,
) {
    if !names.insert(slice.name.clone()) {
        diagnostics.push(
            ConformanceDiagnostic::new(
                "duplicate-slice-name",
                "Select exactly one implementation for each Slice name.",
            )
            .for_slice(&slice.name),
        );
    }
    if slice.name.trim().is_empty() {
        diagnostics.push(ConformanceDiagnostic::new(
            "empty-slice-name",
            "Slice names must not be empty.",
        ));
    }
    if slice.description.trim().is_empty() {
        diagnostics.push(
            ConformanceDiagnostic::new(
                "empty-slice-description",
                "Slice descriptions must not be empty.",
            )
            .for_slice(&slice.name),
        );
    }
    if slice.scenarios.is_empty() {
        diagnostics.push(
            ConformanceDiagnostic::new(
                "missing-scenarios",
                "Every Slice must define at least one Scenario.",
            )
            .for_slice(&slice.name),
        );
        return;
    }

    let mut descriptions = HashSet::new();
    let mut given_event_types = HashSet::new();
    for scenario in &slice.scenarios {
        if scenario.description.trim().is_empty() {
            diagnostics.push(
                ConformanceDiagnostic::new(
                    "empty-scenario-description",
                    "Scenario descriptions must not be empty.",
                )
                .for_slice(&slice.name),
            );
        } else if !descriptions.insert(scenario.description.clone()) {
            diagnostics.push(
                ConformanceDiagnostic::new(
                    "duplicate-scenario-description",
                    "Scenario descriptions must be unique within a Slice.",
                )
                .for_slice(&slice.name)
                .for_scenario(&scenario.description),
            );
        }

        for event in &scenario.given {
            given_event_types.insert(event.event_type.clone());
            covered_event_types.insert(event.event_type.clone());
            validate_scenario_event(
                slice,
                scenario.description.as_str(),
                event,
                definitions,
                diagnostics,
            );
        }
        for event in &scenario.command_outcome {
            covered_event_types.insert(event.event_type.clone());
            validate_scenario_event(
                slice,
                scenario.description.as_str(),
                event,
                definitions,
                diagnostics,
            );
        }
    }

    let mut apply_event_types = HashSet::new();
    for event_type in &slice.apply_event_types {
        if !apply_event_types.insert((*event_type).to_owned()) {
            diagnostics.push(
                ConformanceDiagnostic::new(
                    "duplicate-apply-handler",
                    "A Slice may define only one apply handler per Event type.",
                )
                .for_slice(&slice.name)
                .for_event(*event_type),
            );
        }
        if !definitions.contains_key(*event_type) {
            diagnostics.push(
                ConformanceDiagnostic::new(
                    "unknown-apply-event",
                    "The apply handler's Event type is not registered by the app.",
                )
                .for_slice(&slice.name)
                .for_event(*event_type),
            );
        }
    }

    for event_type in given_event_types.difference(&apply_event_types) {
        diagnostics.push(
            ConformanceDiagnostic::new(
                "missing-apply-handler",
                "A Scenario Given Event has no matching apply handler.",
            )
            .for_slice(&slice.name)
            .for_event(event_type),
        );
    }
    for event_type in apply_event_types.difference(&given_event_types) {
        diagnostics.push(
            ConformanceDiagnostic::new(
                "extra-apply-handler",
                "An apply handler's Event never appears in the Slice's Given Scenarios.",
            )
            .for_slice(&slice.name)
            .for_event(event_type),
        );
    }
}

fn validate_scenario_event(
    slice: &SliceMetadata,
    scenario_description: &str,
    event: &crate::ScenarioEvent,
    definitions: &HashMap<String, EventDefinition>,
    diagnostics: &mut Vec<ConformanceDiagnostic>,
) {
    let Some(definition) = definitions.get(&event.event_type) else {
        diagnostics.push(
            ConformanceDiagnostic::new(
                "unknown-scenario-event",
                "The Scenario Event type is not registered by the app.",
            )
            .for_slice(&slice.name)
            .for_scenario(scenario_description)
            .for_event(&event.event_type),
        );
        return;
    };
    if let Err(error) = definition.decode(event.example_payload.clone()) {
        diagnostics.push(
            ConformanceDiagnostic::new("scenario-event-payload", error.to_string())
                .for_slice(&slice.name)
                .for_scenario(scenario_description)
                .for_event(&event.event_type),
        );
    }
}

fn is_kebab_case(value: &str) -> bool {
    !value.is_empty()
        && !value.starts_with('-')
        && !value.ends_with('-')
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        && !value.contains("--")
}

#[allow(dead_code)]
fn _assert_scenario_failure_send_sync(_: ScenarioFailure) {}
