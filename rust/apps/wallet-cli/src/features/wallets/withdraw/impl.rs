use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use specter::{CommandSlice, EventDraft, SpecterError};

use super::spec::withdraw_spec;
use crate::features::wallets::events::{MoneyDeposited, MoneyWithdrawn, WalletOpened};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct Withdraw {
    pub(crate) wallet_id: String,
    pub(crate) cents: i64,
}

pub(crate) fn withdraw() -> CommandSlice<Withdraw, BTreeMap<String, i64>> {
    withdraw_spec()
        .input::<Withdraw>()
        .state()
        .initialized(BTreeMap::new())
        .apply::<WalletOpened, _>(|event, balances| {
            balances.insert(event.wallet_id.clone(), 0);
            Ok(())
        })
        .apply::<MoneyDeposited, _>(|event, balances| {
            *balances.entry(event.wallet_id.clone()).or_default() += event.cents;
            Ok(())
        })
        .apply::<MoneyWithdrawn, _>(|event, balances| {
            *balances.entry(event.wallet_id.clone()).or_default() -= event.cents;
            Ok(())
        })
        .handle(|input, balances| async move {
            let Some(balance) = balances.get(&input.wallet_id) else {
                return Err(SpecterError::rejected("Wallet not found"));
            };
            if input.cents <= 0 {
                return Err(SpecterError::rejected("Withdrawal must be positive"));
            }
            if input.cents > *balance {
                return Err(SpecterError::rejected("Insufficient funds"));
            }
            Ok(vec![EventDraft::new(MoneyWithdrawn {
                wallet_id: input.wallet_id,
                cents: input.cents,
            })?])
        })
}
