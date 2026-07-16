use serde::{Deserialize, Serialize};
use specter::DomainEvent;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct IncidentOpened {
    pub(crate) incident_id: String,
    pub(crate) summary: String,
    pub(crate) opened_at: String,
}

impl DomainEvent for IncidentOpened {
    const TYPE: &'static str = "incident-opened";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct NotificationRecorded {
    pub(crate) incident_id: String,
    pub(crate) notification_id: String,
    pub(crate) scheduled_at_unix_ms: u128,
}

impl DomainEvent for NotificationRecorded {
    const TYPE: &'static str = "notification-recorded";
}
