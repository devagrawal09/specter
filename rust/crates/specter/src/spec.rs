use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{CommandScenario, QueryScenario, ReactionScenario, Result};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CommandEnvelope {
    #[serde(rename = "type")]
    pub r#type: String,
    pub payload: Value,
}

impl CommandEnvelope {
    pub fn new(command_type: impl Into<String>, payload: impl Serialize) -> Result<Self> {
        Ok(Self {
            r#type: command_type.into(),
            payload: serde_json::to_value(payload)?,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct QueryEnvelope {
    #[serde(rename = "type")]
    pub r#type: String,
    pub payload: Value,
}

impl QueryEnvelope {
    pub fn new(query_type: impl Into<String>, payload: impl Serialize) -> Result<Self> {
        Ok(Self {
            r#type: query_type.into(),
            payload: serde_json::to_value(payload)?,
        })
    }
}

#[derive(Debug, Clone)]
pub struct CommandSpec {
    pub(crate) name: String,
    pub(crate) description: String,
    pub(crate) scenarios: Vec<CommandScenario>,
}

#[derive(Debug, Clone)]
pub struct QuerySpec {
    pub(crate) name: String,
    pub(crate) description: String,
    pub(crate) scenarios: Vec<QueryScenario>,
}

#[derive(Debug, Clone)]
pub struct ReactionSpec {
    pub(crate) name: String,
    pub(crate) description: String,
    pub(crate) scenarios: Vec<ReactionScenario>,
}

pub struct CommandDescriptionStep {
    name: String,
}

pub struct CommandScenariosStep {
    name: String,
    description: String,
}

pub fn command(name: impl Into<String>) -> CommandDescriptionStep {
    CommandDescriptionStep { name: name.into() }
}

impl CommandDescriptionStep {
    pub fn description(self, description: impl Into<String>) -> CommandScenariosStep {
        CommandScenariosStep {
            name: self.name,
            description: description.into(),
        }
    }
}

impl CommandScenariosStep {
    pub fn scenarios(self, scenarios: Vec<CommandScenario>) -> CommandSpec {
        CommandSpec {
            name: self.name,
            description: self.description,
            scenarios,
        }
    }
}

pub struct QueryDescriptionStep {
    name: String,
}

pub struct QueryScenariosStep {
    name: String,
    description: String,
}

pub fn query(name: impl Into<String>) -> QueryDescriptionStep {
    QueryDescriptionStep { name: name.into() }
}

impl QueryDescriptionStep {
    pub fn description(self, description: impl Into<String>) -> QueryScenariosStep {
        QueryScenariosStep {
            name: self.name,
            description: description.into(),
        }
    }
}

impl QueryScenariosStep {
    pub fn scenarios(self, scenarios: Vec<QueryScenario>) -> QuerySpec {
        QuerySpec {
            name: self.name,
            description: self.description,
            scenarios,
        }
    }
}

pub struct ReactionDescriptionStep {
    name: String,
}

pub struct ReactionScenariosStep {
    name: String,
    description: String,
}

pub fn reaction(name: impl Into<String>) -> ReactionDescriptionStep {
    ReactionDescriptionStep { name: name.into() }
}

impl ReactionDescriptionStep {
    pub fn description(self, description: impl Into<String>) -> ReactionScenariosStep {
        ReactionScenariosStep {
            name: self.name,
            description: description.into(),
        }
    }
}

impl ReactionScenariosStep {
    pub fn scenarios(self, scenarios: Vec<ReactionScenario>) -> ReactionSpec {
        ReactionSpec {
            name: self.name,
            description: self.description,
            scenarios,
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct ScenarioMetadata {
    pub description: String,
    pub given: Vec<crate::ScenarioEvent>,
    pub command_outcome: Vec<crate::ScenarioEvent>,
}

#[derive(Debug, Clone)]
pub(crate) struct SliceMetadata {
    pub name: String,
    pub description: String,
    pub scenarios: Vec<ScenarioMetadata>,
    pub apply_event_types: Vec<&'static str>,
}
