use serde::{Deserialize, Serialize};
use specter::{CommandSlice, EventDraft, SpecterError};

use super::spec::add_todo_spec;
use crate::features::todos::events::TodoAdded;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct AddTodo {
    pub(crate) todo_id: String,
    pub(crate) title: String,
}

pub(crate) fn add_todo() -> CommandSlice<AddTodo, ()> {
    add_todo_spec()
        .input::<AddTodo>()
        .state()
        .initialized(())
        .handle(|input, ()| async move {
            let title = input.title.trim().to_owned();
            if title.is_empty() {
                return Err(SpecterError::rejected("Todo title is required"));
            }
            Ok(vec![EventDraft::new(TodoAdded {
                todo_id: input.todo_id,
                title,
            })?])
        })
}
