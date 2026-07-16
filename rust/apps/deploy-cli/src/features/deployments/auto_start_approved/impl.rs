use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use specter::{CommandEnvelope, ReactionSlice};

use super::spec::auto_start_approved_spec;
use crate::features::deployments::{
    events::{DeploymentApproved, DeploymentStarted},
    start_deployment::StartDeployment,
};

#[derive(Debug, Clone, Default)]
pub(crate) struct AutoStartState {
    approved: HashSet<String>,
    started: HashSet<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct StartApprovedDeployment {
    deployment_id: String,
}

pub(crate) fn auto_start_approved() -> ReactionSlice<StartApprovedDeployment, AutoStartState> {
    auto_start_approved_spec()
        .output::<StartApprovedDeployment>()
        .executor(|effect, _context| async move {
            Ok(Some(CommandEnvelope::new(
                "startDeployment",
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
