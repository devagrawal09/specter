mod features;

use clap::{Parser, Subcommand};
use serde_json::json;
use specter::Result;

use features::wallets::{Balance, Deposit, GetBalance, OpenWallet, Withdraw, create_app};

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

fn dollars(cents: i64) -> String {
    format!("${}.{:02}", cents / 100, cents.unsigned_abs() % 100)
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    let app = create_app().await?;

    match cli.action.unwrap_or(Action::Demo) {
        Action::Demo => {
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
        Action::Verify => {
            app.assert_scenarios().await?;
            println!("All Wallet Slice Scenarios passed.");
            Ok(())
        }
    }
}
