use serde::{Deserialize, Serialize};
use specter::DomainEvent;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct StockReceived {
    pub(crate) sku: String,
    pub(crate) quantity: u32,
    pub(crate) receipt_id: String,
    pub(crate) received_at: String,
}

impl DomainEvent for StockReceived {
    const TYPE: &'static str = "stock-received";
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct StockReserved {
    pub(crate) sku: String,
    pub(crate) quantity: u32,
    pub(crate) reservation_id: String,
    pub(crate) reserved_at: String,
}

impl DomainEvent for StockReserved {
    const TYPE: &'static str = "stock-reserved";
}
