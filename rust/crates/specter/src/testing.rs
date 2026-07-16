use crate::{Result, SpecterApp};

/// Executes every registered Slice Scenario against a fresh copy of that
/// Slice's private state.
pub async fn assert_scenarios(app: &SpecterApp) -> Result<()> {
    app.assert_scenarios().await
}
