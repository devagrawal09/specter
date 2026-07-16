use serde_json::json;
use specter::{CommandScenario, CommandSpec, command, event};

pub(super) fn approve_deployment_spec() -> CommandSpec {
    command("approve-deployment")
        .description("Approves a requested deployment exactly once.")
        .scenarios(vec![
            CommandScenario::accepted(
                "Approves a requested deployment.",
                vec![event(
                    "deployment-requested",
                    json!({
                        "deployment_id": "deploy-1",
                        "service": "billing",
                        "version": "2026.07.16"
                    }),
                )],
                json!({ "deployment_id": "deploy-1", "approver": "ada" }),
                vec![event(
                    "deployment-approved",
                    json!({ "deployment_id": "deploy-1", "approver": "ada" }),
                )],
            ),
            CommandScenario::rejected(
                "Rejects approval for a missing deployment.",
                vec![],
                json!({ "deployment_id": "missing", "approver": "ada" }),
                "Deployment not found",
            ),
            CommandScenario::rejected(
                "Rejects duplicate approval.",
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
                json!({ "deployment_id": "deploy-1", "approver": "grace" }),
                "Deployment already approved",
            ),
        ])
}
