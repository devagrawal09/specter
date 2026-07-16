use std::{
    collections::{HashMap, HashSet},
    future::Future,
    marker::PhantomData,
    pin::Pin,
    sync::Arc,
};

use async_trait::async_trait;
use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;
use tokio::sync::Mutex;

use crate::{
    CommandEnvelope, CommandSpec, ConformanceDiagnostic, DomainEvent, EventDefinition, EventDraft,
    PersistedEvent, QuerySpec, ReactionSpec, Result, ScenarioFailure, SpecterError,
    spec::{ScenarioMetadata, SliceMetadata},
};

type BoxFuture<T> = Pin<Box<dyn Future<Output = Result<T>> + Send + 'static>>;
type CommandHandler<I, S> = dyn Fn(I, S) -> BoxFuture<Vec<EventDraft>> + Send + Sync;
type QueryHandler<I, S> = dyn Fn(I, S) -> BoxFuture<Value> + Send + Sync;
type ReactionHandler<S> = dyn Fn(S) -> BoxFuture<Option<Value>> + Send + Sync;
type ReactionExecutor = dyn Fn(Value) -> BoxFuture<Option<CommandEnvelope>> + Send + Sync;
type ApplyFn<S> = dyn Fn(Value, &mut S) -> Result<()> + Send + Sync;

struct ApplyHandler<S> {
    event_type: &'static str,
    handle: Arc<ApplyFn<S>>,
}

impl<S> Clone for ApplyHandler<S> {
    fn clone(&self) -> Self {
        Self {
            event_type: self.event_type,
            handle: Arc::clone(&self.handle),
        }
    }
}

struct SliceData<S> {
    state: S,
    last_applied_order: u64,
}

pub struct CommandInputStep<I> {
    spec: CommandSpec,
    input: PhantomData<fn() -> I>,
}

pub struct CommandStateStep<I> {
    spec: CommandSpec,
    input: PhantomData<fn() -> I>,
}

pub struct CommandApplyStep<I, S> {
    spec: CommandSpec,
    initial_state: S,
    apply: Vec<ApplyHandler<S>>,
    input: PhantomData<fn() -> I>,
}

pub struct CommandSlice<I, S> {
    spec: CommandSpec,
    initial_state: S,
    data: Mutex<SliceData<S>>,
    apply: Vec<ApplyHandler<S>>,
    handle: Arc<CommandHandler<I, S>>,
}

impl CommandSpec {
    pub fn input<I>(self) -> CommandInputStep<I> {
        CommandInputStep {
            spec: self,
            input: PhantomData,
        }
    }
}

impl<I> CommandInputStep<I> {
    pub fn state(self) -> CommandStateStep<I> {
        CommandStateStep {
            spec: self.spec,
            input: PhantomData,
        }
    }
}

impl<I> CommandStateStep<I> {
    pub fn initialized<S>(self, initial_state: S) -> CommandApplyStep<I, S> {
        CommandApplyStep {
            spec: self.spec,
            initial_state,
            apply: Vec::new(),
            input: PhantomData,
        }
    }
}

impl<I, S: Clone> CommandApplyStep<I, S> {
    pub fn apply<E, F>(mut self, handle: F) -> Self
    where
        E: DomainEvent,
        F: Fn(&E, &mut S) -> Result<()> + Send + Sync + 'static,
    {
        self.apply.push(typed_apply::<E, S, F>(handle));
        self
    }

    pub fn handle<F, Fut>(self, handle: F) -> CommandSlice<I, S>
    where
        F: Fn(I, S) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Result<Vec<EventDraft>>> + Send + 'static,
    {
        CommandSlice {
            spec: self.spec,
            data: Mutex::new(SliceData {
                state: self.initial_state.clone(),
                last_applied_order: 0,
            }),
            initial_state: self.initial_state,
            apply: self.apply,
            handle: Arc::new(move |input, state| Box::pin(handle(input, state))),
        }
    }
}

pub struct QueryInputStep<I> {
    spec: QuerySpec,
    input: PhantomData<fn() -> I>,
}

pub struct QueryOutputStep<I, O> {
    spec: QuerySpec,
    types: PhantomData<fn() -> (I, O)>,
}

