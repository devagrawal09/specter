use serde::{Deserialize, Serialize};
use specter::{CommandEnvelope, ReactionSlice};

use super::spec::notify_on_open_spec;
use crate::features::incidents::{events::IncidentOpened, record_notification::RecordNotification};

#[derive(Debug, Clone, Default)]
pub(crate) struct NotifyState(Option<String>);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct NotifyIncident {
    incident_id: String,
}

pub(crate) fn notify_on_open() -> ReactionSlice<NotifyIncident, NotifyState> {
    notify_on_open_spec()
        .output::<NotifyIncident>()
        .executor(|effect, context| async move {
            Ok(Some(CommandEnvelope::new(
                "recordNotification",
                RecordNotification {
                    incident_id: effect.incident_id,
                    notification_id: context.delivery_id,
                    scheduled_at_unix_ms: context.scheduled_at_unix_ms,
                },
            )?))
        })
        .state()
        .initialized(NotifyState::default())
        .apply::<IncidentOpened, _>(|event, state| {
            state.0 = Some(event.incident_id.clone());
            Ok(())
        })
        .handle(
            |state| async move { Ok(state.0.map(|incident_id| NotifyIncident { incident_id })) },
        )
}
