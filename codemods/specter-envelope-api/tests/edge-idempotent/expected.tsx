async function alreadyMigrated(
  specterTransport: {
    command(input: unknown): unknown
    query(input: unknown): unknown
    subscribe(input: unknown, options?: unknown): unknown
  },
  signal: AbortSignal,
) {
  await specterTransport.command({ type: 'addTodo', payload: {} })
  await specterTransport.query({ type: 'todosQuery', payload: {} })
  return specterTransport.subscribe(
    { type: 'todosQuery', payload: {} },
    { signal },
  )
}