pub struct QueryStateStep<I, O> {
    spec: QuerySpec,
    types: PhantomData<fn() -> (I, O)>,
}

pub struct QueryApplyStep<I, O, S> {
    spec: QuerySpec,
    initial_state: S,
    apply: Vec<ApplyHandler<S>>,
    types: PhantomData<fn() -> (I, O)>,
}

pub struct QuerySlice<I, O, S> {
    spec: QuerySpec,
    initial_state: S,
    data: Mutex<SliceData<S>>,
    apply: Vec<ApplyHandler<S>>,
    handle: Arc<QueryHandler<I, S>>,
    output: PhantomData<fn() -> O>,
}

impl QuerySpec {
    pub fn input<I>(self) -> QueryInputStep<I> {
        QueryInputStep {
            spec: self,
            input: PhantomData,
        }
    }
}

impl<I> QueryInputStep<I> {
    pub fn output<O>(self) -> QueryOutputStep<I, O> {
        QueryOutputStep {
            spec: self.spec,
            types: PhantomData,
        }
    }
}

impl<I, O> QueryOutputStep<I, O> {
    pub fn state(self) -> QueryStateStep<I, O> {
        QueryStateStep {
            spec: self.spec,
            types: PhantomData,
        }
    }
}

impl<I, O> QueryStateStep<I, O> {
    pub fn initialized<S>(self, initial_state: S) -> QueryApplyStep<I, O, S> {
        QueryApplyStep {
            spec: self.spec,
            initial_state,
            apply: Vec::new(),
            types: PhantomData,
        }
    }
}

impl<I, O, S: Clone> QueryApplyStep<I, O, S> {
    pub fn apply<E, F>(mut self, handle: F) -> Self
    where
        E: DomainEvent,
        F: Fn(&E, &mut S) -> Result<()> + Send + Sync + 'static,
    {
        self.apply.push(typed_apply::<E, S, F>(handle));
        self
    }

    pub fn handle<F, Fut>(self, handle: F) -> QuerySlice<I, O, S>
    where
        F: Fn(I, S) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Result<O>> + Send + 'static,
        O: Serialize,
    {
        QuerySlice {
            spec: self.spec,
            data: Mutex::new(SliceData {
                state: self.initial_state.clone(),
                last_applied_order: 0,
            }),
            initial_state: self.initial_state,
            apply: self.apply,
            handle: Arc::new(move |input, state| {
                let result = handle(input, state);
                Box::pin(async move { Ok(serde_json::to_value(result.await?)?) })
            }),
            output: PhantomData,
        }
    }
}

pub struct ReactionOutputStep<O> {
    spec: ReactionSpec,
    output: PhantomData<fn() -> O>,
}

pub struct ReactionStateStep<O> {
    spec: ReactionSpec,
    executor: Arc<ReactionExecutor>,
    output: PhantomData<fn() -> O>,
}

pub struct ReactionApplyStep<O, S> {
    spec: ReactionSpec,
    executor: Arc<ReactionExecutor>,
    initial_state: S,
    apply: Vec<ApplyHandler<S>>,
    output: PhantomData<fn() -> O>,
}

pub struct ReactionSlice<O, S> {
    spec: ReactionSpec,
    initial_state: S,
    data: Mutex<SliceData<S>>,
    apply: Vec<ApplyHandler<S>>,
    handle: Arc<ReactionHandler<S>>,
    executor: Arc<ReactionExecutor>,
    output: PhantomData<fn() -> O>,
}

impl ReactionSpec {
    pub fn output<O>(self) -> ReactionOutputStep<O> {
        ReactionOutputStep {
            spec: self,
            output: PhantomData,
        }
    }
}

impl<O> ReactionOutputStep<O>
where
    O: Serialize + DeserializeOwned + Send + Sync + 'static,
{
    pub fn executor<F, Fut>(self, executor: F) -> ReactionStateStep<O>
    where
        F: Fn(O) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Result<Option<CommandEnvelope>>> + Send + 'static,
    {
        ReactionStateStep {
            spec: self.spec,
            executor: Arc::new(move |value| {
                let decoded = serde_json::from_value(value);
                match decoded {
                    Ok(output) => Box::pin(executor(output)),
                    Err(error) => {
                        Box::pin(async move { Err(SpecterError::Serialization(error.to_string())) })
                    }
                }
            }),
            output: PhantomData,
        }
    }
}

