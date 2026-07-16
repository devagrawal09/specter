use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use specter::{CommandSlice, EventDraft, SpecterError};

use super::spec::start_deployment_spec;
use crate::features::deployments::events::{
    DeploymentApproved, DeploymentRequested, DeploymentStarted,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct StartDeployment {
    pub(crate) deployment_id: String,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct StartState {
    requested: HashSet<String>,
    approved: HashSet<String>,
    started: HashSet<String>,
}

pub(crate) fn start_deployment() -> CommandSlice<StartDeployment, StartState> {
    start_deployment_spec()
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
