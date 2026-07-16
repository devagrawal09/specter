use serde::{Deserialize, Serialize};
use specter::{CommandSlice, EventDraft};

use super::spec::record_milestone_spec;
use crate::features::todos::events::TodoMilestoneRecorded;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct RecordMilestone {
    pub(crate) completed_count: usize,
}

pub(crate) fn record_milestone() -> CommandSlice<RecordMilestone, ()> {
    record_milestone_spec()
        .input::<RecordMilestone>()
        .state()
        .initialized(())
        .handle(|input, ()| async move {
            Ok(vec![EventDraft::new(TodoMilestoneRecorded {
                completed_count: input.completed_count,
            })?])
        })
}
