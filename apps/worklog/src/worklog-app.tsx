import { For, Show, createEffect, createMemo, createSignal } from 'solid-js'

import { runSpecterCommand, specterTransport } from './specter-transport'

type WorklogCommandEnvelope = Parameters<typeof runSpecterCommand>[0]
type WorklogCommandOptions = NonNullable<
  Parameters<typeof runSpecterCommand>[1]
>
type PendingCommand = {
  readonly fingerprint: string
  readonly envelope: WorklogCommandEnvelope
  readonly options: WorklogCommandOptions
}

type TimelineItem = {
  id: string
  eventType: string
  activityAt: string
  title: string
  detail: string
  archived: boolean
  subject: { kind: 'journal' | 'task' | 'topic'; id: string } | null
}
type Task = {
  id: string
  title: string
  notes: string | null
  dueAt: string | null
  createdAt: string
  completed: boolean
  completedAt: string | null
  archived: boolean
}
type Topic = {
  id: string
  name: string
  description: string | null
  createdAt: string
  archived: boolean
  taskCount: number
  completedTaskCount: number
}
type Award = { awardKey: string; reason: string; points: 1; awardedAt: string }
type View = 'timeline' | 'tasks' | 'topics' | 'score'
type CaptureType = 'journal' | 'task' | 'topic'

