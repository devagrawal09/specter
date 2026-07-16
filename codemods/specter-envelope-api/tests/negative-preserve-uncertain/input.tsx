import {
  defineSpecterClient,
  type SpecterClient,
} from '@specter-ts/core/client'

declare const app: {
  unknownOperation(input: unknown): unknown
  addTodo(): unknown
  removeTodo(first: unknown, second: unknown): unknown
  command(input: unknown): unknown
}
declare const otherClient: { addTodo(input: unknown): unknown }

type Legacy = SpecterClient<{ readonly slices: readonly [] }>
const client = defineSpecterClient<{ readonly slices: readonly [] }>('/api')

app.unknownOperation({})
app.addTodo()
app.removeTodo({}, {})
app['changeTodoCompletion']({ todoId: 'todo-1', completed: true })
app.command({ type: 'addTodo', payload: {} })
otherClient.addTodo({})
void client
void (undefined as unknown as Legacy)
