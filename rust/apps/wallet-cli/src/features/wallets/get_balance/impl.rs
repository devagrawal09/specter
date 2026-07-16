use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use specter::{QuerySlice, SpecterError};

use super::spec::get_balance_spec;
use crate::features::wallets::events::{MoneyDeposited, MoneyWithdrawn, WalletOpened};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct GetBalance {
    pub(crate) wallet_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct Balance {
    pub(crate) wallet_id: String,
    pub(crate) cents: i64,
}

pub(crate) fn get_balance() -> QuerySlice<GetBalance, Balance, BTreeMap<String, i64>> {
    get_balance_spec()
        .input::<GetBalance>()
        .output::<Balance>()
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
            let cents = balances
                .get(&input.wallet_id)
                .copied()
                .ok_or_else(|| SpecterError::Message("Wallet not found".into()))?;
            Ok(Balance {
                wallet_id: input.wallet_id,
                cents,
            })
        })
}
