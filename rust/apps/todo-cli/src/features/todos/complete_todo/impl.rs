use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use specter::{CommandSlice, EventDraft, SpecterError};

use super::spec::complete_todo_spec;
use crate::features::todos::events::{TodoAdded, TodoCompleted};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct CompleteTodo {
    pub(crate) todo_id: String,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct CompletionState {
    known: HashSet<String>,
    completed: HashSet<String>,
}

pub(crate) fn complete_todo() -> CommandSlice<CompleteTodo, CompletionState> {
    complete_todo_spec()
        .input::<CompleteTodo>()
        .state()
        .initialized(CompletionState::default())
        .apply::<TodoAdded, _>(|event, state| {
            state.known.insert(event.todo_id.clone());
            Ok(())
        })
        .apply::<TodoCompleted, _>(|event, state| {
            state.completed.insert(event.todo_id.clone());
            Ok(())
        })
        .handle(|input, state| async move {
            if !state.known.contains(&input.todo_id) {
                return Err(SpecterError::rejected("Todo not found"));
            }
            if state.completed.contains(&input.todo_id) {
                return Err(SpecterError::rejected("Todo already completed"));
            }
            Ok(vec![EventDraft::new(TodoCompleted {
                todo_id: input.todo_id,
            })?])
        })
}
