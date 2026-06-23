import { testScenarios } from '@specter-ts/core/testing'

import { sqliteScenario } from '../../db/scenario-tests'
import askQuestion from './ask-question/slice'
import pendingQuestions from './pending-questions/slice'
import replyQuestion from './reply-question/slice'

const questionRegistrations = [askQuestion, replyQuestion, pendingQuestions] as const

testScenarios(questionRegistrations, {
  runScenario: sqliteScenario,
})
