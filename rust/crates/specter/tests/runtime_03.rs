use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use specter::{
    CommandOptions, CommandRef, CommandScenario, DomainEvent, EventDraft, EventLog,
    EventLogAppendOptions, EventLogAppendResult, EventLogCommit, EventLogTransaction,
    PersistedEvent, QueryRef, QueryScenario, ReactionDeliveryContext, ReactionScenario, Result,
    SpecterApp, SpecterAppBuilder, SpecterError, command, event, query, reaction,
};
use tokio::sync::Notify;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct ItemAdded {
    item_id: String,
}

impl DomainEvent for ItemAdded {
    const TYPE: &'static str = "item-added";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AddItem {
    item_id: String,
}

const ADD_ITEM: CommandRef<AddItem> = CommandRef::new("addItem");

#[derive(Debug, Clone, Serialize, Deserialize)]
struct GetCount;

const GET_COUNT: QueryRef<GetCount, usize> = QueryRef::new("getCount");

#[derive(Debug, Clone, Default)]
struct CountState {
    count: usize,
}

fn add_item() -> specter::CommandSlice<AddItem, CountState> {
    command("addItem")
        .description("Adds one item.")
        .scenarios(vec![CommandScenario::accepted(
            "adds a new item",
            vec![],
            serde_json::json!({ "item_id": "item-1" }),
            vec![event(
                "item-added",
                serde_json::json!({ "item_id": "item-1" }),
            )],
        )])
        .input::<AddItem>()
        .state()
        .initialized(CountState::default())
        .handle(|input, _state| async move {
            Ok(vec![EventDraft::new(ItemAdded {
                item_id: input.item_id,
            })?])
        })
}

