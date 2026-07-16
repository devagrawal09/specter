use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use specter::{CommandSlice, EventDraft, SpecterError};

use super::spec::deposit_spec;
use crate::features::wallets::events::{MoneyDeposited, WalletOpened};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct Deposit {
    pub(crate) wallet_id: String,
    pub(crate) cents: i64,
}

pub(crate) fn deposit() -> CommandSlice<Deposit, HashSet<String>> {
    deposit_spec()
        .input::<Deposit>()
        .state()
        .initialized(HashSet::new())
        .apply::<WalletOpened, _>(|event, wallets| {
            wallets.insert(event.wallet_id.clone());
            Ok(())
        })
        .handle(|input, wallets| async move {
            if !wallets.contains(&input.wallet_id) {
                return Err(SpecterError::rejected("Wallet not found"));
            }
            if input.cents <= 0 {
                return Err(SpecterError::rejected("Deposit must be positive"));
            }
            Ok(vec![EventDraft::new(MoneyDeposited {
                wallet_id: input.wallet_id,
                cents: input.cents,
            })?])
        })
}
