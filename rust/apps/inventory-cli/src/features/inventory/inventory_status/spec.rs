use serde_json::json;
use specter::{QueryScenario, QuerySpec, event, query};

pub(super) fn inventory_status_spec() -> QuerySpec {
    query("inventoryStatus")
        .description("Returns the latest available and reserved quantities for one SKU.")
        .scenarios(vec![QueryScenario::new(
            "Reports inventory after receiving and reserving stock.",
            vec![
                event(
                    "stock-received",
                    json!({
                        "sku": "SKU-RED",
                        "quantity": 10,
                        "receipt_id": "receipt-1",
                        "received_at": "2026-07-16T14:00:00Z"
                    }),
                ),
                event(
                    "stock-reserved",
                    json!({
                        "sku": "SKU-RED",
                        "quantity": 4,
                        "reservation_id": "reservation-1",
                        "reserved_at": "2026-07-16T14:05:00Z"
                    }),
                ),
            ],
            json!({ "sku": "SKU-RED" }),
            json!({ "sku": "SKU-RED", "available": 6, "reserved": 4 }),
        )])
}
