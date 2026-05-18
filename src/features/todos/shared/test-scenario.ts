import { it } from 'vitest'

import { applyEvents } from '../registry'
import type { Event } from './index'
import { createTestDb } from './test-db'

type TestDb = ReturnType<typeof createTestDb>

type ScenarioContext<TGiven extends readonly unknown[]> = {
  db: TestDb['db']
  given: TGiven
}

type ScenarioQuery<TGiven extends readonly unknown[], TResult> = (
  context: ScenarioContext<TGiven>,
) => TResult

type ScenarioExpectation<TGiven extends readonly unknown[], TResult> = (
  result: TResult,
  context: ScenarioContext<TGiven>,
) => void

class ProjectionScenarioWithGiven<TGiven extends readonly unknown[]> {
  constructor(
    private readonly label: string,
    private readonly givenValues: TGiven,
  ) {}

  when<TResult>(step: ScenarioQuery<TGiven, TResult>) {
    return new ProjectionScenarioWithResult(this.label, this.givenValues, step)
  }
}

class ScenarioWithResult<TGiven extends readonly unknown[], TResult> {
  constructor(
    protected readonly label: string,
    protected readonly givenValues: TGiven,
    protected readonly whenStep: ScenarioQuery<TGiven, TResult>,
  ) {}

  expect(step: ScenarioExpectation<TGiven, TResult>) {
    it(this.label, () =>
      createScenarioRuntime(
        this.givenValues,
        expectScenarioResult(this.whenStep, step),
      ),
    )
  }
}

class ProjectionScenarioWithResult<
  TGiven extends readonly unknown[],
  TResult,
> extends ScenarioWithResult<TGiven, TResult> {}

class ProjectionScenarioWithoutGiven {
  constructor(private readonly label: string) {}

  given<const TGiven extends readonly unknown[]>(...values: TGiven) {
    return new ProjectionScenarioWithGiven(this.label, values)
  }
}

export function projectionScenario(label: string) {
  return new ProjectionScenarioWithoutGiven(label)
}

function createScenarioRuntime<TGiven extends readonly unknown[]>(
  givenValues: TGiven,
  run: (context: ScenarioContext<TGiven>) => void,
) {
  const { db, sqlite } = createTestDb()
  const context = { db, given: givenValues }

  try {
    applyGivenEvents(givenValues, db)
    run(context)
  } finally {
    sqlite.close()
  }
}

function expectScenarioResult<TGiven extends readonly unknown[], TResult>(
  action: ScenarioQuery<TGiven, TResult>,
  assert: ScenarioExpectation<TGiven, TResult>,
) {
  return (context: ScenarioContext<TGiven>) => {
    const result = action(context)
    assert(result, context)
  }
}

function applyGivenEvents(values: readonly unknown[], db: TestDb['db']) {
  const events = values.filter(isEvent)

  if (events.length > 0) {
    applyEvents(events, db)
  }
}

function isEvent(value: unknown): value is Event {
  if (!value || typeof value !== 'object') {
    return false
  }

  return 'id' in value && 'type' in value && 'payload' in value
}
