use serde::{Deserialize, Serialize};
use specter::{CommandSlice, EventDraft};

use super::spec::request_deployment_spec;
use crate::features::deployments::events::DeploymentRequested;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct RequestDeployment {
    pub(crate) deployment_id: String,
    pub(crate) service: String,
    pub(crate) version: String,
}

pub(crate) fn request_deployment() -> CommandSlice<RequestDeployment, ()> {
    request_deployment_spec()
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
