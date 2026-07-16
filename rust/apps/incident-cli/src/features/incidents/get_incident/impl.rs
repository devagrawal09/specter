use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use specter::{QuerySlice, SpecterError};

use super::spec::get_incident_spec;
use crate::features::incidents::events::{IncidentOpened, NotificationRecorded};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct GetIncident {
    pub(crate) incident_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct IncidentView {
    pub(crate) incident_id: String,
    pub(crate) summary: String,
    pub(crate) opened_at: String,
    pub(crate) notification_id: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct IncidentProjection(BTreeMap<String, IncidentView>);

pub(crate) fn get_incident() -> QuerySlice<GetIncident, IncidentView, IncidentProjection> {
    get_incident_spec()
        .input::<GetIncident>()
        .output::<IncidentView>()
        .state()
        .initialized(IncidentProjection::default())
        .apply::<IncidentOpened, _>(|event, state| {
            state.0.insert(
                event.incident_id.clone(),
                IncidentView {
                    incident_id: event.incident_id.clone(),
                    summary: event.summary.clone(),
                    opened_at: event.opened_at.clone(),
                    notification_id: None,
                },
            );
            Ok(())
        })
        .apply::<NotificationRecorded, _>(|event, state| {
            if let Some(incident) = state.0.get_mut(&event.incident_id) {
                incident.notification_id = Some(event.notification_id.clone());
            }
            Ok(())
        })
        .handle(|input, state| async move {
            state
                .0
                .get(&input.incident_id)
                .cloned()
                .ok_or_else(|| SpecterError::Message("Incident not found".into()))
        })
}
