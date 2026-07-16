use serde_json::json;
use specter::{CommandScenario, CommandSpec, command, event};

pub(super) fn receive_stock_spec() -> CommandSpec {
    command("receiveStock")
        .description("Records caller-identified stock arriving at the warehouse.")
        .scenarios(vec![CommandScenario::accepted(
            "Records an incoming shipment with its initiating timestamp.",
            vec![],
            json!({
                "sku": "SKU-RED",
                "quantity": 10,
                "receipt_id": "receipt-1",
                "received_at": "2026-07-16T14:00:00Z"
            }),
            vec![event(
                "stock-received",
                json!({
                    "sku": "SKU-RED",
                    "quantity": 10,
                    "receipt_id": "receipt-1",
                    "received_at": "2026-07-16T14:00:00Z"
                }),
            )],
        )])
}
