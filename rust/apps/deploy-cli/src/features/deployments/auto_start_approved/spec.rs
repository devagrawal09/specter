use serde_json::json;
use specter::{ReactionScenario, ReactionSpec, event, reaction};

pub(super) fn auto_start_approved_spec() -> ReactionSpec {
    reaction("auto-start-approved-deployment")
        .description("Requests start-deployment when a deployment becomes approved.")
        .scenarios(vec![
            ReactionScenario::new(
                "Requests start for an approved deployment.",
                vec![event(
                    "deployment-approved",
                    json!({ "deployment_id": "deploy-1", "approver": "ada" }),
                )],
                ReactionScenario::effects([json!({ "deployment_id": "deploy-1" })]),
            ),
            ReactionScenario::new(
                "Does not restart a deployment.",
                vec![
                    event(
                        "deployment-approved",
                        json!({ "deployment_id": "deploy-1", "approver": "ada" }),
                    ),
                    event("deployment-started", json!({ "deployment_id": "deploy-1" })),
                ],
                vec![],
            ),
        ])
}
