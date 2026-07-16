use std::collections::{BTreeMap, HashSet};

use clap::{Parser, Subcommand};
use serde::{Deserialize, Serialize};
use serde_json::json;
use specter::{
    CommandEnvelope, CommandScenario, CommandSlice, DomainEvent, EventDraft, QueryScenario,
    QuerySlice, ReactionScenario, ReactionSlice, Result, SpecterApp, SpecterAppBuilder,
    SpecterError, command, event, query, reaction,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DeploymentRequested {
    deployment_id: String,
    service: String,
    version: String,
}

impl DomainEvent for DeploymentRequested {
    const TYPE: &'static str = "deployment-requested";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DeploymentApproved {
    deployment_id: String,
    approver: String,
}

impl DomainEvent for DeploymentApproved {
    const TYPE: &'static str = "deployment-approved";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DeploymentStarted {
    deployment_id: String,
}

impl DomainEvent for DeploymentStarted {
    const TYPE: &'static str = "deployment-started";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RequestDeployment {
    deployment_id: String,
    service: String,
    version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ApproveDeployment {
    deployment_id: String,
    approver: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StartDeployment {
    deployment_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct GetDeployment {
    deployment_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct DeploymentView {
    deployment_id: String,
    service: String,
    version: String,
    approver: Option<String>,
    status: String,
}

#[derive(Debug, Clone, Default)]
struct ApprovalState {
    requested: HashSet<String>,
    approved: HashSet<String>,
}

#[derive(Debug, Clone, Default)]
struct StartState {
    requested: HashSet<String>,
    approved: HashSet<String>,
    started: HashSet<String>,
}

#[derive(Debug, Clone, Default)]
struct DeploymentProjection(BTreeMap<String, DeploymentView>);

#[derive(Debug, Clone, Default)]
struct AutoStartState {
    approved: HashSet<String>,
    started: HashSet<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct StartApprovedDeployment {
    deployment_id: String,
}

fn request_deployment() -> CommandSlice<RequestDeployment, ()> {
    command("request-deployment")
        .description("Requests a deployment with caller-provided identity and version.")
        .scenarios(vec![CommandScenario::accepted(
            "Requests a deployment.",
            vec![],
            RequestDeployment {
                deployment_id: "deploy-1".into(),
                service: "billing".into(),
                version: "2026.07.16".into(),
            },
            vec![event(
                "deployment-requested",
                DeploymentRequested {
                    deployment_id: "deploy-1".into(),
                    service: "billing".into(),
                    version: "2026.07.16".into(),
                },
            )],
        )])
        .input::<RequestDeployment>()
        .state()
        .initialized(())
        .handle(|input, ()| async move {
            Ok(vec![EventDraft::new(DeploymentRequested {
                deployment_id: input.deployment_id,
                service: input.service,
                version: input.version,
            })?])
        })
}

fn approve_deployment() -> CommandSlice<ApproveDeployment, ApprovalState> {
    command("approve-deployment")
        .description("Approves a requested deployment exactly once.")
        .scenarios(vec![
            CommandScenario::accepted(
                "Approves a requested deployment.",
                vec![event(
                    "deployment-requested",
                    DeploymentRequested {
                        deployment_id: "deploy-1".into(),
                        service: "billing".into(),
                        version: "2026.07.16".into(),
                    },
                )],
                ApproveDeployment {
                    deployment_id: "deploy-1".into(),
                    approver: "ada".into(),
                },
                vec![event(
                    "deployment-approved",
                    DeploymentApproved {
                        deployment_id: "deploy-1".into(),
                        approver: "ada".into(),
                    },
                )],
            ),
            CommandScenario::rejected(
                "Rejects approval for a missing deployment.",
                vec![],
                ApproveDeployment {
                    deployment_id: "missing".into(),
                    approver: "ada".into(),
                },
                "Deployment not found",
            ),
            CommandScenario::rejected(
                "Rejects duplicate approval.",
                vec![
                    event(
                        "deployment-requested",
                        DeploymentRequested {
                            deployment_id: "deploy-1".into(),
                            service: "billing".into(),
                            version: "2026.07.16".into(),
                        },
                    ),
                    event(
                        "deployment-approved",
                        DeploymentApproved {
                            deployment_id: "deploy-1".into(),
                            approver: "ada".into(),
                        },
                    ),
                ],
                ApproveDeployment {
                    deployment_id: "deploy-1".into(),
                    approver: "grace".into(),
                },
                "Deployment already approved",
            ),
        ])
        .input::<ApproveDeployment>()
        .state()
        .initialized(ApprovalState::default())
        .apply::<DeploymentRequested, _>(|event, state| {
            state.requested.insert(event.deployment_id.clone());
            Ok(())
        })
        .apply::<DeploymentApproved, _>(|event, state| {
            state.approved.insert(event.deployment_id.clone());
            Ok(())
        })
        .handle(|input, state| async move {
            if !state.requested.contains(&input.deployment_id) {
                return Err(SpecterError::rejected("Deployment not found"));
            }
            if state.approved.contains(&input.deployment_id) {
                return Err(SpecterError::rejected("Deployment already approved"));
            }
            Ok(vec![EventDraft::new(DeploymentApproved {
                deployment_id: input.deployment_id,
                approver: input.approver,
            })?])
        })
}

fn start_deployment() -> CommandSlice<StartDeployment, StartState> {
    command("start-deployment")
        .description("Starts an approved deployment exactly once.")
        .scenarios(vec![
            CommandScenario::accepted(
                "Starts an approved deployment.",
                vec![
                    event(
                        "deployment-requested",
                        DeploymentRequested {
                            deployment_id: "deploy-1".into(),
                            service: "billing".into(),
                            version: "2026.07.16".into(),
                        },
                    ),
                    event(
                        "deployment-approved",
                        DeploymentApproved {
                            deployment_id: "deploy-1".into(),
                            approver: "ada".into(),
                        },
                    ),
                ],
                StartDeployment {
                    deployment_id: "deploy-1".into(),
                },
                vec![event(
                    "deployment-started",
                    DeploymentStarted {
                        deployment_id: "deploy-1".into(),
                    },
                )],
            ),
            CommandScenario::rejected(
                "Rejects starting before approval.",
                vec![event(
                    "deployment-requested",
                    DeploymentRequested {
                        deployment_id: "deploy-1".into(),
                        service: "billing".into(),
                        version: "2026.07.16".into(),
                    },
                )],
                StartDeployment {
                    deployment_id: "deploy-1".into(),
                },
                "Deployment is not approved",
            ),
            CommandScenario::rejected(
                "Rejects starting a deployment twice.",
                vec![
                    event(
                        "deployment-requested",
                        DeploymentRequested {
                            deployment_id: "deploy-1".into(),
                            service: "billing".into(),
                            version: "2026.07.16".into(),
                        },
                    ),
                    event(
                        "deployment-approved",
                        DeploymentApproved {
                            deployment_id: "deploy-1".into(),
                            approver: "ada".into(),
                        },
                    ),
                    event(
                        "deployment-started",
                        DeploymentStarted {
                            deployment_id: "deploy-1".into(),
                        },
                    ),
                ],
                StartDeployment {
                    deployment_id: "deploy-1".into(),
                },
                "Deployment already started",
            ),
        ])
        .input::<StartDeployment>()
        .state()
        .initialized(StartState::default())
        .apply::<DeploymentRequested, _>(|event, state| {
            state.requested.insert(event.deployment_id.clone());
            Ok(())
        })
        .apply::<DeploymentApproved, _>(|event, state| {
            state.approved.insert(event.deployment_id.clone());
            Ok(())
        })
        .apply::<DeploymentStarted, _>(|event, state| {
            state.started.insert(event.deployment_id.clone());
            Ok(())
        })
        .handle(|input, state| async move {
            if !state.requested.contains(&input.deployment_id)
                || !state.approved.contains(&input.deployment_id)
            {
                return Err(SpecterError::rejected("Deployment is not approved"));
            }
            if state.started.contains(&input.deployment_id) {
                return Err(SpecterError::rejected("Deployment already started"));
            }
            Ok(vec![EventDraft::new(DeploymentStarted {
                deployment_id: input.deployment_id,
            })?])
        })
}

fn get_deployment() -> QuerySlice<GetDeployment, DeploymentView, DeploymentProjection> {
    query("get-deployment")
        .description("Reads deployment status from a private event-derived projection.")
        .scenarios(vec![QueryScenario::new(
            "Returns a started deployment.",
            vec![
                event(
                    "deployment-requested",
                    DeploymentRequested {
                        deployment_id: "deploy-1".into(),
                        service: "billing".into(),
                        version: "2026.07.16".into(),
                    },
                ),
                event(
                    "deployment-approved",
                    DeploymentApproved {
                        deployment_id: "deploy-1".into(),
                        approver: "ada".into(),
                    },
                ),
                event(
                    "deployment-started",
                    DeploymentStarted {
                        deployment_id: "deploy-1".into(),
                    },
                ),
            ],
            GetDeployment {
                deployment_id: "deploy-1".into(),
            },
            DeploymentView {
                deployment_id: "deploy-1".into(),
                service: "billing".into(),
                version: "2026.07.16".into(),
                approver: Some("ada".into()),
                status: "started".into(),
            },
        )])
        .input::<GetDeployment>()
        .output::<DeploymentView>()
        .state()
        .initialized(DeploymentProjection::default())
        .apply::<DeploymentRequested, _>(|event, state| {
            state.0.insert(
                event.deployment_id.clone(),
                DeploymentView {
                    deployment_id: event.deployment_id.clone(),
                    service: event.service.clone(),
                    version: event.version.clone(),
                    approver: None,
                    status: "requested".into(),
                },
            );
            Ok(())
        })
        .apply::<DeploymentApproved, _>(|event, state| {
            if let Some(deployment) = state.0.get_mut(&event.deployment_id) {
                deployment.approver = Some(event.approver.clone());
                deployment.status = "approved".into();
            }
            Ok(())
        })
        .apply::<DeploymentStarted, _>(|event, state| {
            if let Some(deployment) = state.0.get_mut(&event.deployment_id) {
                deployment.status = "started".into();
            }
            Ok(())
        })
        .handle(|input, state| async move {
            state
                .0
                .get(&input.deployment_id)
                .cloned()
                .ok_or_else(|| SpecterError::Message("Deployment not found".into()))
        })
}

fn auto_start_approved() -> ReactionSlice<StartApprovedDeployment, AutoStartState> {
    reaction("auto-start-approved-deployment")
        .description("Requests start-deployment when a deployment becomes approved.")
        .scenarios(vec![
            ReactionScenario::new(
                "Requests start for an approved deployment.",
                vec![event(
                    "deployment-approved",
                    DeploymentApproved {
                        deployment_id: "deploy-1".into(),
                        approver: "ada".into(),
                    },
                )],
                ReactionScenario::effects([StartApprovedDeployment {
                    deployment_id: "deploy-1".into(),
                }]),
            ),
            ReactionScenario::new(
                "Does not restart a deployment.",
                vec![
                    event(
                        "deployment-approved",
                        DeploymentApproved {
                            deployment_id: "deploy-1".into(),
                            approver: "ada".into(),
                        },
                    ),
                    event(
                        "deployment-started",
                        DeploymentStarted {
                            deployment_id: "deploy-1".into(),
                        },
                    ),
                ],
                vec![],
            ),
        ])
        .output::<StartApprovedDeployment>()
        .executor(|effect| async move {
            Ok(Some(CommandEnvelope::new(
                "start-deployment",
                StartDeployment {
                    deployment_id: effect.deployment_id,
                },
            )?))
        })
        .state()
        .initialized(AutoStartState::default())
        .apply::<DeploymentApproved, _>(|event, state| {
            state.approved.insert(event.deployment_id.clone());
            Ok(())
        })
        .apply::<DeploymentStarted, _>(|event, state| {
            state.started.insert(event.deployment_id.clone());
            Ok(())
        })
        .handle(|state| async move {
            let pending = state.approved.difference(&state.started).next().cloned();
            Ok(pending.map(|deployment_id| StartApprovedDeployment { deployment_id }))
        })
}

async fn create_app() -> Result<SpecterApp> {
    SpecterAppBuilder::new()
        .event::<DeploymentRequested>()
        .event::<DeploymentApproved>()
        .event::<DeploymentStarted>()
        .command(request_deployment())
        .command(approve_deployment())
        .command(start_deployment())
        .query(get_deployment())
        .reaction(auto_start_approved())
        .build()
        .await
}

async fn demo(app: SpecterApp) -> Result<()> {
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

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    let app = create_app().await?;
    match cli.action.unwrap_or(Action::Demo) {
        Action::Demo => demo(app).await,
        Action::Verify => {
            app.assert_scenarios().await?;
            println!("All Deployment Slice Scenarios passed.");
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn all_slice_scenarios_pass() -> Result<()> {
        create_app().await?.assert_scenarios().await
    }
}
