use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use specter::QuerySlice;

use super::spec::list_todos_spec;
use crate::features::todos::events::{TodoAdded, TodoCompleted};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct ListTodos;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct TodoView {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) completed: bool,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct TodoProjection(BTreeMap<String, TodoView>);

pub(crate) fn list_todos() -> QuerySlice<ListTodos, Vec<TodoView>, TodoProjection> {
    list_todos_spec()
        .input::<ListTodos>()
        .output::<Vec<TodoView>>()
        .state()
        .initialized(TodoProjection::default())
        .apply::<TodoAdded, _>(|event, state| {
            state.0.insert(
                event.todo_id.clone(),
                TodoView {
                    id: event.todo_id.clone(),
                    title: event.title.clone(),
                    completed: false,
                },
            );
            Ok(())
        })
        .apply::<TodoCompleted, _>(|event, state| {
            if let Some(todo) = state.0.get_mut(&event.todo_id) {
                todo.completed = true;
            }
            Ok(())
        })
        .handle(|ListTodos, state| async move { Ok(state.0.into_values().collect()) })
}
