use serde::{Deserialize, Serialize};
use specter::DomainEvent;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct TodoAdded {
    pub(crate) todo_id: String,
    pub(crate) title: String,
}

impl DomainEvent for TodoAdded {
    const TYPE: &'static str = "todo-added";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct TodoCompleted {
    pub(crate) todo_id: String,
}

impl DomainEvent for TodoCompleted {
    const TYPE: &'static str = "todo-completed";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct TodoMilestoneRecorded {
    pub(crate) completed_count: usize,
}

impl DomainEvent for TodoMilestoneRecorded {
    const TYPE: &'static str = "todo-milestone-recorded";
}
