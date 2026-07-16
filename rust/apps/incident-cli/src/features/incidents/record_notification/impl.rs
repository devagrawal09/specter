use serde::{Deserialize, Serialize};
use specter::{CommandSlice, EventDraft};

use super::spec::record_notification_spec;
use crate::features::incidents::events::NotificationRecorded;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct RecordNotification {
    pub(crate) incident_id: String,
    pub(crate) notification_id: String,
    pub(crate) scheduled_at_unix_ms: u128,
}

pub(crate) fn record_notification() -> CommandSlice<RecordNotification, ()> {
    record_notification_spec()
        .input::<RecordNotification>()
        .state()
        .initialized(())
        .handle(|input, ()| async move {
            Ok(vec![EventDraft::new(NotificationRecorded {
                incident_id: input.incident_id,
                notification_id: input.notification_id,
                scheduled_at_unix_ms: input.scheduled_at_unix_ms,
            })?])
        })
}
