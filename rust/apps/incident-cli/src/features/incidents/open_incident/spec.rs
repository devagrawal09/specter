use serde_json::json;
use specter::{CommandScenario, CommandSpec, command, event};

pub(crate) fn open_incident_spec() -> CommandSpec {
    command("openIncident")
        .description("Opens an incident using caller-provided identity and timestamp.")
        .scenarios(vec![CommandScenario::accepted(
            "Opens an incident.",
            vec![],
            json!({
                "incident_id": "incident-1",
                "summary": "Checkout unavailable",
                "opened_at": "2026-07-16T12:00:00Z"
            }),
            vec![event(
                "incident-opened",
                json!({
                    "incident_id": "incident-1",
                    "summary": "Checkout unavailable",
                    "opened_at": "2026-07-16T12:00:00Z"
                }),
            )],
        )])
}
