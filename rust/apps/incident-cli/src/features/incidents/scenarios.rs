use specter::{CommandOptions, Result};

use super::{GetIncident, create_app, get_incident_ref, open_incident_ref};
use crate::features::incidents::OpenIncident;

#[tokio::test]
async fn all_slice_scenarios_pass() -> Result<()> {
    create_app().await?.assert_scenarios().await
}

#[tokio::test]
async fn reaction_completion_tracks_follow_up_command() -> Result<()> {
    let app = create_app().await?;
    let execution = app
        .execute(
            open_incident_ref(),
            OpenIncident {
                incident_id: "incident-1".into(),
                summary: "Checkout unavailable".into(),
                opened_at: "2026-07-16T12:00:00Z".into(),
            },
            CommandOptions::default(),
        )
        .await?;

    assert_eq!(execution.events.len(), 1);
    assert_eq!(execution.events[0].event_type, "incident-opened");
    execution.reactions.wait().await?;

    let incident = app
        .read(
            get_incident_ref(),
            GetIncident {
                incident_id: "incident-1".into(),
            },
        )
        .await?;
    assert!(incident.notification_id.is_some());
    Ok(())
}