impl<O> ReactionStateStep<O> {
    pub fn state(self) -> ReactionStateInitializer<O> {
        ReactionStateInitializer {
            spec: self.spec,
            executor: self.executor,
            output: PhantomData,
        }
    }
}

pub struct ReactionStateInitializer<O> {
    spec: ReactionSpec,
    executor: Arc<ReactionExecutor>,
    output: PhantomData<fn() -> O>,
}

impl<O> ReactionStateInitializer<O> {
    pub fn initialized<S>(self, initial_state: S) -> ReactionApplyStep<O, S> {
        ReactionApplyStep {
            spec: self.spec,
            executor: self.executor,
            initial_state,
            apply: Vec::new(),
            output: PhantomData,
        }
    }
}

impl<O, S: Clone> ReactionApplyStep<O, S> {
    pub fn apply<E, F>(mut self, handle: F) -> Self
    where
        E: DomainEvent,
        F: Fn(&E, &mut S) -> Result<()> + Send + Sync + 'static,
    {
        self.apply.push(typed_apply::<E, S, F>(handle));
        self
    }

    pub fn handle<F, Fut>(self, handle: F) -> ReactionSlice<O, S>
    where
        F: Fn(S) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Result<Option<O>>> + Send + 'static,
        O: Serialize,
    {
        ReactionSlice {
            spec: self.spec,
            data: Mutex::new(SliceData {
                state: self.initial_state.clone(),
                last_applied_order: 0,
            }),
            initial_state: self.initial_state,
            apply: self.apply,
            handle: Arc::new(move |state| {
                let result = handle(state);
                Box::pin(async move {
                    result
                        .await?
                        .map(serde_json::to_value)
                        .transpose()
                        .map_err(Into::into)
                })
            }),
            executor: self.executor,
            output: PhantomData,
        }
    }
}

fn typed_apply<E, S, F>(handle: F) -> ApplyHandler<S>
where
    E: DomainEvent,
    F: Fn(&E, &mut S) -> Result<()> + Send + Sync + 'static,
{
    ApplyHandler {
        event_type: E::TYPE,
        handle: Arc::new(move |payload, state| {
            let event: E = serde_json::from_value(payload).map_err(|error| {
                SpecterError::Serialization(format!(
                    "invalid payload for {:?} while applying Event: {error}",
                    E::TYPE
                ))
            })?;
            handle(&event, state)
        }),
    }
}

fn apply_events<S>(
    state: &mut S,
    last_applied_order: u64,
    events: &[PersistedEvent],
    apply: &[ApplyHandler<S>],
) -> Result<u64> {
    let mut cursor = last_applied_order;
    for event in events
        .iter()
        .filter(|event| event.order > last_applied_order)
    {
        let Some(registration) = apply
            .iter()
            .find(|candidate| candidate.event_type == event.event_type)
        else {
            continue;
        };
        (registration.handle)(event.payload.clone(), state)?;
        cursor = event.order;
    }
    Ok(cursor)
}

fn scenario_events(given: &[crate::ScenarioEvent]) -> Vec<PersistedEvent> {
    given
        .iter()
        .enumerate()
        .map(|(index, event)| {
            PersistedEvent::scenario(
                index as u64 + 1,
                event.event_type.clone(),
                event.example_payload.clone(),
            )
        })
        .collect()
}

fn scenario_failure(
    slice_name: &str,
    scenario_description: &str,
    message: impl Into<String>,
) -> ScenarioFailure {
    ScenarioFailure {
        slice_name: slice_name.to_owned(),
        scenario_description: scenario_description.to_owned(),
        message: message.into(),
    }
}

fn invalid_example(
    code: &'static str,
    slice_name: &str,
    scenario_description: &str,
    message: impl Into<String>,
) -> ConformanceDiagnostic {
    ConformanceDiagnostic::new(code, message)
        .for_slice(slice_name)
        .for_scenario(scenario_description)
}

