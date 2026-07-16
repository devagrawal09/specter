use serde_json::json;
use specter::{CommandScenario, CommandSpec, command, event};

pub(super) fn complete_todo_spec() -> CommandSpec {
    command("completeTodo")
        .description("Completes an existing todo once.")
        .scenarios(vec![
            CommandScenario::accepted(
                "Completes an existing todo.",
                vec![event(
                    "todo-added",
                    json!({ "todo_id": "todo-1", "title": "Ship it" }),
                )],
                json!({ "todo_id": "todo-1" }),
                vec![event("todo-completed", json!({ "todo_id": "todo-1" }))],
            ),
            CommandScenario::rejected(
                "Rejects a missing todo.",
                vec![],
                json!({ "todo_id": "missing" }),
                "Todo not found",
            ),
            CommandScenario::rejected(
                "Rejects completing a todo twice.",
                vec![
                    event(
                        "todo-added",
                        json!({ "todo_id": "todo-1", "title": "Ship it" }),
                    ),
                    event("todo-completed", json!({ "todo_id": "todo-1" })),
                ],
                json!({ "todo_id": "todo-1" }),
                "Todo already completed",
            ),
        ])
}
