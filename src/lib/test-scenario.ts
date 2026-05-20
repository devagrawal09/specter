import { it } from 'vitest'

import { registry } from './registry'
import type { Event } from '../features/events'
import { createTestRuntime } from './test-db'

type TestRuntime = ReturnType<typeof createTestRuntime>

type ScenarioContext<TGiven extends readonly unknown[]> = {
  runtime: TestRuntime['runtime']
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
  const { runtime, sqlite } = createTestRuntime()
  const context = { runtime, given: givenValues }

  try {
    applyGivenEvents(givenValues, runtime)
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

function applyGivenEvents(
  values: readonly unknown[],
  runtime: TestRuntime['runtime'],
) {
  const events = values.filter(isEvent)

  if (events.length > 0) {
    registry.applyEvents(events, runtime)
  }
}

function isEvent(value: unknown): value is Event {
  if (!value || typeof value !== 'object') {
    return false
  }

  return 'id' in value && 'type' in value && 'payload' in value
}
