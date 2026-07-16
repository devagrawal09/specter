import { createSpecterBrowserTransport as makeTransport } from './transport/specter-browser'

const customClient = makeTransport<Config>("/api")

export async function load() {
  return customClient.query({ type: 'todosQuery', payload: { status: "all" } })
}
