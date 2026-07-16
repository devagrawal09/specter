use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use specter::QuerySlice;

use super::spec::inventory_status_spec;
use crate::features::inventory::events::{StockReceived, StockReserved};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct InventoryStatusInput {
    pub(crate) sku: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct InventoryStatus {
    pub(crate) sku: String,
    pub(crate) available: u32,
    pub(crate) reserved: u32,
}

#[derive(Debug, Clone, Default)]
pub(in crate::features::inventory) struct InventoryProjection {
    received: u32,
    reserved: u32,
}

pub(in crate::features::inventory) fn inventory_status()
-> QuerySlice<InventoryStatusInput, InventoryStatus, BTreeMap<String, InventoryProjection>> {
    inventory_status_spec()
        .input::<InventoryStatusInput>()
        .output::<InventoryStatus>()
        .state()
        .initialized(BTreeMap::<String, InventoryProjection>::new())
        .apply::<StockReceived, _>(|event, inventory| {
            let projection = inventory.entry(event.sku.clone()).or_default();
            projection.received =
                projection
                    .received
                    .checked_add(event.quantity)
                    .ok_or_else(|| {
                        specter::SpecterError::Message(format!(
                            "received-stock projection overflow for SKU {:?}",
                            event.sku
                        ))
                    })?;
            Ok(())
        })
        .apply::<StockReserved, _>(|event, inventory| {
            let projection = inventory.entry(event.sku.clone()).or_default();
            let reserved = projection
                .reserved
                .checked_add(event.quantity)
                .filter(|reserved| *reserved <= projection.received)
                .ok_or_else(|| {
                    specter::SpecterError::Message(format!(
                        "reserved-stock projection exceeds received stock for SKU {:?}",
                        event.sku
                    ))
                })?;
            projection.reserved = reserved;
            Ok(())
        })
        .handle(|input, inventory| async move {
            let projection = inventory.get(&input.sku).cloned().unwrap_or_default();
            Ok(InventoryStatus {
                sku: input.sku,
                available: projection.received - projection.reserved,
                reserved: projection.reserved,
            })
        })
}
