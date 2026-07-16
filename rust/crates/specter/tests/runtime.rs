use std::collections::{BTreeMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::json;
use specter::{
    CommandEnvelope, CommandScenario, CommandSlice, DomainEvent, EventDraft, QueryEnvelope,
    QueryScenario, QuerySlice, ReactionScenario, ReactionSlice, Result, SpecterApp,
    SpecterAppBuilder, SpecterError, command, event, query, reaction,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TodoAdded {
    todo_id: String,
    title: String,
}

impl DomainEvent for TodoAdded {
    const TYPE: &'static str = "todo-added";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TodoCompleted {
    todo_id: String,
}

impl DomainEvent for TodoCompleted {
    const TYPE: &'static str = "todo-completed";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CelebrationRecorded {
    completed_count: usize,
}

impl DomainEvent for CelebrationRecorded {
    const TYPE: &'static str = "celebration-recorded";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AddTodo {
    todo_id: String,
    title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CompleteTodo {
    todo_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RecordCelebration {
    completed_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ListTodos;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct TodoView {
    id: String,
    title: String,
    completed: bool,
}

#[derive(Debug, Clone, Default)]
struct TodoProjection {
    todos: BTreeMap<String, TodoView>,
}

#[derive(Debug, Clone, Default)]
struct CompletionState {
    known: HashSet<String>,
    completed: HashSet<String>,
}

#[derive(Debug, Clone, Default)]
struct CelebrationState {
    completed: HashSet<String>,
    recorded_counts: HashSet<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct Celebrate {
    completed_count: usize,
}

fn add_todo_slice() -> CommandSlice<AddTodo, ()> {
    command("add-todo")
        .description("Adds a todo using the caller-provided domain ID.")
        .scenarios(vec![CommandScenario::accepted(
            "Creates a todo.",
            vec![],
            AddTodo {
                todo_id: "todo-1".into(),
                title: "Ship it".into(),
            },
            vec![event(
                "todo-added",
                TodoAdded {
                    todo_id: "todo-1".into(),
                    title: "Ship it".into(),
                },
            )],
        )])
        .input::<AddTodo>()
        .state()
        .initialized(())
        .handle(|command, ()| async move {
            let title = command.title.trim().to_owned();
            if title.is_empty() {
                return Err(SpecterError::rejected("Todo title is required"));
            }
            Ok(vec![EventDraft::new(TodoAdded {
                todo_id: command.todo_id,
                title,
            })?])
        })
}

fn complete_todo_slice() -> CommandSlice<CompleteTodo, CompletionState> {
    command("complete-todo")
        .description("Completes an existing active todo.")
        .scenarios(vec![
            CommandScenario::accepted(
                "Completes an existing todo.",
                vec![event(
                    "todo-added",
                    TodoAdded {
                        todo_id: "todo-1".into(),
                        title: "Ship it".into(),
                    },
                )],
                CompleteTodo {
                    todo_id: "todo-1".into(),
                },
                vec![event(
                    "todo-completed",
                    TodoCompleted {
                        todo_id: "todo-1".into(),
                    },
                )],
            ),
            CommandScenario::rejected(
                "Rejects a missing todo.",
                vec![],
                CompleteTodo {
                    todo_id: "missing".into(),
                },
                "Todo not found",
            ),
            CommandScenario::rejected(
                "Rejects completing a todo twice.",
                vec![
                    event(
                        "todo-added",
                        TodoAdded {
                            todo_id: "todo-1".into(),
                            title: "Ship it".into(),
                        },
                    ),
                    event(
                        "todo-completed",
                        TodoCompleted {
                            todo_id: "todo-1".into(),
                        },
                    ),
                ],
                CompleteTodo {
                    todo_id: "todo-1".into(),
                },
                "Todo already completed",
            ),
        ])
        .input::<CompleteTodo>()
        .state()
        .initialized(CompletionState::default())
        .apply::<TodoAdded, _>(|event, state| {
            state.known.insert(event.todo_id.clone());
            Ok(())
        })
        .apply::<TodoCompleted, _>(|event, state| {
            state.completed.insert(event.todo_id.clone());
            Ok(())
        })
        .handle(|command, state| async move {
            if !state.known.contains(&command.todo_id) {
                return Err(SpecterError::rejected("Todo not found"));
            }
            if state.completed.contains(&command.todo_id) {
                return Err(SpecterError::rejected("Todo already completed"));
            }
            Ok(vec![EventDraft::new(TodoCompleted {
                todo_id: command.todo_id,
            })?])
        })
}

fn record_celebration_slice() -> CommandSlice<RecordCelebration, ()> {
    command("record-celebration")
        .description("Records a completion milestone selected by a Reaction Slice.")
        .scenarios(vec![CommandScenario::accepted(
            "Records the two-completion milestone.",
            vec![],
            RecordCelebration { completed_count: 2 },
            vec![event(
                "celebration-recorded",
                CelebrationRecorded { completed_count: 2 },
            )],
        )])
        .input::<RecordCelebration>()
        .state()
        .initialized(())
        .handle(|command, ()| async move {
            Ok(vec![EventDraft::new(CelebrationRecorded {
                completed_count: command.completed_count,
            })?])
        })
}

fn todos_query_slice() -> QuerySlice<ListTodos, Vec<TodoView>, TodoProjection> {
    query("list-todos")
        .description("Lists todos from an event-derived private projection.")
        .scenarios(vec![QueryScenario::new(
            "Lists completed and active todos.",
            vec![
                event(
                    "todo-added",
                    TodoAdded {
                        todo_id: "todo-1".into(),
                        title: "Ship it".into(),
                    },
                ),
                event(
                    "todo-added",
                    TodoAdded {
                        todo_id: "todo-2".into(),
                        title: "Review it".into(),
                    },
                ),
                event(
                    "todo-completed",
                    TodoCompleted {
                        todo_id: "todo-1".into(),
                    },
                ),
            ],
            ListTodos,
            vec![
                TodoView {
                    id: "todo-1".into(),
                    title: "Ship it".into(),
                    completed: true,
                },
                TodoView {
                    id: "todo-2".into(),
                    title: "Review it".into(),
                    completed: false,
                },
            ],
        )])
        .input::<ListTodos>()
        .output::<Vec<TodoView>>()
        .state()
        .initialized(TodoProjection::default())
        .apply::<TodoAdded, _>(|event, state| {
            state.todos.insert(
                event.todo_id.clone(),
                TodoView {
                    id: event.todo_id.clone(),
                    title: event.title.clone(),
                    completed: false,
                },
            );
            Ok(())
        })
        .apply::<TodoCompleted, _>(|event, state| {
            if let Some(todo) = state.todos.get_mut(&event.todo_id) {
                todo.completed = true;
            }
            Ok(())
        })
        .handle(|ListTodos, state| async move { Ok(state.todos.into_values().collect()) })
}

fn celebration_reaction_slice() -> ReactionSlice<Celebrate, CelebrationState> {
    reaction("celebrate-completions")
        .description("Requests a command when two todos have been completed.")
        .scenarios(vec![
            ReactionScenario::new(
                "Does nothing before the milestone.",
                vec![event(
                    "todo-completed",
                    TodoCompleted {
                        todo_id: "todo-1".into(),
                    },
                )],
                vec![],
            ),
            ReactionScenario::new(
                "Requests the milestone command.",
                vec![
                    event(
                        "todo-completed",
                        TodoCompleted {
                            todo_id: "todo-1".into(),
                        },
                    ),
                    event(
                        "todo-completed",
                        TodoCompleted {
                            todo_id: "todo-2".into(),
                        },
                    ),
                ],
                ReactionScenario::effects([Celebrate { completed_count: 2 }]),
            ),
            ReactionScenario::new(
                "Does not repeat a recorded milestone.",
                vec![
                    event(
                        "todo-completed",
                        TodoCompleted {
                            todo_id: "todo-1".into(),
                        },
                    ),
                    event(
                        "todo-completed",
                        TodoCompleted {
                            todo_id: "todo-2".into(),
                        },
                    ),
                    event(
                        "celebration-recorded",
                        CelebrationRecorded { completed_count: 2 },
                    ),
                ],
                vec![],
            ),
        ])
        .output::<Celebrate>()
        .executor(|effect| async move {
            Ok(Some(CommandEnvelope::new(
                "record-celebration",
                RecordCelebration {
                    completed_count: effect.completed_count,
                },
            )?))
        })
        .state()
        .initialized(CelebrationState::default())
        .apply::<TodoCompleted, _>(|event, state| {
            state.completed.insert(event.todo_id.clone());
            Ok(())
        })
        .apply::<CelebrationRecorded, _>(|event, state| {
            state.recorded_counts.insert(event.completed_count);
            Ok(())
        })
        .handle(|state| async move {
            let completed_count = state.completed.len();
            if completed_count == 2 && !state.recorded_counts.contains(&completed_count) {
                Ok(Some(Celebrate { completed_count }))
            } else {
                Ok(None)
            }
        })
}

async fn app() -> Result<SpecterApp> {
    SpecterAppBuilder::new()
        .event::<TodoAdded>()
        .event::<TodoCompleted>()
        .event::<CelebrationRecorded>()
        .command(add_todo_slice())
        .command(complete_todo_slice())
        .command(record_celebration_slice())
        .query(todos_query_slice())
        .reaction(celebration_reaction_slice())
        .build()
        .await
}

#[tokio::test]
async fn scenarios_are_executable_specifications() -> Result<()> {
    app().await?.assert_scenarios().await
}

#[tokio::test]
async fn commands_queries_and_reactions_share_one_event_log() -> Result<()> {
    let app = app().await?;

    for (todo_id, title) in [("todo-1", "Ship it"), ("todo-2", "Review it")] {
        app.command(CommandEnvelope::new(
            "add-todo",
            AddTodo {
                todo_id: todo_id.into(),
                title: title.into(),
            },
        )?)
        .await?;
    }
    for todo_id in ["todo-1", "todo-2"] {
        app.command_typed(
            "complete-todo",
            CompleteTodo {
                todo_id: todo_id.into(),
            },
        )
        .await?;
    }

    let todos: Vec<TodoView> = app
        .query_as(QueryEnvelope::new("list-todos", ListTodos)?)
        .await?;
    assert_eq!(todos.len(), 2);
    assert!(todos.iter().all(|todo| todo.completed));

    let events = app.events().await?;
    assert_eq!(events.len(), 5);
    assert_eq!(events.last().unwrap().event_type, "celebration-recorded");
    Ok(())
}

#[tokio::test]
async fn rejected_commands_do_not_append_events() -> Result<()> {
    let app = app().await?;
    let error = app
        .command_typed(
            "complete-todo",
            CompleteTodo {
                todo_id: "missing".into(),
            },
        )
        .await
        .expect_err("missing todo should be rejected");
    assert!(matches!(error, SpecterError::RejectedCommand(_)));
    assert!(app.events().await?.is_empty());
    Ok(())
}

#[tokio::test]
async fn construction_rejects_apply_handlers_missing_from_given_scenarios() {
    let slice = command("bad-extra-apply")
        .description("Deliberately violates exact Given/apply parity.")
        .scenarios(vec![CommandScenario::accepted(
            "Emits a covered Event.",
            vec![],
            AddTodo {
                todo_id: "todo-1".into(),
                title: "Ship it".into(),
            },
            vec![event(
                "todo-added",
                TodoAdded {
                    todo_id: "todo-1".into(),
                    title: "Ship it".into(),
                },
            )],
        )])
        .input::<AddTodo>()
        .state()
        .initialized(())
        .apply::<TodoAdded, _>(|_, _state| Ok(()))
        .handle(|input, ()| async move {
            Ok(vec![EventDraft::new(TodoAdded {
                todo_id: input.todo_id,
                title: input.title,
            })?])
        });

    let error = match SpecterAppBuilder::new()
        .event::<TodoAdded>()
        .command(slice)
        .build()
        .await
    {
        Ok(_) => panic!("invalid app unexpectedly passed conformance"),
        Err(error) => error,
    };
    let SpecterError::Conformance(errors) = error else {
        panic!("expected conformance error")
    };
    assert!(
        errors
            .0
            .iter()
            .any(|diagnostic| diagnostic.code == "extra-apply-handler")
    );
}

#[tokio::test]
async fn construction_rejects_lossy_scenario_event_payloads() {
    let slice = command("lossy-scenario")
        .description("Uses an example with an undeclared payload field.")
        .scenarios(vec![CommandScenario::accepted(
            "Contains an extra field.",
            vec![],
            AddTodo {
                todo_id: "todo-1".into(),
                title: "Ship it".into(),
            },
            vec![event(
                "todo-added",
                json!({"todo_id": "todo-1", "title": "Ship it", "extra": true}),
            )],
        )])
        .input::<AddTodo>()
        .state()
        .initialized(())
        .handle(|input, ()| async move {
            Ok(vec![EventDraft::new(TodoAdded {
                todo_id: input.todo_id,
                title: input.title,
            })?])
        });

    let error = match SpecterAppBuilder::new()
        .event::<TodoAdded>()
        .command(slice)
        .build()
        .await
    {
        Ok(_) => panic!("lossy Scenario Event unexpectedly passed conformance"),
        Err(error) => error,
    };
    let SpecterError::Conformance(errors) = error else {
        panic!("expected conformance error")
    };
    assert!(
        errors
            .0
            .iter()
            .any(|diagnostic| diagnostic.code == "scenario-event-payload")
    );
}

#[tokio::test]
async fn runtime_rejects_events_absent_from_accepted_scenarios() -> Result<()> {
    let slice = command("malicious-command")
        .description("Deliberately emits an Event outside its accepted outcomes.")
        .scenarios(vec![CommandScenario::accepted(
            "Claims it emits todo-added.",
            vec![],
            AddTodo {
                todo_id: "todo-1".into(),
                title: "Ship it".into(),
            },
            vec![event(
                "todo-added",
                TodoAdded {
                    todo_id: "todo-1".into(),
                    title: "Ship it".into(),
                },
            )],
        )])
        .input::<AddTodo>()
        .state()
        .initialized(())
        .handle(|input, ()| async move {
            Ok(vec![EventDraft::new(TodoCompleted {
                todo_id: input.todo_id,
            })?])
        });
    let app = SpecterAppBuilder::new()
        .event::<TodoAdded>()
        .command(slice)
        .build()
        .await?;

    let error = app
        .command_typed(
            "malicious-command",
            AddTodo {
                todo_id: "todo-1".into(),
                title: "Ship it".into(),
            },
        )
        .await
        .expect_err("unauthorized Event should be rejected");
    assert!(matches!(error, SpecterError::UnauthorizedEvent { .. }));
    assert!(app.events().await?.is_empty());
    Ok(())
}
