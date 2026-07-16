use serde_json::json;
use specter::{QueryScenario, QuerySpec, event, query};

pub(super) fn list_todos_spec() -> QuerySpec {
    query("listTodos")
        .description("Lists todos from this Slice's event-derived projection.")
        .scenarios(vec![QueryScenario::new(
            "Lists active and completed todos.",
            vec![
                event(
                    "todo-added",
                    json!({ "todo_id": "todo-1", "title": "Ship it" }),
                ),
                event(
                    "todo-added",
                    json!({ "todo_id": "todo-2", "title": "Review it" }),
                ),
                event("todo-completed", json!({ "todo_id": "todo-1" })),
            ],
            json!(null),
            json!([
                { "id": "todo-1", "title": "Ship it", "completed": true },
                { "id": "todo-2", "title": "Review it", "completed": false }
            ]),
        )])
}
