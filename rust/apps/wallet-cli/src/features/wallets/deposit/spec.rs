use serde_json::json;
use specter::{CommandScenario, CommandSpec, command, event};

pub(super) fn deposit_spec() -> CommandSpec {
    command("deposit")
        .description("Deposits a positive amount into an existing wallet.")
        .scenarios(vec![
            CommandScenario::accepted(
                "Deposits money into an open wallet.",
                vec![event("wallet-opened", json!({ "wallet_id": "wallet-1" }))],
                json!({ "wallet_id": "wallet-1", "cents": 10_000 }),
                vec![event(
                    "money-deposited",
                    json!({ "wallet_id": "wallet-1", "cents": 10_000 }),
                )],
            ),
            CommandScenario::rejected(
                "Rejects a deposit into a missing wallet.",
                vec![],
                json!({ "wallet_id": "missing", "cents": 1_000 }),
                "Wallet not found",
            ),
        ])
}