fn get_count() -> specter::QuerySlice<GetCount, usize, CountState> {
    query("getCount")
        .description("Returns the number of items.")
        .scenarios(vec![QueryScenario::new(
            "counts added items",
            vec![event(
                "item-added",
                serde_json::json!({ "item_id": "item-1" }),
            )],
            GetCount,
            1,
        )])
        .input::<GetCount>()
        .output::<usize>()
        .state()
        .initialized(CountState::default())
        .apply::<ItemAdded, _>(|_event, state| {
            state.count += 1;
            Ok(())
        })
        .handle(|_input, state| async move { Ok(state.count) })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct NotifyItem {
    count: usize,
}

fn notify_items(
    attempts: Arc<Mutex<Vec<ReactionDeliveryContext>>>,
    fail: bool,
) -> specter::ReactionSlice<NotifyItem, CountState> {
    reaction("notifyItems")
        .description("Notifies after an item is added.")
        .scenarios(vec![ReactionScenario::new(
            "notifies for one item",
            vec![event(
                "item-added",
                serde_json::json!({ "item_id": "item-1" }),
            )],
            ReactionScenario::effects([NotifyItem { count: 1 }]),
        )])
        .output::<NotifyItem>()
        .executor(move |_effect, context| {
            let attempts = Arc::clone(&attempts);
            async move {
                attempts.lock().expect("attempt log poisoned").push(context);
                if fail {
                    Err(SpecterError::Message("notification unavailable".into()))
                } else {
                    Ok(None)
                }
            }
        })
        .state()
        .initialized(CountState::default())
        .apply::<ItemAdded, _>(|_event, state| {
            state.count += 1;
            Ok(())
        })
        .handle(|state| async move { Ok(Some(NotifyItem { count: state.count })) })
}

fn gated_failing_notification(
    started: Arc<Notify>,
    release: Arc<Notify>,
) -> specter::ReactionSlice<NotifyItem, CountState> {
    reaction("notifyItems")
        .description("Notifies after an item is added.")
        .scenarios(vec![ReactionScenario::new(
            "notifies for one item",
            vec![event(
                "item-added",
                serde_json::json!({ "item_id": "item-1" }),
            )],
            ReactionScenario::effects([NotifyItem { count: 1 }]),
        )])
        .output::<NotifyItem>()
        .executor(move |_effect, _context| {
            let started = Arc::clone(&started);
            let release = Arc::clone(&release);
            async move {
                started.notify_one();
                release.notified().await;
                Err(SpecterError::Message("notification unavailable".into()))
            }
        })
        .state()
        .initialized(CountState::default())
        .apply::<ItemAdded, _>(|_event, state| {
            state.count += 1;
            Ok(())
        })
        .handle(|state| async move { Ok(Some(NotifyItem { count: state.count })) })
}

async fn app() -> Result<SpecterApp> {
    SpecterAppBuilder::new()
        .event::<ItemAdded>()
        .command(add_item())
        .query(get_count())
        .build()
        .await
}

#[tokio::test]
async fn idempotency_and_expected_version_produce_durable_receipts() -> Result<()> {
    let app = app().await?;
    let first = app
        .execute(
            ADD_ITEM,
            AddItem {
                item_id: "item-1".into(),
            },
            CommandOptions {
                expected_version: Some(0),
                idempotency_key: Some("request-1".into()),
            },
        )
        .await?;
    assert_eq!(first.version, 1);
    assert!(!first.duplicate);
    first.reactions.wait().await?;

    let duplicate = app
        .execute(
            ADD_ITEM,
            AddItem {
                item_id: "item-1".into(),
            },
            CommandOptions {
                expected_version: Some(0),
                idempotency_key: Some("request-1".into()),
            },
        )
        .await?;
    assert!(duplicate.duplicate);
    assert_eq!(duplicate.version, 1);
    assert_eq!(duplicate.events, first.events);
    duplicate.reactions.wait().await?;

    let conflict = app
        .execute(
            ADD_ITEM,
            AddItem {
                item_id: "item-2".into(),
            },
            CommandOptions {
                expected_version: None,
                idempotency_key: Some("request-1".into()),
            },
        )
        .await
        .expect_err("a reused key with another payload must conflict");
    assert!(matches!(conflict, SpecterError::IdempotencyConflict { .. }));

    let stale = app
        .execute(
            ADD_ITEM,
            AddItem {
                item_id: "item-3".into(),
            },
            CommandOptions {
                expected_version: Some(0),
                idempotency_key: None,
            },
        )
        .await
        .expect_err("a stale expected version must conflict");
    assert!(matches!(stale, SpecterError::VersionConflict { .. }));
    Ok(())
}

#[tokio::test]
async fn subscriptions_emit_initial_and_latest_committed_state() -> Result<()> {
    let app = app().await?;
    let mut subscription = app.subscribe_to(GET_COUNT, GetCount)?;
    assert_eq!(subscription.next_as::<usize>().await.unwrap()?, 0);

    let execution = app
        .execute(
            ADD_ITEM,
            AddItem {
                item_id: "item-1".into(),
            },
            CommandOptions::default(),
        )
        .await?;
    assert_eq!(subscription.next_as::<usize>().await.unwrap()?, 1);
    execution.reactions.wait().await?;
    Ok(())
}

#[tokio::test]
async fn committed_commands_are_not_rejected_by_reaction_failure() -> Result<()> {
    let attempts = Arc::new(Mutex::new(Vec::new()));
    let app = SpecterAppBuilder::new()
        .event::<ItemAdded>()
        .command(add_item())
        .reaction(notify_items(Arc::clone(&attempts), true))
        .build()
        .await?;

    let execution = app
        .execute(
            ADD_ITEM,
            AddItem {
                item_id: "item-1".into(),
            },
            CommandOptions {
                expected_version: None,
                idempotency_key: Some("request-1".into()),
            },
        )
        .await?;
    assert_eq!(execution.events.len(), 1);
    assert!(matches!(
        execution.reactions.wait().await,
        Err(SpecterError::ReactionRunFailed { .. })
    ));
    assert_eq!(app.events().await?.len(), 1);

    let duplicate = app
        .execute(
            ADD_ITEM,
            AddItem {
                item_id: "item-1".into(),
            },
            CommandOptions {
                expected_version: None,
                idempotency_key: Some("request-1".into()),
            },
        )
        .await?;
    assert!(duplicate.duplicate);
    assert!(duplicate.reactions.wait().await.is_err());

    let attempts = attempts.lock().expect("attempt log poisoned");
    assert_eq!(attempts.len(), 2);
    assert_eq!(attempts[0].delivery_id, attempts[1].delivery_id);
    assert_eq!(
        attempts[0].scheduled_at_unix_ms,
        attempts[1].scheduled_at_unix_ms
    );
    assert_ne!(attempts[0].attempt_id, attempts[1].attempt_id);
    assert_eq!(attempts[1].attempt_number, 2);
    Ok(())
}

#[tokio::test]
async fn concurrent_requests_share_one_reaction_idle_outcome() -> Result<()> {
    let started = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());
    let app = SpecterAppBuilder::new()
        .event::<ItemAdded>()
        .command(add_item())
        .reaction(gated_failing_notification(
            Arc::clone(&started),
            Arc::clone(&release),
        ))
        .build()
        .await?;

    let first = app
        .execute(
            ADD_ITEM,
            AddItem {
                item_id: "item-1".into(),
            },
            CommandOptions::default(),
        )
        .await?;
    started.notified().await;

    let second = app
        .execute(
            ADD_ITEM,
            AddItem {
                item_id: "item-2".into(),
            },
            CommandOptions::default(),
        )
        .await?;
    release.notify_one();

    let (first_outcome, second_outcome) =
        tokio::join!(first.reactions.wait(), second.reactions.wait());
    assert!(matches!(
        first_outcome,
        Err(SpecterError::ReactionRunFailed { .. })
    ));
    assert!(matches!(
        second_outcome,
        Err(SpecterError::ReactionRunFailed { .. })
    ));
    Ok(())
}

