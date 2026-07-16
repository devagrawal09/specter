use serde::{Deserialize, Serialize};
use specter::DomainEvent;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct DeploymentRequested {
    pub(crate) deployment_id: String,
    pub(crate) service: String,
    pub(crate) version: String,
}

impl DomainEvent for DeploymentRequested {
    const TYPE: &'static str = "deployment-requested";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct DeploymentApproved {
    pub(crate) deployment_id: String,
    pub(crate) approver: String,
}

impl DomainEvent for DeploymentApproved {
    const TYPE: &'static str = "deployment-approved";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct DeploymentStarted {
    pub(crate) deployment_id: String,
}

impl DomainEvent for DeploymentStarted {
    const TYPE: &'static str = "deployment-started";
}
