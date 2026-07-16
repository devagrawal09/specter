use specter::{CommandRef, QueryRef, Result, SpecterApp, SpecterAppBuilder};

use super::{
    events::{StockReceived, StockReserved},
    inventory_status::inventory_status,
    receive_stock::receive_stock,
    reserve_stock::reserve_stock,
};

pub(crate) use super::{
    inventory_status::{InventoryStatus, InventoryStatusInput},
    receive_stock::ReceiveStock,
    reserve_stock::ReserveStock,
};

pub(crate) const RECEIVE_STOCK: CommandRef<ReceiveStock> = CommandRef::new("receiveStock");
pub(crate) const RESERVE_STOCK: CommandRef<ReserveStock> = CommandRef::new("reserveStock");
pub(crate) const INVENTORY_STATUS: QueryRef<InventoryStatusInput, InventoryStatus> =
    QueryRef::new("inventoryStatus");

pub(crate) async fn create_app() -> Result<SpecterApp> {
    SpecterAppBuilder::new()
        .event::<StockReceived>()
        .event::<StockReserved>()
        .command(receive_stock())
        .command(reserve_stock())
        .query(inventory_status())
        .build()
        .await
}