struct DescendingEventLog;

struct DescendingTransaction;

#[async_trait]
impl EventLog for DescendingEventLog {
    async fn transaction(&self) -> Result<Box<dyn EventLogTransaction>> {
        Ok(Box::new(DescendingTransaction))
    }
}

#[async_trait]
impl EventLogTransaction for DescendingTransaction {
    async fn query(
        &mut self,
        _after_order: u64,
        _event_types: &[String],
    ) -> Result<Vec<PersistedEvent>> {
        Ok(vec![persisted(2), persisted(1)])
    }

    async fn current_version(&mut self) -> Result<u64> {
        Ok(2)
    }

    async fn find_commit(&mut self, _idempotency_key: &str) -> Result<Option<EventLogCommit>> {
        Ok(None)
    }

    async fn append(
        &mut self,
        _events: Vec<EventDraft>,
        _options: EventLogAppendOptions,
    ) -> Result<EventLogAppendResult> {
        unreachable!("the ordering test only performs a Query")
    }
}

fn persisted(order: u64) -> PersistedEvent {
    PersistedEvent {
        id: format!("event-{order}"),
        order,
        recorded_at_unix_ms: 0,
        event_type: "item-added".into(),
        payload: serde_json::json!({ "item_id": format!("item-{order}") }),
    }
}

#[tokio::test]
async fn adapter_order_violations_are_rejected_before_projection_apply() -> Result<()> {
    let app = SpecterAppBuilder::new()
        .event::<ItemAdded>()
        .event_log(Arc::new(DescendingEventLog))
        .command(add_item())
        .query(get_count())
        .build()
        .await?;
    let error = app
        .read(GET_COUNT, GetCount)
        .await
        .expect_err("descending durable order must be rejected");
    assert!(matches!(error, SpecterError::EventLogOrderViolation { .. }));
    Ok(())
}
