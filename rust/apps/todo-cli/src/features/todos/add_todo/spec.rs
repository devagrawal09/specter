use serde_json::json;
use specter::{CommandScenario, CommandSpec, command, event};

pub(super) fn add_todo_spec() -> CommandSpec {
    command("add-todo")
        .description("Adds a todo with a caller-provided domain ID.")
        .scenarios(vec![CommandScenario::accepted(
            "Creates a todo and trims its title.",
            vec![],
            json!({ "todo_id": "todo-1", "title": "  Ship it  " }),
            vec![event(
                "todo-added",
                json!({ "todo_id": "todo-1", "title": "Ship it" }),
            )],
        )])
}
