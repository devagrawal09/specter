import { defineSpecterClient as makeTransport } from "@specter-ts/core/client"

const customClient = makeTransport<Config>("/api")

export async function load() {
  return customClient.todosQuery({ status: "all" })
}
