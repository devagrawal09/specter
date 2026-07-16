use serde_json::json;
use specter::{CommandScenario, CommandSpec, command, event};

pub(super) fn withdraw_spec() -> CommandSpec {
    command("withdraw")
        .description("Withdraws without allowing a wallet to overdraw.")
        .scenarios(vec![
            CommandScenario::accepted(
                "Withdraws from available funds.",
                vec![
                    event("wallet-opened", json!({ "wallet_id": "wallet-1" })),
                    event(
                        "money-deposited",
                        json!({ "wallet_id": "wallet-1", "cents": 10_000 }),
                    ),
                ],
                json!({ "wallet_id": "wallet-1", "cents": 3_500 }),
                vec![event(
                    "money-withdrawn",
                    json!({ "wallet_id": "wallet-1", "cents": 3_500 }),
                )],
            ),
            CommandScenario::accepted(
                "Uses prior withdrawals when making the next decision.",
                vec![
                    event("wallet-opened", json!({ "wallet_id": "wallet-1" })),
                    event(
                        "money-deposited",
                        json!({ "wallet_id": "wallet-1", "cents": 10_000 }),
                    ),
                    event(
                        "money-withdrawn",
                        json!({ "wallet_id": "wallet-1", "cents": 3_500 }),
                    ),
                ],
                json!({ "wallet_id": "wallet-1", "cents": 1_500 }),
                vec![event(
                    "money-withdrawn",
                    json!({ "wallet_id": "wallet-1", "cents": 1_500 }),
                )],
            ),
            CommandScenario::rejected(
                "Rejects an overdraft.",
                vec![
                    event("wallet-opened", json!({ "wallet_id": "wallet-1" })),
                    event(
                        "money-deposited",
                        json!({ "wallet_id": "wallet-1", "cents": 1_000 }),
                    ),
                ],
                json!({ "wallet_id": "wallet-1", "cents": 1_001 }),
                "Insufficient funds",
            ),
        ])
}
