use serde_json::json;
use specter::{QueryScenario, QuerySpec, event, query};

pub(super) fn get_incident_spec() -> QuerySpec {
    query("getIncident")
        .description("Reads an incident and its notification from an event-derived projection.")
        .scenarios(vec![QueryScenario::new(
            "Returns a notified incident.",
            vec![
                event(
                    "incident-opened",
                    json!({
                        "incident_id": "incident-1",
                        "summary": "Checkout unavailable",
                        "opened_at": "2026-07-16T12:00:00Z"
                    }),
                ),
                event(
                    "notification-recorded",
                    json!({
                        "incident_id": "incident-1",
                        "notification_id": "delivery-1",
                        "scheduled_at_unix_ms": 1
                    }),
                ),
            ],
            json!({ "incident_id": "incident-1" }),
            json!({
                "incident_id": "incident-1",
                "summary": "Checkout unavailable",
                "opened_at": "2026-07-16T12:00:00Z",
                "notification_id": "delivery-1"
            }),
        )])
}
