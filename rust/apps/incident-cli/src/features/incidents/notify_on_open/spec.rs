use serde_json::json;
use specter::{ReactionScenario, ReactionSpec, event, reaction};

pub(super) fn notify_on_open_spec() -> ReactionSpec {
    reaction("notifyOnIncidentOpen")
        .description("Requests a follow-up notification command after an incident opens.")
        .scenarios(vec![ReactionScenario::new(
            "Requests notification for an opened incident.",
            vec![event(
                "incident-opened",
                json!({
                    "incident_id": "incident-1",
                    "summary": "Checkout unavailable",
                    "opened_at": "2026-07-16T12:00:00Z"
                }),
            )],
            ReactionScenario::effects([json!({ "incident_id": "incident-1" })]),
        )])
}
