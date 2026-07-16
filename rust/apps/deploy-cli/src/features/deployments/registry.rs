use specter::{Result, SpecterApp, SpecterAppBuilder};

use super::{
    approve_deployment::approve_deployment,
    auto_start_approved::auto_start_approved,
    events::{DeploymentApproved, DeploymentRequested, DeploymentStarted},
    get_deployment::get_deployment,
    request_deployment::request_deployment,
    start_deployment::start_deployment,
};

pub(crate) use super::{
    approve_deployment::ApproveDeployment,
    get_deployment::{DeploymentView, GetDeployment},
    request_deployment::RequestDeployment,
};

pub(crate) async fn create_app() -> Result<SpecterApp> {
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
