import { defineSpecterClient } from '@specter-ts/core/client'

type AppConfig = { readonly slices: readonly [] }

export const specterClient = defineSpecterClient<AppConfig>('/api')

async function run(app: unknown, payload: { todoId: string }) {
  await specterClient.addTodo(payload)
  const todos = await specterClient.todosQuery({ status: 'all' })
  await app.removeTodo({ todoId: payload.todoId })
  return todos
}
