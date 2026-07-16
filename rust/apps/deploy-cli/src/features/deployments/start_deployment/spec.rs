use serde_json::json;
use specter::{CommandScenario, CommandSpec, command, event};

pub(super) fn start_deployment_spec() -> CommandSpec {
    command("start-deployment")
        .description("Starts an approved deployment exactly once.")
        .scenarios(vec![
            CommandScenario::accepted(
                "Starts an approved deployment.",
                vec![
                    event(
                        "deployment-requested",
                        json!({
                            "deployment_id": "deploy-1",
                            "service": "billing",
                            "version": "2026.07.16"
                        }),
                    ),
                    event(
                        "deployment-approved",
                        json!({ "deployment_id": "deploy-1", "approver": "ada" }),
                    ),
                ],
                json!({ "deployment_id": "deploy-1" }),
                vec![event(
                    "deployment-started",
                    json!({ "deployment_id": "deploy-1" }),
                )],
            ),
            CommandScenario::rejected(
                "Rejects starting before approval.",
                vec![event(
                    "deployment-requested",
                    json!({
                        "deployment_id": "deploy-1",
                        "service": "billing",
                        "version": "2026.07.16"
                    }),
                )],
                json!({ "deployment_id": "deploy-1" }),
                "Deployment is not approved",
            ),
            CommandScenario::rejected(
                "Rejects starting a deployment twice.",
                vec![
                    event(
                        "deployment-requested",
                        json!({
                            "deployment_id": "deploy-1",
                            "service": "billing",
                            "version": "2026.07.16"
                        }),
                    ),
                    event(
                        "deployment-approved",
                        json!({ "deployment_id": "deploy-1", "approver": "ada" }),
                    ),
                    event("deployment-started", json!({ "deployment_id": "deploy-1" })),
                ],
                json!({ "deployment_id": "deploy-1" }),
                "Deployment already started",
            ),
        ])
}
