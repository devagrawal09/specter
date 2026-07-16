use specter::{Result, SpecterApp, SpecterAppBuilder};

use super::{
    deposit::deposit,
    events::{MoneyDeposited, MoneyWithdrawn, WalletOpened},
    get_balance::get_balance,
    open_wallet::open_wallet,
    withdraw::withdraw,
};

pub(crate) use super::{
    deposit::Deposit,
    get_balance::{Balance, GetBalance},
    open_wallet::OpenWallet,
    withdraw::Withdraw,
};

pub(crate) async fn create_app() -> Result<SpecterApp> {
    SpecterAppBuilder::new()
        .event::<WalletOpened>()
        .event::<MoneyDeposited>()
        .event::<MoneyWithdrawn>()
        .command(open_wallet())
        .command(deposit())
        .command(withdraw())
        .query(get_balance())
        .build()
        .await
}
