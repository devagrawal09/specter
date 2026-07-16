mod features;

use clap::{Parser, Subcommand};
use specter::{CommandOptions, Result};

use features::inventory::{
    INVENTORY_STATUS, InventoryStatus, InventoryStatusInput, RECEIVE_STOCK, RESERVE_STOCK,
    ReceiveStock, ReserveStock, create_app,
};

#[derive(Parser)]
#[command(about = "Inventory CLI built on the Specter Rust 0.3 runtime")]
struct Cli {
    #[command(subcommand)]
    action: Option<Action>,
}

#[derive(Subcommand)]
enum Action {
    /// Demonstrate typed envelopes, durable receipts, and latest-state subscriptions.
    Demo,
    /// Execute every Slice Scenario as a behavior test.
    Verify,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    let app = create_app().await?;

    match cli.action.unwrap_or(Action::Demo) {
        Action::Demo => {
            let sku = "SKU-RED".to_owned();
            let status_input = InventoryStatusInput { sku: sku.clone() };
            let mut status = app.subscribe_to(INVENTORY_STATUS, status_input.clone())?;
            let initial: InventoryStatus = status
                .next_as()
                .await
                .expect("subscription must emit its initial value")?;
            println!(
                "Initial {sku}: available={}, reserved={}",
                initial.available, initial.reserved
            );

            let receive = ReceiveStock {
                sku: sku.clone(),
                quantity: 10,
                receipt_id: "receipt-1".into(),
                received_at: "2026-07-16T14:00:00Z".into(),
            };
            let receive_options = CommandOptions {
                expected_version: Some(0),
                idempotency_key: Some("receive-request-1".into()),
            };
            let receipt = app
                .execute(RECEIVE_STOCK, receive.clone(), receive_options.clone())
                .await?;
            println!(
                "Receive receipt: version={}, events={}, duplicate={}",
                receipt.version,
                receipt.events.len(),
                receipt.duplicate
            );
            receipt.reactions.wait().await?;

            let after_receive: InventoryStatus = status
                .next_as()
                .await
                .expect("subscription must emit committed stock")?;
            println!("After receive: available={}", after_receive.available);

            let duplicate = app.execute(RECEIVE_STOCK, receive, receive_options).await?;
            println!(
                "Duplicate receipt: version={}, events={}, duplicate={}",
                duplicate.version,
                duplicate.events.len(),
                duplicate.duplicate
            );
            duplicate.reactions.wait().await?;

            let reservation = app
                .execute(
                    RESERVE_STOCK,
                    ReserveStock {
                        sku: sku.clone(),
                        quantity: 4,
                        reservation_id: "reservation-1".into(),
                        reserved_at: "2026-07-16T14:05:00Z".into(),
                    },
                    CommandOptions {
                        expected_version: Some(1),
                        idempotency_key: Some("reserve-request-1".into()),
                    },
                )
                .await?;
            println!(
                "Reservation receipt: version={}, events={}, duplicate={}",
                reservation.version,
                reservation.events.len(),
                reservation.duplicate
            );
            reservation.reactions.wait().await?;

            let latest: InventoryStatus = status
                .next_as()
                .await
                .expect("subscription must emit reserved stock")?;
            println!(
                "Latest {sku}: available={}, reserved={}",
                latest.available, latest.reserved
            );
            let queried = app.read(INVENTORY_STATUS, status_input).await?;
            assert_eq!(queried, latest);
            Ok(())
        }
        Action::Verify => {
            app.assert_scenarios().await?;
            println!("All Inventory Slice Scenarios passed.");
            Ok(())
        }
    }
}
