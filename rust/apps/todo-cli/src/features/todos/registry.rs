use specter::{Result, SpecterApp, SpecterAppBuilder};

use super::{
    add_todo::add_todo,
    celebrate_milestone::celebrate_milestone,
    complete_todo::complete_todo,
    events::{TodoAdded, TodoCompleted, TodoMilestoneRecorded},
    list_todos::list_todos,
    record_milestone::record_milestone,
};

pub(crate) use super::{
    add_todo::AddTodo,
    complete_todo::CompleteTodo,
    list_todos::{ListTodos, TodoView},
};

pub(crate) async fn create_app() -> Result<SpecterApp> {
    SpecterAppBuilder::new()
        .event::<TodoAdded>()
        .event::<TodoCompleted>()
        .event::<TodoMilestoneRecorded>()
        .command(add_todo())
        .command(complete_todo())
        .command(record_milestone())
        .query(list_todos())
        .reaction(celebrate_milestone())
        .build()
        .await
}
