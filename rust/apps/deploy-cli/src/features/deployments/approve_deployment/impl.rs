use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use specter::{CommandSlice, EventDraft, SpecterError};

use super::spec::approve_deployment_spec;
use crate::features::deployments::events::{DeploymentApproved, DeploymentRequested};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct ApproveDeployment {
    pub(crate) deployment_id: String,
    pub(crate) approver: String,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct ApprovalState {
    requested: HashSet<String>,
    approved: HashSet<String>,
}

pub(crate) fn approve_deployment() -> CommandSlice<ApproveDeployment, ApprovalState> {
    approve_deployment_spec()
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
