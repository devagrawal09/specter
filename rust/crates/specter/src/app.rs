use std::{
    collections::{HashMap, HashSet},
    panic::{AssertUnwindSafe, catch_unwind},
    sync::Arc,
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tokio::sync::{Mutex, oneshot, watch};

use crate::{
    CommandEnvelope, CommandRef, CommandSlice, ConformanceDiagnostic, ConformanceErrors,
    DomainEvent, EventDefinition, EventDraft, EventLog, EventLogAppendOptions,
    EventLogAppendResult, InMemoryEventLog, PersistedEvent, QueryEnvelope, QueryRef, QuerySlice,
    ReactionSlice, Result, ScenarioFailure, ScenarioFailures, SpecterError,
    slice::{CommandDispatch, DynCommandSlice, DynQuerySlice, DynReactionSlice},
    spec::SliceMetadata,
};

const MAX_REACTION_PASSES: usize = 1_024;
pub type SpecterObserver = dyn Fn(&SpecterObservation) + Send + Sync;

pub struct SpecterAppBuilder {
    events: Vec<EventDefinition>,
    event_log: Arc<dyn EventLog>,
    commands: Vec<Arc<dyn DynCommandSlice>>,
    queries: Vec<Arc<dyn DynQuerySlice>>,
    reactions: Vec<Arc<dyn DynReactionSlice>>,
    observer: Option<Arc<SpecterObserver>>,
}

impl Default for SpecterAppBuilder {
    fn default() -> Self {
        Self {
            events: Vec::new(),
            event_log: InMemoryEventLog::shared(),
            commands: Vec::new(),
            queries: Vec::new(),
            reactions: Vec::new(),
            observer: None,
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

    pub fn observe<F>(mut self, observer: F) -> Self
    where
        F: Fn(&SpecterObservation) + Send + Sync + 'static,
    {
        self.observer = Some(Arc::new(observer));
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

        let (subscription_version, _) = watch::channel(0_u64);
        Ok(SpecterApp {
            inner: Arc::new(AppInner {
                event_definitions,
                event_log: self.event_log,
                commands,
                queries,
                reactions,
                reaction_scheduler: Mutex::new(ReactionSchedulerState::default()),
                subscription_version,
                observer: self.observer,
                deliveries: Mutex::new(HashMap::new()),
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
    reaction_scheduler: Mutex<ReactionSchedulerState>,
    subscription_version: watch::Sender<u64>,
    observer: Option<Arc<SpecterObserver>>,
    deliveries: Mutex<HashMap<String, DeliveryState>>,
}

#[derive(Debug, Clone, Copy)]
struct DeliveryState {
    scheduled_at_unix_ms: u128,
    attempts: u32,
}

#[derive(Default)]
struct ReactionSchedulerState {
    running: bool,
    requested: bool,
    waiters: Vec<oneshot::Sender<Result<()>>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SpecterObservation {
    SliceCaughtUp {
        slice_name: String,
        from_order: u64,
        to_order: u64,
        event_count: usize,
    },
    CommandCommitted {
        command_type: String,
        version: u64,
        event_count: usize,
        duplicate: bool,
    },
    SubscriptionsInvalidated {
        version: u64,
    },
    ReactionRunStarted {
        reaction_name: String,
    },
    ReactionRunCompleted {
        reaction_name: String,
        duration_ms: u128,
    },
    ReactionRunFailed {
        reaction_name: String,
        duration_ms: u128,
        message: String,
    },
    ReactionPassCompleted {
        failure_count: usize,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReactionDeliveryContext {
    pub delivery_id: String,
    pub scheduled_at_unix_ms: u128,
    pub attempt_id: String,
    pub attempt_number: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CommandOptions {
    pub expected_version: Option<u64>,
    pub idempotency_key: Option<String>,
}

#[derive(Debug)]
pub struct ReactionTicket {
    receiver: oneshot::Receiver<Result<()>>,
}

impl ReactionTicket {
    pub async fn wait(self) -> Result<()> {
        self.receiver.await.map_err(|_| {
            SpecterError::Message("Reaction scheduler stopped before reporting completion".into())
        })?
    }
}

#[derive(Debug)]
pub struct CommandExecution {
    pub events: Vec<PersistedEvent>,
    pub version: u64,
    pub duplicate: bool,
    pub reactions: ReactionTicket,
}

pub struct QuerySubscription {
    app: SpecterApp,
    envelope: QueryEnvelope,
    changes: watch::Receiver<u64>,
    initial: bool,
}

impl QuerySubscription {
    pub async fn next(&mut self) -> Option<Result<Value>> {
        if self.initial {
            self.initial = false;
        } else if self.changes.changed().await.is_err() {
            return None;
        }
        Some(self.app.query(self.envelope.clone()).await)
    }

    pub async fn next_as<O: DeserializeOwned>(&mut self) -> Option<Result<O>> {
        match self.next().await? {
            Ok(value) => Some(serde_json::from_value(value).map_err(Into::into)),
            Err(error) => Some(Err(error)),
        }
    }
}

#[derive(Clone)]
pub struct SpecterApp {
    inner: Arc<AppInner>,
}

impl SpecterApp {
    pub async fn command(&self, envelope: CommandEnvelope) -> Result<CommandExecution> {
        self.command_with_options(envelope, CommandOptions::default())
            .await
    }

    pub async fn command_with_options(
        &self,
        envelope: CommandEnvelope,
        options: CommandOptions,
    ) -> Result<CommandExecution> {
        validate_command_options(&options)?;
        let command_type = envelope.r#type.clone();
        let fingerprint = options
            .idempotency_key
            .as_ref()
            .map(|_| fingerprint_command(&envelope))
            .transpose()?;
        let committed = self
            .run_command(envelope, options.clone(), fingerprint)
            .await?;

        self.observe(SpecterObservation::CommandCommitted {
            command_type,
            version: committed.commit.version,
            event_count: committed.commit.events.len(),
            duplicate: committed.duplicate,
        });
        if !committed.duplicate {
            let next = self.inner.subscription_version.borrow().wrapping_add(1);
            let _ = self.inner.subscription_version.send(next);
            self.observe(SpecterObservation::SubscriptionsInvalidated { version: next });
        }

        let events = committed.commit.events.clone();
        let version = committed.commit.version;
        let duplicate = committed.duplicate;
        let reactions = self.request_reactions().await;

        Ok(CommandExecution {
            events,
            version,
            duplicate,
            reactions,
        })
    }

    pub async fn command_typed(
        &self,
        command_type: impl Into<String>,
        payload: impl Serialize,
    ) -> Result<CommandExecution> {
        self.command(CommandEnvelope::new(command_type, payload)?)
            .await
    }

    pub async fn execute<I: Serialize>(
        &self,
        command: CommandRef<I>,
        payload: I,
        options: CommandOptions,
    ) -> Result<CommandExecution> {
        self.command_with_options(CommandEnvelope::new(command.name(), payload)?, options)
            .await
    }

    pub async fn query(&self, envelope: QueryEnvelope) -> Result<Value> {
        let query = self
            .inner
            .queries
            .get(&envelope.r#type)
            .ok_or_else(|| SpecterError::UnknownQuery(envelope.r#type.clone()))?;
        let mut transaction = self.inner.event_log.transaction().await?;
        let event_types = query.applied_event_types();
        let cursor = query.last_applied_order().await;
        let events = transaction.query(cursor, &event_types).await?;
        drop(transaction);
        self.validate_persisted_events(cursor, &events)?;
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

    pub async fn read<I: Serialize, O: DeserializeOwned>(
        &self,
        query: QueryRef<I, O>,
        payload: I,
    ) -> Result<O> {
        self.query_as(QueryEnvelope::new(query.name(), payload)?)
            .await
    }

    pub fn subscribe_to<I: Serialize, O>(
        &self,
        query: QueryRef<I, O>,
        payload: I,
    ) -> Result<QuerySubscription> {
        self.subscribe(QueryEnvelope::new(query.name(), payload)?)
    }

    pub async fn events(&self) -> Result<Vec<PersistedEvent>> {
        let mut transaction = self.inner.event_log.transaction().await?;
        let mut event_types: Vec<_> = self.inner.event_definitions.keys().cloned().collect();
        event_types.sort();
        let events = transaction.query(0, &event_types).await?;
        self.validate_persisted_events(0, &events)?;
        Ok(events)
    }

    pub fn subscribe(&self, envelope: QueryEnvelope) -> Result<QuerySubscription> {
        if !self.inner.queries.contains_key(&envelope.r#type) {
            return Err(SpecterError::UnknownQuery(envelope.r#type));
        }
        Ok(QuerySubscription {
            app: self.clone(),
            envelope,
            changes: self.inner.subscription_version.subscribe(),
            initial: true,
        })
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

    async fn run_command(
        &self,
        envelope: CommandEnvelope,
        options: CommandOptions,
        fingerprint: Option<String>,
    ) -> Result<EventLogAppendResult> {
        let command = self
            .inner
            .commands
            .get(&envelope.r#type)
            .ok_or_else(|| SpecterError::UnknownCommand(envelope.r#type.clone()))?;
        let mut transaction = self.inner.event_log.transaction().await?;

        if let Some(key) = options.idempotency_key.as_deref()
            && let Some(previous) = transaction.find_commit(key).await?
        {
            if previous.fingerprint != fingerprint {
                return Err(SpecterError::IdempotencyConflict {
                    idempotency_key: key.to_owned(),
                });
            }
            return Ok(EventLogAppendResult {
                commit: previous,
                duplicate: true,
            });
        }

        let version = transaction.current_version().await?;
        if let Some(expected_version) = options.expected_version
            && expected_version != version
        {
            return Err(SpecterError::VersionConflict {
                expected_version,
                actual_version: version,
            });
        }

        let event_types = command.applied_event_types();
        let cursor = command.last_applied_order().await;
        let events = transaction.query(cursor, &event_types).await?;
        self.validate_persisted_events(cursor, &events)?;
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

        transaction
            .append(
                decoded,
                EventLogAppendOptions {
                    expected_version: Some(version),
                    idempotency_key: options.idempotency_key,
                    fingerprint,
                },
            )
            .await
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

    fn validate_persisted_events(&self, after_order: u64, events: &[PersistedEvent]) -> Result<()> {
        let orders: Vec<_> = events.iter().map(|event| event.order).collect();
        if orders
            .iter()
            .try_fold(after_order, |previous, order| {
                (*order > previous).then_some(*order)
            })
            .is_none()
        {
            return Err(SpecterError::EventLogOrderViolation {
                after_order,
                received_orders: orders,
            });
        }
        for event in events {
            let definition = self
                .inner
                .event_definitions
                .get(&event.event_type)
                .ok_or_else(|| SpecterError::UnknownEvent(event.event_type.clone()))?;
            definition.decode(event.payload.clone())?;
        }
        Ok(())
    }

    async fn drain_reactions(&self) -> Result<()> {
        let mut reaction_names: Vec<_> = self.inner.reactions.keys().cloned().collect();
        reaction_names.sort();

        for _pass in 0..MAX_REACTION_PASSES {
            let mut advanced = false;
            let mut failures = Vec::new();
            for name in &reaction_names {
                let started = Instant::now();
                let outcome: Result<(bool, bool)> = async {
                    let reaction = &self.inner.reactions[name];
                    let mut transaction = self.inner.event_log.transaction().await?;
                    let cursor = reaction.last_applied_order().await;
                    let events = transaction
                        .query(cursor, &reaction.applied_event_types())
                        .await?;
                    drop(transaction);
                    self.validate_persisted_events(cursor, &events)?;
                    if events.is_empty() {
                        return Ok((false, false));
                    }
                    self.observe(SpecterObservation::ReactionRunStarted {
                        reaction_name: name.clone(),
                    });
                    let through_order = events.last().map_or(cursor, |event| event.order);
                    let context = self.delivery_context(name, through_order).await;
                    let app = self.clone();
                    let dispatch: CommandDispatch = Arc::new(move |command, key| {
                        let app = app.clone();
                        Box::pin(async move { app.dispatch_reaction_command(command, key).await })
                    });
                    let advanced = reaction.evaluate(&events, context, dispatch).await?;
                    Ok((advanced, true))
                }
                .await;

                match outcome {
                    Ok((did_advance, did_run)) => {
                        advanced |= did_advance;
                        if did_run {
                            self.observe(SpecterObservation::ReactionRunCompleted {
                                reaction_name: name.clone(),
                                duration_ms: started.elapsed().as_millis(),
                            });
                        }
                    }
                    Err(error) => {
                        self.observe(SpecterObservation::ReactionRunFailed {
                            reaction_name: name.clone(),
                            duration_ms: started.elapsed().as_millis(),
                            message: error.to_string(),
                        });
                        failures.push(name.clone());
                    }
                }
            }
            self.observe(SpecterObservation::ReactionPassCompleted {
                failure_count: failures.len(),
            });
            if !failures.is_empty() {
                return Err(SpecterError::ReactionRunFailed {
                    slice_names: failures,
                });
            }
            if !advanced {
                return Ok(());
            }
        }

        Err(SpecterError::ReactionLoopLimit(MAX_REACTION_PASSES))
    }

    async fn request_reactions(&self) -> ReactionTicket {
        let (sender, receiver) = oneshot::channel();
        let should_start = {
            let mut scheduler = self.inner.reaction_scheduler.lock().await;
            scheduler.waiters.push(sender);
            scheduler.requested = true;
            if scheduler.running {
                false
            } else {
                scheduler.running = true;
                true
            }
        };

        if should_start {
            let app = self.clone();
            tokio::spawn(async move {
                app.run_reaction_scheduler().await;
            });
        }

        ReactionTicket { receiver }
    }

    async fn run_reaction_scheduler(&self) {
        loop {
            {
                let mut scheduler = self.inner.reaction_scheduler.lock().await;
                scheduler.requested = false;
            }

            let outcome = self.drain_reactions().await;
            let waiters = {
                let mut scheduler = self.inner.reaction_scheduler.lock().await;
                if outcome.is_ok() && scheduler.requested {
                    None
                } else {
                    scheduler.running = false;
                    scheduler.requested = false;
                    Some(std::mem::take(&mut scheduler.waiters))
                }
            };

            let Some(waiters) = waiters else {
                continue;
            };
            for waiter in waiters {
                let _ = waiter.send(outcome.clone());
            }
            return;
        }
    }

    fn observe(&self, observation: SpecterObservation) {
        if let Some(observer) = &self.inner.observer {
            let _ = catch_unwind(AssertUnwindSafe(|| observer(&observation)));
        }
    }

    async fn delivery_context(
        &self,
        reaction_name: &str,
        through_order: u64,
    ) -> ReactionDeliveryContext {
        let delivery_id = fingerprint_text(&format!("{reaction_name}:{through_order}"));
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |duration| duration.as_millis());
        let mut deliveries = self.inner.deliveries.lock().await;
        let state = deliveries
            .entry(delivery_id.clone())
            .or_insert(DeliveryState {
                scheduled_at_unix_ms: now,
                attempts: 0,
            });
        state.attempts += 1;
        ReactionDeliveryContext {
            delivery_id: delivery_id.clone(),
            scheduled_at_unix_ms: state.scheduled_at_unix_ms,
            attempt_id: fingerprint_text(&format!("{delivery_id}:{}:{now}", state.attempts)),
            attempt_number: state.attempts,
        }
    }

    async fn dispatch_reaction_command(
        &self,
        command: CommandEnvelope,
        idempotency_key: String,
    ) -> Result<()> {
        let command_type = command.r#type.clone();
        let fingerprint = fingerprint_command(&command)?;
        let committed = self
            .run_command(
                command,
                CommandOptions {
                    expected_version: None,
                    idempotency_key: Some(idempotency_key),
                },
                Some(fingerprint),
            )
            .await?;
        self.observe(SpecterObservation::CommandCommitted {
            command_type,
            version: committed.commit.version,
            event_count: committed.commit.events.len(),
            duplicate: committed.duplicate,
        });
        if !committed.duplicate {
            let next = self.inner.subscription_version.borrow().wrapping_add(1);
            let _ = self.inner.subscription_version.send(next);
            self.observe(SpecterObservation::SubscriptionsInvalidated { version: next });
        }
        Ok(())
    }
}

fn validate_command_options(options: &CommandOptions) -> Result<()> {
    if let Some(key) = options.idempotency_key.as_deref()
        && key.trim().is_empty()
    {
        return Err(SpecterError::InvalidCommandOptions(
            "idempotency_key must not be empty".into(),
        ));
    }
    Ok(())
}

fn fingerprint_command(envelope: &CommandEnvelope) -> Result<String> {
    Ok(fingerprint_text(&serde_json::to_string(envelope)?))
}

fn fingerprint_text(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
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
    } else if !is_lower_camel_case(&slice.name) {
        diagnostics.push(
            ConformanceDiagnostic::new(
                "slice-name-format",
                "Slice names must use lower camel case (for example, \"addTodo\").",
            )
            .for_slice(&slice.name),
        );
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
    for (event_type, rust_type) in slice
        .apply_event_types
        .iter()
        .zip(slice.apply_event_rust_types.iter())
    {
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
        } else if definitions[*event_type].rust_type() != *rust_type {
            diagnostics.push(
                ConformanceDiagnostic::new(
                    "apply-event-definition-identity",
                    "The apply handler must use the exact Rust Event type registered for this wire Event type.",
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

fn is_lower_camel_case(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .next()
            .is_some_and(|byte| byte.is_ascii_lowercase())
        && value.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

#[allow(dead_code)]
fn _assert_scenario_failure_send_sync(_: ScenarioFailure) {}
