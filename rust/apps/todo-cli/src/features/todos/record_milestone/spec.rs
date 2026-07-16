use serde_json::json;
use specter::{CommandScenario, CommandSpec, command, event};

pub(super) fn record_milestone_spec() -> CommandSpec {
    command("record-todo-milestone")
        .description("Records a completion milestone requested by a Reaction Slice.")
        .scenarios(vec![CommandScenario::accepted(
            "Records the three-completion milestone.",
            vec![],
            json!({ "completed_count": 3 }),
            vec![event(
                "todo-milestone-recorded",
                json!({ "completed_count": 3 }),
            )],
        )])
}
