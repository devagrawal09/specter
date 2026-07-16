use serde_json::json;
use specter::{CommandScenario, CommandSpec, command, event};

pub(super) fn open_wallet_spec() -> CommandSpec {
    command("openWallet")
        .description("Opens a wallet with a caller-provided domain ID.")
        .scenarios(vec![CommandScenario::accepted(
            "Opens an empty wallet.",
            vec![],
            json!({ "wallet_id": "wallet-1" }),
            vec![event("wallet-opened", json!({ "wallet_id": "wallet-1" }))],
        )])
}
