import { createSpecterBrowserTransport } from './transport/specter-browser'

type AppConfig = { readonly slices: readonly [] }

export const specterClient = createSpecterBrowserTransport<AppConfig>('/api')

async function run(app: unknown, payload: { todoId: string }) {
  await specterClient.command({ type: 'addTodo', payload: payload })
  const todos = await specterClient.query({ type: 'todosQuery', payload: { status: 'all' } })
  await app.command({ type: 'removeTodo', payload: { todoId: payload.todoId } })
  return todos
}
