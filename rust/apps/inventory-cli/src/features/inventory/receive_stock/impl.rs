use serde::{Deserialize, Serialize};
use specter::{CommandSlice, EventDraft, SpecterError};

use super::spec::receive_stock_spec;
use crate::features::inventory::events::StockReceived;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct ReceiveStock {
    pub(crate) sku: String,
    pub(crate) quantity: u32,
    pub(crate) receipt_id: String,
    pub(crate) received_at: String,
}

pub(crate) fn receive_stock() -> CommandSlice<ReceiveStock, ()> {
    receive_stock_spec()
        .input::<ReceiveStock>()
        .state()
        .initialized(())
        .handle(|input, ()| async move {
            if input.sku.trim().is_empty() {
                return Err(SpecterError::rejected("SKU is required"));
            }
            if input.quantity == 0 {
                return Err(SpecterError::rejected("Quantity must be positive"));
            }
            if input.receipt_id.trim().is_empty() {
                return Err(SpecterError::rejected("Receipt ID is required"));
            }
            if input.received_at.trim().is_empty() {
                return Err(SpecterError::rejected("Received timestamp is required"));
            }

            Ok(vec![EventDraft::new(StockReceived {
                sku: input.sku,
                quantity: input.quantity,
                receipt_id: input.receipt_id,
                received_at: input.received_at,
            })?])
        })
}
