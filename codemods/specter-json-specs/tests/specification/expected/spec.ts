import { createCommandSlice, event } from '@specter-ts/spec'

export const addTodoSpec = createCommandSlice('addTodo')
  .description('Adds a todo.')
  .scenarios({ description: 'Adds one.', given: [], when: {}, expect: [event('added', {})] })

export default addTodoSpec
