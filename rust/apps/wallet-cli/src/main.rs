use std::collections::{BTreeMap, HashSet};

use clap::{Parser, Subcommand};
use serde::{Deserialize, Serialize};
use serde_json::json;
use specter::{
    CommandScenario, CommandSlice, DomainEvent, EventDraft, QueryScenario, QuerySlice, Result,
    SpecterApp, SpecterAppBuilder, SpecterError, command, event, query,
};

#[derive(Parser)]
#[command(about = "Wallet app built on the experimental Specter Rust runtime")]
struct Cli {
    #[command(subcommand)]
    action: Option<Action>,
}

#[derive(Subcommand)]
enum Action {
    /// Run deposits, withdrawals, and a rejected overdraft.
    Demo,
    /// Execute every Slice Scenario as a behavior test.
    Verify,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WalletOpened {
    wallet_id: String,
}

impl DomainEvent for WalletOpened {
    const TYPE: &'static str = "wallet-opened";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MoneyDeposited {
    wallet_id: String,
    cents: i64,
}

impl DomainEvent for MoneyDeposited {
    const TYPE: &'static str = "money-deposited";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MoneyWithdrawn {
    wallet_id: String,
    cents: i64,
}

impl DomainEvent for MoneyWithdrawn {
    const TYPE: &'static str = "money-withdrawn";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct OpenWallet {
    wallet_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Deposit {
    wallet_id: String,
    cents: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Withdraw {
    wallet_id: String,
    cents: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct GetBalance {
    wallet_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct Balance {
    wallet_id: String,
    cents: i64,
}

fn open_wallet() -> CommandSlice<OpenWallet, ()> {
    command("open-wallet")
        .description("Opens a wallet with a caller-provided domain ID.")
        .scenarios(vec![CommandScenario::accepted(
            "Opens an empty wallet.",
            vec![],
            OpenWallet {
                wallet_id: "wallet-1".into(),
            },
            vec![event(
                "wallet-opened",
                WalletOpened {
                    wallet_id: "wallet-1".into(),
                },
            )],
        )])
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

fn deposit() -> CommandSlice<Deposit, HashSet<String>> {
    command("deposit")
        .description("Deposits a positive amount into an existing wallet.")
        .scenarios(vec![
            CommandScenario::accepted(
                "Deposits money into an open wallet.",
                vec![event(
                    "wallet-opened",
                    WalletOpened {
                        wallet_id: "wallet-1".into(),
                    },
                )],
                Deposit {
                    wallet_id: "wallet-1".into(),
                    cents: 10_000,
                },
                vec![event(
                    "money-deposited",
                    MoneyDeposited {
                        wallet_id: "wallet-1".into(),
                        cents: 10_000,
                    },
                )],
            ),
            CommandScenario::rejected(
                "Rejects a deposit into a missing wallet.",
                vec![],
                Deposit {
                    wallet_id: "missing".into(),
                    cents: 1_000,
                },
                "Wallet not found",
            ),
        ])
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

fn withdraw() -> CommandSlice<Withdraw, BTreeMap<String, i64>> {
    command("withdraw")
        .description("Withdraws without allowing a wallet to overdraw.")
        .scenarios(vec![
            CommandScenario::accepted(
                "Withdraws from available funds.",
                vec![
                    event(
                        "wallet-opened",
                        WalletOpened {
                            wallet_id: "wallet-1".into(),
                        },
                    ),
                    event(
                        "money-deposited",
                        MoneyDeposited {
                            wallet_id: "wallet-1".into(),
                            cents: 10_000,
                        },
                    ),
                ],
                Withdraw {
                    wallet_id: "wallet-1".into(),
                    cents: 3_500,
                },
                vec![event(
                    "money-withdrawn",
                    MoneyWithdrawn {
                        wallet_id: "wallet-1".into(),
                        cents: 3_500,
                    },
                )],
            ),
            CommandScenario::accepted(
                "Uses prior withdrawals when making the next decision.",
                vec![
                    event(
                        "wallet-opened",
                        WalletOpened {
                            wallet_id: "wallet-1".into(),
                        },
                    ),
                    event(
                        "money-deposited",
                        MoneyDeposited {
                            wallet_id: "wallet-1".into(),
                            cents: 10_000,
                        },
                    ),
                    event(
                        "money-withdrawn",
                        MoneyWithdrawn {
                            wallet_id: "wallet-1".into(),
                            cents: 3_500,
                        },
                    ),
                ],
                Withdraw {
                    wallet_id: "wallet-1".into(),
                    cents: 1_500,
                },
                vec![event(
                    "money-withdrawn",
                    MoneyWithdrawn {
                        wallet_id: "wallet-1".into(),
                        cents: 1_500,
                    },
                )],
            ),
            CommandScenario::rejected(
                "Rejects an overdraft.",
                vec![
                    event(
                        "wallet-opened",
                        WalletOpened {
                            wallet_id: "wallet-1".into(),
                        },
                    ),
                    event(
                        "money-deposited",
                        MoneyDeposited {
                            wallet_id: "wallet-1".into(),
                            cents: 1_000,
                        },
                    ),
                ],
                Withdraw {
                    wallet_id: "wallet-1".into(),
                    cents: 1_001,
                },
                "Insufficient funds",
            ),
        ])
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

fn get_balance() -> QuerySlice<GetBalance, Balance, BTreeMap<String, i64>> {
    query("get-balance")
        .description("Reads a wallet balance from a private event-derived projection.")
        .scenarios(vec![QueryScenario::new(
            "Returns the balance after deposits and withdrawals.",
            vec![
                event(
                    "wallet-opened",
                    WalletOpened {
                        wallet_id: "wallet-1".into(),
                    },
                ),
                event(
                    "money-deposited",
                    MoneyDeposited {
                        wallet_id: "wallet-1".into(),
                        cents: 10_000,
                    },
                ),
                event(
                    "money-withdrawn",
                    MoneyWithdrawn {
                        wallet_id: "wallet-1".into(),
                        cents: 3_500,
                    },
                ),
            ],
            GetBalance {
                wallet_id: "wallet-1".into(),
            },
            Balance {
                wallet_id: "wallet-1".into(),
                cents: 6_500,
            },
        )])
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

async fn create_app() -> Result<SpecterApp> {
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

fn dollars(cents: i64) -> String {
    format!("${}.{:02}", cents / 100, cents.unsigned_abs() % 100)
}

async fn demo(app: SpecterApp) -> Result<()> {
    println!("Wallet CLI — Command Slice decisions use private event-derived state\n");
    let wallet_id = "wallet-1".to_owned();
    app.command_typed(
        "open-wallet",
        OpenWallet {
            wallet_id: wallet_id.clone(),
        },
    )
    .await?;
    app.command_typed(
        "deposit",
        Deposit {
            wallet_id: wallet_id.clone(),
            cents: 10_000,
        },
    )
    .await?;
    app.command_typed(
        "withdraw",
        Withdraw {
            wallet_id: wallet_id.clone(),
            cents: 3_500,
        },
    )
    .await?;

    let rejected = app
        .command_typed(
            "withdraw",
            Withdraw {
                wallet_id: wallet_id.clone(),
                cents: 10_000,
            },
        )
        .await
        .expect_err("the scripted overdraft must be rejected");
    println!("Rejected overdraft: {rejected}");

    let balance: Balance = app
        .query_typed(
            "get-balance",
            GetBalance {
                wallet_id: wallet_id.clone(),
            },
        )
        .await?;
    println!("Balance for {wallet_id}: {}", dollars(balance.cents));

    let history: Vec<_> = app
        .events()
        .await?
        .into_iter()
        .map(|event| {
            json!({
                "order": event.order,
                "type": event.event_type,
                "payload": event.payload,
            })
        })
        .collect();
    println!("\nEvent log:\n{}", serde_json::to_string_pretty(&history)?);
    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    let app = create_app().await?;
    match cli.action.unwrap_or(Action::Demo) {
        Action::Demo => demo(app).await,
        Action::Verify => {
            app.assert_scenarios().await?;
            println!("All Wallet Slice Scenarios passed.");
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn all_slice_scenarios_pass() -> Result<()> {
        create_app().await?.assert_scenarios().await
    }
}
