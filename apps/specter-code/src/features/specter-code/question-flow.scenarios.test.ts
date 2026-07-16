import { testSliceImplementations } from '@specter-ts/core/testing'

import { sqliteScenario } from '../../db/scenario-tests'
import { eventsForSliceImplementations } from '../../testing/scenario-events'
import { specterCodeEventDefinitions } from './registry'
import askQuestion from './ask-question/impl'
import pendingQuestions from './pending-questions/impl'
import replyQuestion from './reply-question/impl'

const questionRegistrations = [
  askQuestion,
  replyQuestion,
  pendingQuestions,
] as const
const events = eventsForSliceImplementations(
  questionRegistrations,
  specterCodeEventDefinitions,
)

testSliceImplementations(questionRegistrations, {
  events,
  runScenario: sqliteScenario,
})
