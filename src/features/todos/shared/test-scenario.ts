import { expect, it } from 'vitest'

import { applyEvents, decideCommand, type Command } from '../registry'
import type { ReactionRegistration } from '../registry.builders'
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

class CommandScenarioWithGiven<TGiven extends readonly unknown[]> {
  constructor(
    private readonly label: string,
    private readonly givenValues: TGiven,
  ) {}

  when(command: Command) {
    return new CommandScenarioWithResult(
      this.label,
      this.givenValues,
      ({ db }) => decideCommand(command, db),
    )
  }
}

class ProjectionScenarioWithGiven<TGiven extends readonly unknown[]> {
  constructor(
    private readonly label: string,
    private readonly givenValues: TGiven,
  ) {}

  when<TResult>(step: ScenarioQuery<TGiven, TResult>) {
    return new ProjectionScenarioWithResult(this.label, this.givenValues, step)
  }
}

class ReactionScenarioWithGiven<TGiven extends readonly unknown[]> {
  constructor(
    private readonly label: string,
    private readonly givenValues: TGiven,
  ) {}

  when(registration: ReactionRegistration, event: Event) {
    return new ReactionScenarioWithResult(
      this.label,
      this.givenValues,
      ({ db }) => registration.react(event, db),
    )
  }

  whenLastGivenEvent(registration: ReactionRegistration) {
    return new ReactionScenarioWithResult(
      this.label,
      this.givenValues,
      ({ db }) => {
        const lastEvent = this.givenValues.filter(isEvent).at(-1)

        if (!lastEvent) {
          throw new Error('Expected at least one given event')
        }

        return registration.react(lastEvent, db)
      },
    )
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

class CommandScenarioWithResult<
  TGiven extends readonly unknown[],
  TResult,
> extends ScenarioWithResult<TGiven, TResult> {
  throws(message: string) {
    it(this.label, () =>
      createScenarioRuntime(this.givenValues, ({ db, given }) => {
        expect(() => this.whenStep({ db, given })).toThrow(message)
      }),
    )
  }
}

class ProjectionScenarioWithResult<
  TGiven extends readonly unknown[],
  TResult,
> extends ScenarioWithResult<TGiven, TResult> {}

class ReactionScenarioWithResult<
  TGiven extends readonly unknown[],
  TResult,
> extends ScenarioWithResult<TGiven, TResult> {}

class CommandScenarioWithoutGiven {
  constructor(private readonly label: string) {}

  given<const TGiven extends readonly unknown[]>(...values: TGiven) {
    return new CommandScenarioWithGiven(this.label, values)
  }
}

class ProjectionScenarioWithoutGiven {
  constructor(private readonly label: string) {}

  given<const TGiven extends readonly unknown[]>(...values: TGiven) {
    return new ProjectionScenarioWithGiven(this.label, values)
  }
}

class ReactionScenarioWithoutGiven {
  constructor(private readonly label: string) {}

  given<const TGiven extends readonly unknown[]>(...values: TGiven) {
    return new ReactionScenarioWithGiven(this.label, values)
  }
}

export function commandScenario(label: string) {
  return new CommandScenarioWithoutGiven(label)
}

export function projectionScenario(label: string) {
  return new ProjectionScenarioWithoutGiven(label)
}

export function reactionScenario(label: string) {
  return new ReactionScenarioWithoutGiven(label)
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
