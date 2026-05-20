import {
  completeHarlanScriptExecution,
  failHarlanScriptExecution,
} from '../features/harlan/runtime/complete-script-execution/slice'
import { executeHarlanScript } from '../features/harlan/runtime/execute-script/slice'
import { saveHarlanExecutionContextAfterCompletion } from '../features/harlan/runtime/save-execution-context-reaction/slice'
import { saveHarlanExecutionContext } from '../features/harlan/runtime/save-execution-context/slice'
import { addTodo } from '../features/todos-json/add-todo/slice'
import { changeTodoCompletion } from '../features/todos-json/change-todo-completion/slice'
import { createTodoCheer } from '../features/todos-json/create-todo-cheer/slice'
import { removeTodo } from '../features/todos-json/remove-todo/slice'
import { todoCheers } from '../features/todos-json/todo-cheers/slice'
import { todoCompletionCheer } from '../features/todos-json/todo-completion-cheer-reaction/slice'
import { todosProjection } from '../features/todos-json/todos-view/slice'
import { createRegistry } from './registry.runtime'

export const registry = createRegistry([
  addTodo,
  changeTodoCompletion,
  removeTodo,
  createTodoCheer,
  executeHarlanScript,
  completeHarlanScriptExecution,
  failHarlanScriptExecution,
  saveHarlanExecutionContext,
  saveHarlanExecutionContextAfterCompletion,
  todoCompletionCheer,
  todosProjection,
  todoCheers,
])
