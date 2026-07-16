use specter::Result;

use super::create_app;

#[tokio::test]
async fn all_slice_scenarios_pass() -> Result<()> {
    create_app().await?.assert_scenarios().await
}
