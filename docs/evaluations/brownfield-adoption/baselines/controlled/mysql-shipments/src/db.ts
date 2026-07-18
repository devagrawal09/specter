import mysql, { type Pool, type PoolConnection, type RowDataPacket } from "mysql2/promise";
import type { AppConfig } from "./config.js";

export function createPool(config: Pick<AppConfig, "mysqlUrl">): Pool {
  return mysql.createPool({
    uri: config.mysqlUrl,
    connectionLimit: 10,
    waitForConnections: true,
    queueLimit: 50,
    connectTimeout: 3000,
    timezone: "Z",
    decimalNumbers: true
  });
}

export async function inTransaction<T>(pool: Pool, operation: (connection: PoolConnection) => Promise<T>): Promise<T> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await operation(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function pingDatabase(pool: Pool): Promise<void> {
  await pool.query<RowDataPacket[]>("SELECT 1 AS healthy");
}
