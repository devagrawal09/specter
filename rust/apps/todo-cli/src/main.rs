mod features;

use clap::{Parser, Subcommand};
use serde_json::json;
use specter::Result;

use features::todos::{AddTodo, CompleteTodo, ListTodos, TodoView, create_app};

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

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    let app = create_app().await?;

    match cli.action.unwrap_or(Action::Demo) {
        Action::Demo => {
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
        Action::Verify => {
            app.assert_scenarios().await?;
            println!("All Todo Slice Scenarios passed.");
            Ok(())
        }
    }
}
