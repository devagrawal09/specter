mod features;

use clap::{Parser, Subcommand};
use serde_json::json;
use specter::Result;

use features::deployments::{
    ApproveDeployment, DeploymentView, GetDeployment, RequestDeployment, create_app,
};

#[derive(Parser)]
#[command(about = "Deployment workflow built on the experimental Specter Rust runtime")]
struct Cli {
    #[command(subcommand)]
    action: Option<Action>,
}

#[derive(Subcommand)]
enum Action {
    /// Request and approve a deployment, allowing a Reaction Slice to start it.
    Demo,
    /// Execute every Slice Scenario as a behavior test.
    Verify,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    let app = create_app().await?;

    match cli.action.unwrap_or(Action::Demo) {
        Action::Demo => {
            println!("Deploy CLI — approval triggers a Reaction Slice and command\n");
            let deployment_id = "deploy-1".to_owned();
            app.command_typed(
                "request-deployment",
                RequestDeployment {
                    deployment_id: deployment_id.clone(),
                    service: "billing".into(),
                    version: "2026.07.16".into(),
                },
            )
            .await?;
            app.command_typed(
                "approve-deployment",
                ApproveDeployment {
                    deployment_id: deployment_id.clone(),
                    approver: "ada".into(),
                },
            )
            .await?;

            let deployment: DeploymentView = app
                .query_typed(
                    "get-deployment",
                    GetDeployment {
                        deployment_id: deployment_id.clone(),
                    },
                )
                .await?;
            println!(
                "Deployment:\n{}",
                serde_json::to_string_pretty(&deployment)?
            );

            let history: Vec<_> = app
                .events()
                .await?
                .into_iter()
                .map(|event| {
                    json!({
                        "order": event.order,
                        "type": event.event_type,
                        "payload": event.payload,
                    })
                })
                .collect();
            println!("\nEvent log:\n{}", serde_json::to_string_pretty(&history)?);
            Ok(())
        }
        Action::Verify => {
            app.assert_scenarios().await?;
            println!("All Deployment Slice Scenarios passed.");
            Ok(())
        }
    }
}
