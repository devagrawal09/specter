use serde_json::json;
use specter::{CommandScenario, CommandSpec, command, event};

pub(super) fn request_deployment_spec() -> CommandSpec {
    command("request-deployment")
        .description("Requests a deployment with caller-provided identity and version.")
        .scenarios(vec![CommandScenario::accepted(
            "Requests a deployment.",
            vec![],
            json!({
                "deployment_id": "deploy-1",
                "service": "billing",
                "version": "2026.07.16"
            }),
            vec![event(
                "deployment-requested",
                json!({
                    "deployment_id": "deploy-1",
                    "service": "billing",
                    "version": "2026.07.16"
                }),
            )],
        )])
}