#[async_trait]
pub(crate) trait DynCommandSlice: Send + Sync {
    fn metadata(&self) -> SliceMetadata;
    fn allowed_event_types(&self) -> HashSet<String>;
    fn validate_examples(
        &self,
        event_definitions: &HashMap<String, EventDefinition>,
    ) -> Vec<ConformanceDiagnostic>;
    async fn execute(&self, input: Value, events: &[PersistedEvent]) -> Result<Vec<EventDraft>>;
    async fn scenario_failures(&self) -> Vec<ScenarioFailure>;
}

#[async_trait]
impl<I, S> DynCommandSlice for CommandSlice<I, S>
where
    I: DeserializeOwned + Send + Sync + 'static,
    S: Clone + Send + Sync + 'static,
{
    fn metadata(&self) -> SliceMetadata {
        SliceMetadata {
            name: self.spec.name.clone(),
            description: self.spec.description.clone(),
            scenarios: self
                .spec
                .scenarios
                .iter()
                .map(|scenario| ScenarioMetadata {
                    description: scenario.description.clone(),
                    given: scenario.given.clone(),
                    command_outcome: scenario.expect.clone(),
                })
                .collect(),
            apply_event_types: self.apply.iter().map(|apply| apply.event_type).collect(),
        }
    }

    fn allowed_event_types(&self) -> HashSet<String> {
        self.spec
            .scenarios
            .iter()
            .flat_map(|scenario| scenario.expect.iter())
            .map(|event| event.event_type.clone())
            .collect()
    }

    fn validate_examples(
        &self,
        _event_definitions: &HashMap<String, EventDefinition>,
    ) -> Vec<ConformanceDiagnostic> {
        self.spec
            .scenarios
            .iter()
            .filter_map(|scenario| {
                serde_json::from_value::<I>(scenario.when.clone())
                    .err()
                    .map(|error| {
                        invalid_example(
                            "command-input",
                            &self.spec.name,
                            &scenario.description,
                            error.to_string(),
                        )
                    })
            })
            .collect()
    }

    async fn execute(&self, input: Value, events: &[PersistedEvent]) -> Result<Vec<EventDraft>> {
        let input =
            serde_json::from_value::<I>(input).map_err(|error| SpecterError::InvalidInput {
                slice_name: self.spec.name.clone(),
                message: error.to_string(),
            })?;
        let state = {
            let mut data = self.data.lock().await;
            let mut working_state = data.state.clone();
            let cursor = apply_events(
                &mut working_state,
                data.last_applied_order,
                events,
                &self.apply,
            )?;
            data.state = working_state;
            data.last_applied_order = cursor;
            data.state.clone()
        };
        (self.handle)(input, state).await
    }

    async fn scenario_failures(&self) -> Vec<ScenarioFailure> {
        let mut failures = Vec::new();
        for scenario in &self.spec.scenarios {
            let input = match serde_json::from_value::<I>(scenario.when.clone()) {
                Ok(input) => input,
                Err(error) => {
                    failures.push(scenario_failure(
                        &self.spec.name,
                        &scenario.description,
                        format!("input did not decode: {error}"),
                    ));
                    continue;
                }
            };
            let mut state = self.initial_state.clone();
            if let Err(error) = apply_events(
                &mut state,
                0,
                &scenario_events(&scenario.given),
                &self.apply,
            ) {
                failures.push(scenario_failure(
                    &self.spec.name,
                    &scenario.description,
                    format!("Given Events failed to apply: {error}"),
                ));
                continue;
            }

            match (self.handle)(input, state).await {
                Ok(actual) if scenario.expect.is_empty() => failures.push(scenario_failure(
                    &self.spec.name,
                    &scenario.description,
                    format!(
                        "expected rejection, but handler returned {} Event(s)",
                        actual.len()
                    ),
                )),
                Ok(actual) => {
                    let actual: Vec<_> = actual
                        .into_iter()
                        .map(|event| (event.event_type, event.payload))
                        .collect();
                    let expected: Vec<_> = scenario
                        .expect
                        .iter()
                        .map(|event| (event.event_type.clone(), event.example_payload.clone()))
                        .collect();
                    if actual != expected {
                        failures.push(scenario_failure(
                            &self.spec.name,
                            &scenario.description,
                            format!("expected Events {expected:?}, got {actual:?}"),
                        ));
                    }
                }
                Err(error) if scenario.expect.is_empty() => {
                    if let Some(reason) = &scenario.reject_reason
                        && !error.to_string().contains(reason)
                    {
                        failures.push(scenario_failure(
                            &self.spec.name,
                            &scenario.description,
                            format!("expected rejection containing {reason:?}, got {error}"),
                        ));
                    }
                }
                Err(error) => failures.push(scenario_failure(
                    &self.spec.name,
                    &scenario.description,
                    format!("expected accepted Events, got error: {error}"),
                )),
            }
        }
        failures
    }
}

