use serde_json::json;
use specter::{CommandScenario, CommandSpec, command, event};

pub(super) fn record_notification_spec() -> CommandSpec {
    command("recordNotification")
        .description("Records a notification created by reaction delivery.")
        .scenarios(vec![CommandScenario::accepted(
            "Records a scheduled notification.",
            vec![],
            json!({
                "incident_id": "incident-1",
                "notification_id": "delivery-1",
                "scheduled_at_unix_ms": 1
            }),
            vec![event(
                "notification-recorded",
                json!({
                    "incident_id": "incident-1",
                    "notification_id": "delivery-1",
                    "scheduled_at_unix_ms": 1
                }),
            )],
        )])
}
