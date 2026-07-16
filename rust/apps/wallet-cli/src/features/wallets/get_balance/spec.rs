use serde_json::json;
use specter::{QueryScenario, QuerySpec, event, query};

pub(super) fn get_balance_spec() -> QuerySpec {
    query("get-balance")
        .description("Reads a wallet balance from a private event-derived projection.")
        .scenarios(vec![QueryScenario::new(
            "Returns the balance after deposits and withdrawals.",
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
            json!({ "wallet_id": "wallet-1" }),
            json!({ "wallet_id": "wallet-1", "cents": 6_500 }),
        )])
}