#[async_trait]
pub(crate) trait DynQuerySlice: Send + Sync {
    fn metadata(&self) -> SliceMetadata;
    fn validate_examples(
        &self,
        event_definitions: &HashMap<String, EventDefinition>,
    ) -> Vec<ConformanceDiagnostic>;
    async fn execute(&self, input: Value, events: &[PersistedEvent]) -> Result<Value>;
    async fn scenario_failures(&self) -> Vec<ScenarioFailure>;
}

#[async_trait]
impl<I, O, S> DynQuerySlice for QuerySlice<I, O, S>
where
    I: DeserializeOwned + Send + Sync + 'static,
    O: DeserializeOwned + Send + Sync + 'static,
    S: Clone + Send + Sync + 'static,
{
    fn metadata(&self) -> SliceMetadata {
        SliceMetadata {
            name: self.spec.name.clone(),
            description: self.spec.description.clone(),
            scenarios: self
                .spec
                .scenarios
                .iter()
                .map(|scenario| ScenarioMetadata {
                    description: scenario.description.clone(),
                    given: scenario.given.clone(),
                    command_outcome: Vec::new(),
                })
                .collect(),
            apply_event_types: self.apply.iter().map(|apply| apply.event_type).collect(),
        }
    }

    fn validate_examples(
        &self,
        _event_definitions: &HashMap<String, EventDefinition>,
    ) -> Vec<ConformanceDiagnostic> {
        let mut diagnostics = Vec::new();
        for scenario in &self.spec.scenarios {
            if let Err(error) = serde_json::from_value::<I>(scenario.when.clone()) {
                diagnostics.push(invalid_example(
                    "query-input",
                    &self.spec.name,
                    &scenario.description,
                    error.to_string(),
                ));
            }
            if let Err(error) = serde_json::from_value::<O>(scenario.expect.clone()) {
                diagnostics.push(invalid_example(
                    "query-output",
                    &self.spec.name,
                    &scenario.description,
                    error.to_string(),
                ));
            }
        }
        diagnostics
    }

    async fn execute(&self, input: Value, events: &[PersistedEvent]) -> Result<Value> {
        let input =
            serde_json::from_value::<I>(input).map_err(|error| SpecterError::InvalidInput {
                slice_name: self.spec.name.clone(),
                message: error.to_string(),
            })?;
        let state = {
            let mut data = self.data.lock().await;
            let mut working_state = data.state.clone();
            let cursor = apply_events(
                &mut working_state,
                data.last_applied_order,
                events,
                &self.apply,
            )?;
            data.state = working_state;
            data.last_applied_order = cursor;
            data.state.clone()
        };
        (self.handle)(input, state).await
    }

    async fn scenario_failures(&self) -> Vec<ScenarioFailure> {
        let mut failures = Vec::new();
        for scenario in &self.spec.scenarios {
            let input = match serde_json::from_value::<I>(scenario.when.clone()) {
                Ok(input) => input,
                Err(error) => {
                    failures.push(scenario_failure(
                        &self.spec.name,
                        &scenario.description,
                        format!("input did not decode: {error}"),
                    ));
                    continue;
                }
            };
            let mut state = self.initial_state.clone();
            if let Err(error) = apply_events(
                &mut state,
                0,
                &scenario_events(&scenario.given),
                &self.apply,
            ) {
                failures.push(scenario_failure(
                    &self.spec.name,
                    &scenario.description,
                    format!("Given Events failed to apply: {error}"),
                ));
                continue;
            }
            match (self.handle)(input, state).await {
                Ok(actual) if actual != scenario.expect => failures.push(scenario_failure(
                    &self.spec.name,
                    &scenario.description,
                    format!("expected {}, got {}", scenario.expect, actual),
                )),
                Ok(_) => {}
                Err(error) => failures.push(scenario_failure(
                    &self.spec.name,
                    &scenario.description,
                    format!("query failed: {error}"),
                )),
            }
        }
        failures
    }
}

