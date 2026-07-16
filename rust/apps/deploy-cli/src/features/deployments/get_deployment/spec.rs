use serde_json::json;
use specter::{QueryScenario, QuerySpec, event, query};

pub(super) fn get_deployment_spec() -> QuerySpec {
    query("getDeployment")
        .description("Reads deployment status from a private event-derived projection.")
        .scenarios(vec![QueryScenario::new(
            "Returns a started deployment.",
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
            json!({
                "deployment_id": "deploy-1",
                "service": "billing",
                "version": "2026.07.16",
                "approver": "ada",
                "status": "started"
            }),
        )])
}
