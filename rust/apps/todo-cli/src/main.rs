use std::collections::{BTreeMap, HashSet};

use clap::{Parser, Subcommand};
use serde::{Deserialize, Serialize};
use serde_json::json;
use specter::{
    CommandEnvelope, CommandScenario, CommandSlice, DomainEvent, EventDraft, QueryScenario,
    QuerySlice, ReactionScenario, ReactionSlice, Result, SpecterApp, SpecterAppBuilder,
    SpecterError, command, event, query, reaction,
};

#[derive(Parser)]
#[command(about = "Todo app built on the experimental Specter Rust runtime")]
struct Cli {
    #[command(subcommand)]
    action: Option<Action>,
}

#[derive(Subcommand)]
enum Action {
    /// Run a scripted event-sourced Todo workflow.
    Demo,
    /// Execute every Slice Scenario as a behavior test.
    Verify,
}

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
struct TodoMilestoneRecorded {
    completed_count: usize,
}

impl DomainEvent for TodoMilestoneRecorded {
    const TYPE: &'static str = "todo-milestone-recorded";
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
struct RecordMilestone {
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
struct CompletionState {
    known: HashSet<String>,
    completed: HashSet<String>,
}

#[derive(Debug, Clone, Default)]
struct TodoProjection(BTreeMap<String, TodoView>);

#[derive(Debug, Clone, Default)]
struct MilestoneState {
    completed: HashSet<String>,
    recorded: HashSet<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct CelebrateMilestone {
    completed_count: usize,
}

fn add_todo() -> CommandSlice<AddTodo, ()> {
    command("add-todo")
        .description("Adds a todo with a caller-provided domain ID.")
        .scenarios(vec![CommandScenario::accepted(
            "Creates a todo and trims its title.",
            vec![],
            AddTodo {
                todo_id: "todo-1".into(),
                title: "  Ship it  ".into(),
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
            let title = input.title.trim().to_owned();
            if title.is_empty() {
                return Err(SpecterError::rejected("Todo title is required"));
            }
            Ok(vec![EventDraft::new(TodoAdded {
                todo_id: input.todo_id,
                title,
            })?])
        })
}

fn complete_todo() -> CommandSlice<CompleteTodo, CompletionState> {
    command("complete-todo")
        .description("Completes an existing todo once.")
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
        .handle(|input, state| async move {
            if !state.known.contains(&input.todo_id) {
                return Err(SpecterError::rejected("Todo not found"));
            }
            if state.completed.contains(&input.todo_id) {
                return Err(SpecterError::rejected("Todo already completed"));
            }
            Ok(vec![EventDraft::new(TodoCompleted {
                todo_id: input.todo_id,
            })?])
        })
}

fn record_milestone() -> CommandSlice<RecordMilestone, ()> {
    command("record-todo-milestone")
        .description("Records a completion milestone requested by a Reaction Slice.")
        .scenarios(vec![CommandScenario::accepted(
            "Records the three-completion milestone.",
            vec![],
            RecordMilestone { completed_count: 3 },
            vec![event(
                "todo-milestone-recorded",
                TodoMilestoneRecorded { completed_count: 3 },
            )],
        )])
        .input::<RecordMilestone>()
        .state()
        .initialized(())
        .handle(|input, ()| async move {
            Ok(vec![EventDraft::new(TodoMilestoneRecorded {
                completed_count: input.completed_count,
            })?])
        })
}

fn list_todos() -> QuerySlice<ListTodos, Vec<TodoView>, TodoProjection> {
    query("list-todos")
        .description("Lists todos from this Slice's event-derived projection.")
        .scenarios(vec![QueryScenario::new(
            "Lists active and completed todos.",
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
            state.0.insert(
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
            if let Some(todo) = state.0.get_mut(&event.todo_id) {
                todo.completed = true;
            }
            Ok(())
        })
        .handle(|ListTodos, state| async move { Ok(state.0.into_values().collect()) })
}

fn celebrate_milestone() -> ReactionSlice<CelebrateMilestone, MilestoneState> {
    reaction("celebrate-todo-milestone")
        .description("Requests milestone recording after every third completion.")
        .scenarios(vec![
            ReactionScenario::new(
                "Does nothing before three completions.",
                vec![event(
                    "todo-completed",
                    TodoCompleted {
                        todo_id: "todo-1".into(),
                    },
                )],
                vec![],
            ),
            ReactionScenario::new(
                "Requests milestone recording after three completions.",
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
                        "todo-completed",
                        TodoCompleted {
                            todo_id: "todo-3".into(),
                        },
                    ),
                ],
                ReactionScenario::effects([CelebrateMilestone { completed_count: 3 }]),
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
                        "todo-completed",
                        TodoCompleted {
                            todo_id: "todo-3".into(),
                        },
                    ),
                    event(
                        "todo-milestone-recorded",
                        TodoMilestoneRecorded { completed_count: 3 },
                    ),
                ],
                vec![],
            ),
        ])
        .output::<CelebrateMilestone>()
        .executor(|effect| async move {
            Ok(Some(CommandEnvelope::new(
                "record-todo-milestone",
                RecordMilestone {
                    completed_count: effect.completed_count,
                },
            )?))
        })
        .state()
        .initialized(MilestoneState::default())
        .apply::<TodoCompleted, _>(|event, state| {
            state.completed.insert(event.todo_id.clone());
            Ok(())
        })
        .apply::<TodoMilestoneRecorded, _>(|event, state| {
            state.recorded.insert(event.completed_count);
            Ok(())
        })
        .handle(|state| async move {
            let completed_count = state.completed.len();
            if completed_count > 0
                && completed_count % 3 == 0
                && !state.recorded.contains(&completed_count)
            {
                Ok(Some(CelebrateMilestone { completed_count }))
            } else {
                Ok(None)
            }
        })
}

async fn create_app() -> Result<SpecterApp> {
    SpecterAppBuilder::new()
        .event::<TodoAdded>()
        .event::<TodoCompleted>()
        .event::<TodoMilestoneRecorded>()
        .command(add_todo())
        .command(complete_todo())
        .command(record_milestone())
        .query(list_todos())
        .reaction(celebrate_milestone())
        .build()
        .await
}

async fn demo(app: SpecterApp) -> Result<()> {
    println!("Todo CLI — three completions trigger a Reaction Slice\n");
    for (index, title) in ["Port the runtime", "Exercise scenarios", "Ship the CLI"]
        .into_iter()
        .enumerate()
    {
        let todo_id = format!("todo-{}", index + 1);
        app.command_typed(
            "add-todo",
            AddTodo {
                todo_id: todo_id.clone(),
                title: title.into(),
            },
        )
        .await?;
        app.command_typed("complete-todo", CompleteTodo { todo_id })
            .await?;
    }

    let todos: Vec<TodoView> = app.query_typed("list-todos", ListTodos).await?;
    println!("Todos:\n{}", serde_json::to_string_pretty(&todos)?);
    let history: Vec<_> = app
        .events()
        .await?
        .into_iter()
        .map(|event| {
            json!({
                "order": event.order,
                "type": event.event_type,
                "payload": event.payload,
            })
        })
        .collect();
    println!("\nEvent log:\n{}", serde_json::to_string_pretty(&history)?);
    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    let app = create_app().await?;
    match cli.action.unwrap_or(Action::Demo) {
        Action::Demo => demo(app).await,
        Action::Verify => {
            app.assert_scenarios().await?;
            println!("All Todo Slice Scenarios passed.");
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn all_slice_scenarios_pass() -> Result<()> {
        create_app().await?.assert_scenarios().await
    }
}
