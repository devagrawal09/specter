use serde_json::json;
use specter::{CommandScenario, CommandSpec, command, event};

pub(super) fn reserve_stock_spec() -> CommandSpec {
    command("reserveStock")
        .description("Reserves available inventory for a caller-provided reservation.")
        .scenarios(vec![
            CommandScenario::accepted(
                "Reserves inventory when enough stock is available.",
                vec![event(
                    "stock-received",
                    json!({
                        "sku": "SKU-RED",
                        "quantity": 10,
                        "receipt_id": "receipt-1",
                        "received_at": "2026-07-16T14:00:00Z"
                    }),
                )],
                json!({
                    "sku": "SKU-RED",
                    "quantity": 4,
                    "reservation_id": "reservation-1",
                    "reserved_at": "2026-07-16T14:05:00Z"
                }),
                vec![event(
                    "stock-reserved",
                    json!({
                        "sku": "SKU-RED",
                        "quantity": 4,
                        "reservation_id": "reservation-1",
                        "reserved_at": "2026-07-16T14:05:00Z"
                    }),
                )],
            ),
            CommandScenario::rejected(
                "Rejects a reservation larger than the remaining inventory.",
                vec![
                    event(
                        "stock-received",
                        json!({
                            "sku": "SKU-RED",
                            "quantity": 5,
                            "receipt_id": "receipt-1",
                            "received_at": "2026-07-16T14:00:00Z"
                        }),
                    ),
                    event(
                        "stock-reserved",
                        json!({
                            "sku": "SKU-RED",
                            "quantity": 3,
                            "reservation_id": "reservation-1",
                            "reserved_at": "2026-07-16T14:05:00Z"
                        }),
                    ),
                ],
                json!({
                    "sku": "SKU-RED",
                    "quantity": 4,
                    "reservation_id": "reservation-2",
                    "reserved_at": "2026-07-16T14:10:00Z"
                }),
                "Insufficient stock: requested 4, available 2",
            ),
        ])
}
