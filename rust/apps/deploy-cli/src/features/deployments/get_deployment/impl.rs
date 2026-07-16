use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use specter::{QuerySlice, SpecterError};

use super::spec::get_deployment_spec;
use crate::features::deployments::events::{
    DeploymentApproved, DeploymentRequested, DeploymentStarted,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct GetDeployment {
    pub(crate) deployment_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct DeploymentView {
    pub(crate) deployment_id: String,
    pub(crate) service: String,
    pub(crate) version: String,
    pub(crate) approver: Option<String>,
    pub(crate) status: String,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct DeploymentProjection(BTreeMap<String, DeploymentView>);

pub(crate) fn get_deployment() -> QuerySlice<GetDeployment, DeploymentView, DeploymentProjection> {
    get_deployment_spec()
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
