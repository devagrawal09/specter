use serde_json::json;
use specter::{ReactionScenario, ReactionSpec, event, reaction};

pub(super) fn celebrate_milestone_spec() -> ReactionSpec {
    reaction("celebrateTodoMilestone")
        .description("Requests milestone recording after every third completion.")
        .scenarios(vec![
            ReactionScenario::new(
                "Does nothing before three completions.",
                vec![event("todo-completed", json!({ "todo_id": "todo-1" }))],
                vec![],
            ),
            ReactionScenario::new(
                "Requests milestone recording after three completions.",
                vec![
                    event("todo-completed", json!({ "todo_id": "todo-1" })),
                    event("todo-completed", json!({ "todo_id": "todo-2" })),
                    event("todo-completed", json!({ "todo_id": "todo-3" })),
                ],
                ReactionScenario::effects([json!({ "completed_count": 3 })]),
            ),
            ReactionScenario::new(
                "Does not repeat a recorded milestone.",
                vec![
                    event("todo-completed", json!({ "todo_id": "todo-1" })),
                    event("todo-completed", json!({ "todo_id": "todo-2" })),
                    event("todo-completed", json!({ "todo_id": "todo-3" })),
                    event("todo-milestone-recorded", json!({ "completed_count": 3 })),
                ],
                vec![],
            ),
        ])
}
