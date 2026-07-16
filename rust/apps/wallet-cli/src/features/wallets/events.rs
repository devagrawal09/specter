use serde::{Deserialize, Serialize};
use specter::DomainEvent;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct WalletOpened {
    pub(crate) wallet_id: String,
}

impl DomainEvent for WalletOpened {
    const TYPE: &'static str = "wallet-opened";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct MoneyDeposited {
    pub(crate) wallet_id: String,
    pub(crate) cents: i64,
}

impl DomainEvent for MoneyDeposited {
    const TYPE: &'static str = "money-deposited";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct MoneyWithdrawn {
    pub(crate) wallet_id: String,
    pub(crate) cents: i64,
}

impl DomainEvent for MoneyWithdrawn {
    const TYPE: &'static str = "money-withdrawn";
}
