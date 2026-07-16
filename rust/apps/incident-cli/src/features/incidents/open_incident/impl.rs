use serde::{Deserialize, Serialize};
use specter::{CommandSlice, EventDraft};

use super::spec::open_incident_spec;
use crate::features::incidents::events::IncidentOpened;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct OpenIncident {
    pub(crate) incident_id: String,
    pub(crate) summary: String,
    pub(crate) opened_at: String,
}

pub(crate) fn open_incident() -> CommandSlice<OpenIncident, ()> {
    open_incident_spec()
        .input::<OpenIncident>()
        .state()
        .initialized(())
        .handle(|input, ()| async move {
            Ok(vec![EventDraft::new(IncidentOpened {
                incident_id: input.incident_id,
                summary: input.summary,
                opened_at: input.opened_at,
            })?])
        })
}
