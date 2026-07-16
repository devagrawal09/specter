async function watch(app: unknown, signal: AbortSignal) {
  for await (const todos of app.subscribe.todosQuery(
    {
      // Preserve the selected status.
      status: 'active',
    },
    { signal },
  )) {
    console.log(todos)
  }

  return app.todoCheers({})
}
