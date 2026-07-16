use serde::{Deserialize, Serialize};
use specter::{CommandSlice, EventDraft, SpecterError};

use super::spec::open_wallet_spec;
use crate::features::wallets::events::WalletOpened;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct OpenWallet {
    pub(crate) wallet_id: String,
}

pub(crate) fn open_wallet() -> CommandSlice<OpenWallet, ()> {
    open_wallet_spec()
        .input::<OpenWallet>()
        .state()
        .initialized(())
        .handle(|input, ()| async move {
            if input.wallet_id.trim().is_empty() {
                return Err(SpecterError::rejected("Wallet ID is required"));
            }
            Ok(vec![EventDraft::new(WalletOpened {
                wallet_id: input.wallet_id,
            })?])
        })
}