#[async_trait]
pub(crate) trait DynReactionSlice: Send + Sync {
    fn metadata(&self) -> SliceMetadata;
    fn validate_examples(
        &self,
        event_definitions: &HashMap<String, EventDefinition>,
    ) -> Vec<ConformanceDiagnostic>;
    async fn evaluate(&self, events: &[PersistedEvent]) -> Result<Option<CommandEnvelope>>;
    async fn scenario_failures(&self) -> Vec<ScenarioFailure>;
}

#[async_trait]
impl<O, S> DynReactionSlice for ReactionSlice<O, S>
where
    O: DeserializeOwned + Send + Sync + 'static,
    S: Clone + Send + Sync + 'static,
{
    fn metadata(&self) -> SliceMetadata {
        SliceMetadata {
            name: self.spec.name.clone(),
            description: self.spec.description.clone(),
            scenarios: self
                .spec
                .scenarios
                .iter()
                .map(|scenario| ScenarioMetadata {
                    description: scenario.description.clone(),
                    given: scenario.given.clone(),
                    command_outcome: Vec::new(),
                })
                .collect(),
            apply_event_types: self.apply.iter().map(|apply| apply.event_type).collect(),
        }
    }

    fn validate_examples(
        &self,
        _event_definitions: &HashMap<String, EventDefinition>,
    ) -> Vec<ConformanceDiagnostic> {
        self.spec
            .scenarios
            .iter()
            .flat_map(|scenario| {
                scenario.expect.iter().filter_map(|effect| {
                    serde_json::from_value::<O>(effect.clone())
                        .err()
                        .map(|error| {
                            invalid_example(
                                "reaction-output",
                                &self.spec.name,
                                &scenario.description,
                                error.to_string(),
                            )
                        })
                })
            })
            .collect()
    }

    async fn evaluate(&self, events: &[PersistedEvent]) -> Result<Option<CommandEnvelope>> {
        let state = {
            let mut data = self.data.lock().await;
            let mut working_state = data.state.clone();
            let cursor = apply_events(
                &mut working_state,
                data.last_applied_order,
                events,
                &self.apply,
            )?;
            if cursor == data.last_applied_order {
                return Ok(None);
            }
            data.state = working_state;
            data.last_applied_order = cursor;
            data.state.clone()
        };
        match (self.handle)(state).await? {
            Some(output) => (self.executor)(output).await,
            None => Ok(None),
        }
    }

    async fn scenario_failures(&self) -> Vec<ScenarioFailure> {
        let mut failures = Vec::new();
        for scenario in &self.spec.scenarios {
            let mut state = self.initial_state.clone();
            if let Err(error) = apply_events(
                &mut state,
                0,
                &scenario_events(&scenario.given),
                &self.apply,
            ) {
                failures.push(scenario_failure(
                    &self.spec.name,
                    &scenario.description,
                    format!("Given Events failed to apply: {error}"),
                ));
                continue;
            }
            match (self.handle)(state).await {
                Ok(actual) => {
                    let actual: Vec<_> = actual.into_iter().collect();
                    if actual != scenario.expect {
                        failures.push(scenario_failure(
                            &self.spec.name,
                            &scenario.description,
                            format!("expected effects {:?}, got {:?}", scenario.expect, actual),
                        ));
                    }
                }
                Err(error) => failures.push(scenario_failure(
                    &self.spec.name,
                    &scenario.description,
                    format!("reaction failed: {error}"),
                )),
            }
        }
        failures
    }
}
