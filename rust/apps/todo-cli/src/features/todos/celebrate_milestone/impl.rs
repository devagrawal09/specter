use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use specter::{CommandEnvelope, ReactionSlice};

use super::spec::celebrate_milestone_spec;
use crate::features::todos::{
    events::{TodoCompleted, TodoMilestoneRecorded},
    record_milestone::RecordMilestone,
};

#[derive(Debug, Clone, Default)]
pub(crate) struct MilestoneState {
    completed: HashSet<String>,
    recorded: HashSet<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct CelebrateMilestone {
    completed_count: usize,
}

pub(crate) fn celebrate_milestone() -> ReactionSlice<CelebrateMilestone, MilestoneState> {
    celebrate_milestone_spec()
        .output::<CelebrateMilestone>()
        .executor(|effect, _context| async move {
            Ok(Some(CommandEnvelope::new(
                "recordTodoMilestone",
                RecordMilestone {
                    completed_count: effect.completed_count,
                },
            )?))
        })
        .state()
        .initialized(MilestoneState::default())
        .apply::<TodoCompleted, _>(|event, state| {
            state.completed.insert(event.todo_id.clone());
            Ok(())
        })
        .apply::<TodoMilestoneRecorded, _>(|event, state| {
            state.recorded.insert(event.completed_count);
            Ok(())
        })
        .handle(|state| async move {
            let completed_count = state.completed.len();
            if completed_count > 0
                && completed_count % 3 == 0
                && !state.recorded.contains(&completed_count)
            {
                Ok(Some(CelebrateMilestone { completed_count }))
            } else {
                Ok(None)
            }
        })
}
