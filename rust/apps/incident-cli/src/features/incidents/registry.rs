use specter::{CommandRef, QueryRef, Result, SpecterApp, SpecterAppBuilder};

use super::{
    events::{IncidentOpened, NotificationRecorded},
    get_incident::get_incident,
    notify_on_open::notify_on_open,
    open_incident::open_incident,
    record_notification::record_notification,
};

pub(crate) use super::{
    get_incident::{GetIncident, IncidentView},
    open_incident::OpenIncident,
};

pub(crate) fn open_incident_ref() -> CommandRef<OpenIncident> {
    CommandRef::new("openIncident")
}

pub(crate) fn get_incident_ref() -> QueryRef<GetIncident, IncidentView> {
    QueryRef::new("getIncident")
}

pub(crate) async fn create_app() -> Result<SpecterApp> {
    SpecterAppBuilder::new()
        .event::<IncidentOpened>()
        .event::<NotificationRecorded>()
        .command(open_incident())
        .command(record_notification())
        .query(get_incident())
        .reaction(notify_on_open())
        .build()
        .await
}
