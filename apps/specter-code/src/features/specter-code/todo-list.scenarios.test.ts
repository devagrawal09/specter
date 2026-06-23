import { testScenarios } from '@specter-ts/core/testing'

import { sqliteScenario } from '../../db/scenario-tests'
import sessionTodos from './session-todos/slice'
import updateTodoList from './update-todo-list/slice'

const todoRegistrations = [updateTodoList, sessionTodos] as const

testScenarios(todoRegistrations, {
  runScenario: sqliteScenario,
})
