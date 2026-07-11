import { testSliceImplementations } from '@specter-ts/core/testing'

import { sqliteScenario } from '../../db/scenario-tests'
import { eventsForSliceImplementations } from '../../testing/scenario-events'
import { specterCodeEventDefinitions } from './registry'
import sessionTodos from './session-todos/impl'
import updateTodoList from './update-todo-list/impl'

const todoRegistrations = [updateTodoList, sessionTodos] as const
const events = eventsForSliceImplementations(
  todoRegistrations,
  specterCodeEventDefinitions,
)

testSliceImplementations(todoRegistrations, {
  events,
  runScenario: sqliteScenario,
})