export function WorklogApp() {
  const [view, setView] = createSignal<View>('timeline')
  const [timeline, setTimeline] = createSignal<TimelineItem[]>([])
  const [tasks, setTasks] = createSignal<Task[]>([])
  const [topics, setTopics] = createSignal<Topic[]>([])
  const [score, setScore] = createSignal<{ total: number; awards: Award[] }>({
    total: 0,
    awards: [],
  })
  const [error, setError] = createSignal<string>()
  const [captureType, setCaptureType] = createSignal<CaptureType>('journal')
  const [captureText, setCaptureText] = createSignal('')
  const [journalAt, setJournalAt] = createSignal(toLocalInput(new Date()))
  const [taskDueAt, setTaskDueAt] = createSignal('')
  const [leftRef, setLeftRef] = createSignal('')
  const [rightRef, setRightRef] = createSignal('')
  const [pendingCapture, setPendingCapture] = createSignal<PendingCommand>()
  const [pendingConnection, setPendingConnection] =
    createSignal<PendingCommand>()
  const [busy, setBusy] = createSignal(false)
  let timelineViewport: HTMLDivElement | undefined
  let followingTimeline = true
  let timelineHasRendered = false

  const openTasks = createMemo(() =>
    tasks().filter((task) => !task.completed && !task.archived),
  )
  const ascendingTimeline = createMemo(() => [...timeline()].reverse())
  const recordOptions = createMemo(() => {
    const journals = timeline()
      .filter(
        (item) =>
          item.eventType === 'journal-entry-added' &&
          item.subject &&
          !item.archived,
      )
      .map((item) => ({
        value: `journal:${item.subject?.id}`,
        label: `Journal · ${truncate(item.detail, 42)}`,
      }))
    return [
      ...journals,
      ...tasks()
        .filter((task) => !task.archived)
        .map((task) => ({
          value: `task:${task.id}`,
          label: `Task · ${task.title}`,
        })),
      ...topics()
        .filter((topic) => !topic.archived)
        .map((topic) => ({
          value: `topic:${topic.id}`,
          label: `Topic · ${topic.name}`,
        })),
    ]
  })

  createEffect(
    () => {},
    () => {
      const controller = new AbortController()
      void subscribeTimeline(controller.signal)
      void subscribeTasks(controller.signal)
      void subscribeTopics(controller.signal)
      void subscribeScore(controller.signal)
      return () => controller.abort()
    },
  )

  createEffect(
    () => timeline().length,
    (itemCount) => {
      if (!itemCount || !timelineViewport) return

      requestAnimationFrame(() => {
        if (!timelineViewport || !followingTimeline) return
        timelineViewport.scrollTo({
          top: timelineViewport.scrollHeight,
          behavior: timelineHasRendered ? 'smooth' : 'auto',
        })
        timelineHasRendered = true
      })
    },
  )

  async function subscribeTimeline(signal: AbortSignal) {
    try {
      for await (const value of specterTransport.subscribe(
        {
          type: 'timelineQuery',
          payload: { includeArchived: false, limit: 200 },
        },
        { signal },
      ))
        setTimeline(value)
    } catch (cause) {
      if (!signal.aborted) setError(errorMessage(cause))
    }
  }
  async function subscribeTasks(signal: AbortSignal) {
    try {
      for await (const value of specterTransport.subscribe(
        { type: 'tasksQuery', payload: { status: 'all', topicId: null } },
        { signal },
      ))
        setTasks(value)
    } catch (cause) {
      if (!signal.aborted) setError(errorMessage(cause))
    }
  }
  async function subscribeTopics(signal: AbortSignal) {
    try {
      for await (const value of specterTransport.subscribe(
        { type: 'topicsQuery', payload: { includeArchived: false } },
        { signal },
      ))
        setTopics(value)
    } catch (cause) {
      if (!signal.aborted) setError(errorMessage(cause))
    }
  }
  async function subscribeScore(signal: AbortSignal) {
    try {
      for await (const value of specterTransport.subscribe(
        { type: 'scoreQuery', payload: { limit: 100 } },
        { signal },
      ))
        setScore(value)
    } catch (cause) {
      if (!signal.aborted) setError(errorMessage(cause))
    }
  }

  async function run(
    envelope: WorklogCommandEnvelope,
    options?: WorklogCommandOptions,
  ) {
    setBusy(true)
    setError()
    try {
      await runSpecterCommand(envelope, options)
      return true
    } catch (cause) {
      setError(errorMessage(cause))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function submitCapture(event: SubmitEvent) {
    event.preventDefault()
    const text = captureText().trim()
    if (!text) return
    const type = captureType()
    const fingerprint = JSON.stringify({
      type,
      text,
      journalAt: type === 'journal' ? journalAt() : null,
      taskDueAt: type === 'task' ? taskDueAt() : null,
    })
    const attempt = retainedCommand(pendingCapture(), fingerprint, () =>
      createCaptureEnvelope(type, text, journalAt(), taskDueAt()),
    )
    setPendingCapture(attempt)
    followingTimeline = true
    const succeeded = await run(attempt.envelope, attempt.options)
    if (succeeded) {
      setPendingCapture()
      setCaptureText('')
      setJournalAt(toLocalInput(new Date()))
      setTaskDueAt('')
    }
  }

  async function connect(event: SubmitEvent) {
    event.preventDefault()
    const left = parseRef(leftRef())
    const right = parseRef(rightRef())
    if (!left || !right) return
    const attempt = retainedCommand(
      pendingConnection(),
      JSON.stringify({ left, right }),
      () => ({
        type: 'connectRecords',
        payload: {
          connectionId: crypto.randomUUID(),
          left,
          right,
          connectedAt: new Date().toISOString(),
        },
      }),
    )
    setPendingConnection(attempt)
    const succeeded = await run(attempt.envelope, attempt.options)
    if (succeeded) {
      setPendingConnection()
      setLeftRef('')
      setRightRef('')
    }
  }

  return (
    <div class="shell">
      <header class="masthead">
        <button
          type="button"
          class="brand"
          onClick={() => setView('timeline')}
          aria-label="Open timeline"
        >
          <span class="brand-mark">W</span>
          <span>
            <strong>Worklog</strong>
            <small>make the work visible</small>
          </span>
        </button>
        <nav aria-label="Primary navigation">
          <For each={['timeline', 'tasks', 'topics', 'score'] as View[]}>
            {(item) => (
              <button
                type="button"
                class={view() === item ? 'active' : ''}
                onClick={() => setView(item)}
              >
                {item}
              </button>
            )}
          </For>
        </nav>
        <button
          type="button"
          class="score-pill"
          onClick={() => setView('score')}
        >
          <span>{score().total}</span> points
        </button>
      </header>

      <Show when={error()}>
        {(message) => (
          <div class="error-banner" role="alert">
            <span>{message()}</span>
            <button type="button" onClick={() => setError()}>
              ×
            </button>
          </div>
        )}
      </Show>

      <main>
        <Show when={view() === 'timeline'}>
          <section class="timeline-section">
            <div class="section-heading">
              <div>
                <p class="eyebrow">Oldest to newest</p>
                <h2>Your work moves upward</h2>
              </div>
              <span>{timeline().length} entries</span>
            </div>
            <div
              class="timeline-viewport"
              role="log"
              aria-label="Work timeline"
              ref={timelineViewport}
              onScroll={(event) => {
                const viewport = event.currentTarget
                followingTimeline =
                  viewport.scrollHeight -
                    viewport.scrollTop -
                    viewport.clientHeight <
                  80
              }}
            >
              <div class="timeline-list">
                <Show
                  when={timeline().length}
                  fallback={
                    <div class="empty-state">
                      <strong>Your timeline is quiet.</strong>
                      <span>Capture the first entry below.</span>
                    </div>
                  }
                >
                  <For each={groupTimeline(ascendingTimeline())}>
                    {(group) => (
                      <div class="day-group">
                        <div class="day-label">{group.label}</div>
                        <div class="day-items">
                          <For each={group.items}>
                            {(item) => <TimelineCard item={item} run={run} />}
                          </For>
                        </div>
                      </div>
                    )}
                  </For>
                </Show>
              </div>
            </div>

            <form class="composer unified-composer" onSubmit={submitCapture}>
              <fieldset class="capture-types">
                <legend>Capture type</legend>
                <For each={['journal', 'task', 'topic'] as CaptureType[]}>
                  {(type) => (
                    <button
                      type="button"
                      aria-pressed={captureType() === type ? 'true' : 'false'}
                      onClick={() => setCaptureType(type)}
                    >
                      <span aria-hidden="true">{captureIcon(type)}</span>
                      {captureLabel(type)}
                    </button>
                  )}
                </For>
              </fieldset>
              <textarea
                aria-label="Capture text"
                aria-keyshortcuts="Meta+Enter"
                placeholder={capturePlaceholder(captureType())}
                value={captureText()}
                onInput={(event) => setCaptureText(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (
                    event.key !== 'Enter' ||
                    !event.metaKey ||
                    event.isComposing ||
                    event.repeat
                  )
                    return

                  event.preventDefault()
                  if (busy() || !captureText().trim()) return
                  event.currentTarget.form?.requestSubmit()
                }}
              />
              <div class="composer-footer">
                <Show
                  when={captureType() === 'journal'}
                  fallback={
                    <Show
                      when={captureType() === 'task'}
                      fallback={
                        <span class="composer-hint">
                          Topics keep related work together.
                        </span>
                      }
                    >
                      <label>
                        Due time{' '}
                        <input
                          type="datetime-local"
                          value={taskDueAt()}
                          onInput={(event) =>
                            setTaskDueAt(event.currentTarget.value)
                          }
                        />
                      </label>
                    </Show>
                  }
                >
                  <label>
                    Activity time{' '}
                    <input
                      type="datetime-local"
                      value={journalAt()}
                      onInput={(event) =>
                        setJournalAt(event.currentTarget.value)
                      }
                    />
                  </label>
                </Show>
                <button
                  type="submit"
                  class="primary"
                  disabled={busy() || !captureText().trim()}
                >
                  Add {captureType()} <span aria-hidden="true">⌘↵</span>
                </button>
              </div>
            </form>
          </section>
        </Show>

        <Show when={view() === 'tasks'}>
          <PageHeading
            eyebrow="One-off tasks"
            title="Things to finish"
            detail={`${openTasks().length} open · ${tasks().filter((task) => task.completed).length} completed`}
          />
          <div class="content-grid">
            <section class="panel">
              <For
                each={tasks()}
                fallback={<div class="empty-state">No tasks yet.</div>}
              >
                {(task) => <TaskRow task={task} run={run} />}
              </For>
            </section>
            <AsideConnect
              options={recordOptions()}
              left={leftRef()}
              right={rightRef()}
              setLeft={setLeftRef}
              setRight={setRightRef}
              submit={connect}
              busy={busy()}
            />
          </div>
        </Show>

        <Show when={view() === 'topics'}>
          <PageHeading
            eyebrow="Connected work"
            title="Topics"
            detail="Complete every task in a topic of three or more for a bonus point."
          />
          <div class="topic-grid">
            <For
              each={topics()}
              fallback={<div class="empty-state">No topics yet.</div>}
            >
              {(topic) => <TopicCard topic={topic} run={run} />}
            </For>
          </div>
        </Show>

        <Show when={view() === 'score'}>
          <PageHeading
            eyebrow="Lifetime score"
            title={`${score().total} points earned`}
            detail="Points are permanent and every award has a reason."
          />
          <section class="ledger panel">
            <For
              each={score().awards}
              fallback={
                <div class="empty-state">
                  Your first point is one journal entry away.
                </div>
              }
            >
              {(award) => (
                <div class="ledger-row">
                  <span class="award-dot">+{award.points}</span>
                  <div>
                    <strong>{reasonLabel(award.reason)}</strong>
                    <small>{award.awardKey}</small>
                  </div>
                  <time>{formatTime(award.awardedAt)}</time>
                </div>
              )}
            </For>
          </section>
        </Show>
      </main>
    </div>
  )
}

function createCaptureEnvelope(
  type: CaptureType,
  text: string,
  journalAt: string,
  taskDueAt: string,
): WorklogCommandEnvelope {
  const createdAt = new Date().toISOString()
  if (type === 'journal')
    return {
      type: 'addJournalEntry',
      payload: {
        journalEntryId: crypto.randomUUID(),
        body: text,
        activityAt: journalAt ? new Date(journalAt).toISOString() : createdAt,
        createdAt,
      },
    }
  if (type === 'task')
    return {
      type: 'addTask',
      payload: {
        taskId: crypto.randomUUID(),
        title: text,
        notes: null,
        dueAt: taskDueAt ? new Date(taskDueAt).toISOString() : null,
        createdAt,
      },
    }
  return {
    type: 'addTopic',
    payload: {
      topicId: crypto.randomUUID(),
      name: text,
      description: null,
      createdAt,
    },
  }
}

function retainedCommand(
  pending: PendingCommand | undefined,
  fingerprint: string,
  createEnvelope: () => WorklogCommandEnvelope,
): PendingCommand {
  if (pending?.fingerprint === fingerprint) return pending
  return {
    fingerprint,
    envelope: createEnvelope(),
    options: { idempotencyKey: crypto.randomUUID() },
  }
}

function captureLabel(type: CaptureType) {
  return type[0]?.toUpperCase() + type.slice(1)
}
function captureIcon(type: CaptureType) {
  return type === 'journal' ? '✦' : type === 'task' ? '✓' : '#'
}
function capturePlaceholder(type: CaptureType) {
  return type === 'journal'
    ? 'I’m working on…'
    : type === 'task'
      ? 'Something to finish…'
      : 'A thread of work…'
}
function TimelineCard(props: {
  item: TimelineItem
  run: (envelope: Parameters<typeof runSpecterCommand>[0]) => Promise<boolean>
}) {
  const icon = () =>
    props.item.eventType === 'journal-entry-added'
      ? '✦'
      : props.item.eventType === 'task-completion-changed'
        ? '✓'
        : props.item.eventType === 'task-added'
          ? '□'
          : props.item.eventType === 'topic-added'
            ? '#'
            : '↗'
  const editJournal = async () => {
    if (props.item.subject?.kind !== 'journal') return
    const body = window.prompt('Edit journal entry', props.item.detail)?.trim()
    if (!body) return
    const now = new Date().toISOString()
    await props.run({
      type: 'editJournalEntry',
      payload: {
        journalEntryId: props.item.subject.id,
        body,
        activityAt: props.item.activityAt,
        editedAt: now,
      },
    })
  }
  return (
    <article class="timeline-card">
      <div class="timeline-icon">{icon()}</div>
      <div class="timeline-copy">
        <div>
          <strong>{props.item.title}</strong>
          <time>{formatTime(props.item.activityAt)}</time>
        </div>
        <p>{props.item.detail}</p>
      </div>
      <Show when={props.item.subject?.kind === 'journal'}>
        <button type="button" class="ghost" onClick={editJournal}>
          Edit
        </button>
      </Show>
    </article>
  )
}

function TaskRow(props: {
  task: Task
  run: (envelope: Parameters<typeof runSpecterCommand>[0]) => Promise<boolean>
}) {
  return (
    <article class={`task-row${props.task.completed ? ' completed' : ''}`}>
      <button
        type="button"
        class="check"
        aria-label={
          props.task.completed
            ? `Reopen ${props.task.title}`
            : `Complete ${props.task.title}`
        }
        onClick={() =>
          props.run({
            type: 'changeTaskCompletion',
            payload: {
              taskId: props.task.id,
              completed: !props.task.completed,
              changedAt: new Date().toISOString(),
            },
          })
        }
      >
        {props.task.completed ? '✓' : ''}
      </button>
      <div>
        <strong>{props.task.title}</strong>
        <small>
          {props.task.dueAt
            ? `Due ${formatTime(props.task.dueAt)}`
            : 'No due date'}
          {props.task.notes ? ` · ${props.task.notes}` : ''}
        </small>
      </div>
      <div class="task-actions">
        <button
          type="button"
          class="ghost"
          onClick={async () => {
            const title = window.prompt('Edit task', props.task.title)?.trim()
            if (title)
              await props.run({
                type: 'editTask',
                payload: {
                  taskId: props.task.id,
                  title,
                  notes: props.task.notes,
                  dueAt: props.task.dueAt,
                  editedAt: new Date().toISOString(),
                },
              })
          }}
        >
          Edit
        </button>
        <button
          type="button"
          class="ghost danger"
          onClick={() =>
            props.run({
              type: 'changeTaskArchived',
              payload: {
                taskId: props.task.id,
                archived: true,
                changedAt: new Date().toISOString(),
              },
            })
          }
        >
          Archive
        </button>
      </div>
    </article>
  )
}

function TopicCard(props: {
  topic: Topic
  run: (envelope: Parameters<typeof runSpecterCommand>[0]) => Promise<boolean>
}) {
  const progress = () =>
    props.topic.taskCount
      ? Math.round(
          (props.topic.completedTaskCount / props.topic.taskCount) * 100,
        )
      : 0
  return (
    <article class="topic-card">
      <div class="topic-top">
        <span>#</span>
        <button
          type="button"
          class="ghost danger"
          onClick={() =>
            props.run({
              type: 'changeTopicArchived',
              payload: {
                topicId: props.topic.id,
                archived: true,
                changedAt: new Date().toISOString(),
              },
            })
          }
        >
          Archive
        </button>
      </div>
      <h2>{props.topic.name}</h2>
      <p>{props.topic.description || 'No description yet.'}</p>
      <div class="progress">
        <span style={{ width: `${progress()}%` }} />
      </div>
      <small>
        {props.topic.completedTaskCount} of {props.topic.taskCount} tasks
        complete
      </small>
    </article>
  )
}

function AsideConnect(props: {
  options: { value: string; label: string }[]
  left: string
  right: string
  setLeft: (value: string) => void
  setRight: (value: string) => void
  submit: (event: SubmitEvent) => void
  busy: boolean
}) {
  return (
    <aside class="panel connect-panel">
      <p class="eyebrow">Create a connection</p>
      <h2>Relate the work</h2>
      <p>
        Connections add context—and another point when their task is complete.
      </p>
      <form onSubmit={props.submit}>
        <select
          aria-label="First record"
          value={props.left}
          onChange={(event) => props.setLeft(event.currentTarget.value)}
        >
          <option value="">First record</option>
          <For each={props.options}>
            {(option) => <option value={option.value}>{option.label}</option>}
          </For>
        </select>
        <select
          aria-label="Second record"
          value={props.right}
          onChange={(event) => props.setRight(event.currentTarget.value)}
        >
          <option value="">Second record</option>
          <For each={props.options}>
            {(option) => <option value={option.value}>{option.label}</option>}
          </For>
        </select>
        <button
          type="submit"
          class="primary"
          disabled={props.busy || !props.left || !props.right}
        >
          Connect records
        </button>
      </form>
    </aside>
  )
}

function PageHeading(props: {
  eyebrow: string
  title: string
  detail: string
}) {
  return (
    <section class="page-heading">
      <p class="eyebrow">{props.eyebrow}</p>
      <h1>{props.title}</h1>
      <p>{props.detail}</p>
    </section>
  )
}

function parseRef(
  value: string,
): { kind: 'journal' | 'task' | 'topic'; id: string } | undefined {
  const [kind, id] = value.split(':')
  return id && (kind === 'journal' || kind === 'task' || kind === 'topic')
    ? { kind, id }
    : undefined
}
function toLocalInput(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}
function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}
function truncate(value: string, length: number) {
  return value.length > length ? `${value.slice(0, length)}…` : value
}
function reasonLabel(reason: string) {
  return (
    (
      {
        'journal-added': 'Journal captured',
        'task-added': 'Task created',
        'topic-added': 'Topic created',
        'connection-added': 'Records connected',
        'task-first-completed': 'Task completed',
        'completed-task-connection': 'Connected task completed',
        'topic-all-tasks-completed': 'Topic milestone completed',
      } as Record<string, string>
    )[reason] ?? reason
  )
}
function groupTimeline(items: TimelineItem[]) {
  const groups = new Map<string, TimelineItem[]>()
  for (const item of items) {
    const key = new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    }).format(new Date(item.activityAt))
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  return [...groups].map(([label, values]) => ({ label, items: values }))
}
function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause)
}
