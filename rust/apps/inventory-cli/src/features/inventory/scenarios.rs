use specter::{CommandOptions, Result, SpecterError};

use super::{
    INVENTORY_STATUS, InventoryStatus, InventoryStatusInput, RECEIVE_STOCK, RESERVE_STOCK,
    ReceiveStock, ReserveStock, create_app,
};

fn receive(quantity: u32) -> ReceiveStock {
    ReceiveStock {
        sku: "SKU-RED".into(),
        quantity,
        receipt_id: "receipt-1".into(),
        received_at: "2026-07-16T14:00:00Z".into(),
    }
}

#[tokio::test]
async fn all_slice_scenarios_pass() -> Result<()> {
    create_app().await?.assert_scenarios().await
}

#[tokio::test]
async fn typed_receipts_are_idempotent_and_enforce_versions() -> Result<()> {
    let app = create_app().await?;
    let options = CommandOptions {
        expected_version: Some(0),
        idempotency_key: Some("receive-request-1".into()),
    };

    let first = app
        .execute(RECEIVE_STOCK, receive(10), options.clone())
        .await?;
    assert_eq!(first.version, 1);
    assert!(!first.duplicate);
    assert_eq!(first.events.len(), 1);
    first.reactions.wait().await?;

    let duplicate = app.execute(RECEIVE_STOCK, receive(10), options).await?;
    assert_eq!(duplicate.version, 1);
    assert!(duplicate.duplicate);
    assert_eq!(duplicate.events.len(), 1);
    duplicate.reactions.wait().await?;

    let reused_key = app
        .execute(
            RECEIVE_STOCK,
            receive(11),
            CommandOptions {
                expected_version: None,
                idempotency_key: Some("receive-request-1".into()),
            },
        )
        .await
        .expect_err("changing a command behind an idempotency key must conflict");
    assert!(matches!(
        reused_key,
        SpecterError::IdempotencyConflict { .. }
    ));

    let stale = app
        .execute(
            RESERVE_STOCK,
            ReserveStock {
                sku: "SKU-RED".into(),
                quantity: 1,
                reservation_id: "reservation-1".into(),
                reserved_at: "2026-07-16T14:05:00Z".into(),
            },
            CommandOptions {
                expected_version: Some(0),
                idempotency_key: Some("reserve-request-1".into()),
            },
        )
        .await
        .expect_err("a stale expected version must conflict");
    assert!(matches!(stale, SpecterError::VersionConflict { .. }));
    Ok(())
}

#[tokio::test]
async fn typed_subscription_emits_initial_and_latest_inventory_state() -> Result<()> {
    let app = create_app().await?;
    let input = InventoryStatusInput {
        sku: "SKU-RED".into(),
    };
    let mut subscription = app.subscribe_to(INVENTORY_STATUS, input.clone())?;

    assert_eq!(
        subscription
            .next_as::<InventoryStatus>()
            .await
            .expect("initial subscription value")?,
        InventoryStatus {
            sku: "SKU-RED".into(),
            available: 0,
            reserved: 0,
        }
    );

    app.execute(
        RECEIVE_STOCK,
        receive(10),
        CommandOptions {
            expected_version: Some(0),
            idempotency_key: Some("receive-request-1".into()),
        },
    )
    .await?
    .reactions
    .wait()
    .await?;

    assert_eq!(
        subscription
            .next_as::<InventoryStatus>()
            .await
            .expect("state after receiving stock")?
            .available,
        10
    );

    app.execute(
        RESERVE_STOCK,
        ReserveStock {
            sku: "SKU-RED".into(),
            quantity: 4,
            reservation_id: "reservation-1".into(),
            reserved_at: "2026-07-16T14:05:00Z".into(),
        },
        CommandOptions {
            expected_version: Some(1),
            idempotency_key: Some("reserve-request-1".into()),
        },
    )
    .await?
    .reactions
    .wait()
    .await?;

    let latest = subscription
        .next_as::<InventoryStatus>()
        .await
        .expect("state after reserving stock")?;
    assert_eq!(latest.available, 6);
    assert_eq!(latest.reserved, 4);
    assert_eq!(app.read(INVENTORY_STATUS, input).await?, latest);
    Ok(())
}
