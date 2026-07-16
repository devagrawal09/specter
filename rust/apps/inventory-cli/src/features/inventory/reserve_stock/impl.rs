use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use specter::{CommandSlice, EventDraft, SpecterError};

use super::spec::reserve_stock_spec;
use crate::features::inventory::events::{StockReceived, StockReserved};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct ReserveStock {
    pub(crate) sku: String,
    pub(crate) quantity: u32,
    pub(crate) reservation_id: String,
    pub(crate) reserved_at: String,
}

pub(crate) fn reserve_stock() -> CommandSlice<ReserveStock, BTreeMap<String, u32>> {
    reserve_stock_spec()
        .input::<ReserveStock>()
        .state()
        .initialized(BTreeMap::<String, u32>::new())
        .apply::<StockReceived, _>(|event, available| {
            let remaining = available.entry(event.sku.clone()).or_default();
            *remaining = remaining.checked_add(event.quantity).ok_or_else(|| {
                SpecterError::Message(format!(
                    "available-stock projection overflow for SKU {:?}",
                    event.sku
                ))
            })?;
            Ok(())
        })
        .apply::<StockReserved, _>(|event, available| {
            let remaining = available.entry(event.sku.clone()).or_default();
            *remaining = remaining.checked_sub(event.quantity).ok_or_else(|| {
                SpecterError::Message(format!(
                    "stock projection underflow for SKU {:?}",
                    event.sku
                ))
            })?;
            Ok(())
        })
        .handle(|input, available| async move {
            if input.sku.trim().is_empty() {
                return Err(SpecterError::rejected("SKU is required"));
            }
            if input.quantity == 0 {
                return Err(SpecterError::rejected("Quantity must be positive"));
            }
            if input.reservation_id.trim().is_empty() {
                return Err(SpecterError::rejected("Reservation ID is required"));
            }
            if input.reserved_at.trim().is_empty() {
                return Err(SpecterError::rejected("Reserved timestamp is required"));
            }

            let remaining = available.get(&input.sku).copied().unwrap_or_default();
            if input.quantity > remaining {
                return Err(SpecterError::rejected(format!(
                    "Insufficient stock: requested {}, available {remaining}",
                    input.quantity
                )));
            }

            Ok(vec![EventDraft::new(StockReserved {
                sku: input.sku,
                quantity: input.quantity,
                reservation_id: input.reservation_id,
                reserved_at: input.reserved_at,
            })?])
        })
}
