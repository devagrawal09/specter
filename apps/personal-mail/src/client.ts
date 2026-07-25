import './styles.css'

type Status = {
  connected: boolean
  email: string | null
  accessMode: 'local' | 'tailscale'
  localModel: string
  cloudConfigured: boolean
}

type Thread = {
  threadId: string
  sender: string
  subject: string
  snippet: string
  bodyText: string
  receivedAt: string
  unread: boolean
  labels: string[]
  analysis: null | {
    provider: 'local' | 'cloud'
    summary: string
    priority: 'low' | 'normal' | 'high'
    suggestedAction: string
  }
}

type Rule = {
  ruleId: string
  name: string
  senderContains: string
  subjectContains: string
  action: string
  enabled: boolean
}

type Activity = {
  activityId: string
  threadId: string
  kind: 'analysis' | 'mailboxAction'
  status: string
  detail: string
  occurredAt: string
}

type DeliveryFailure = {
  jobId: string
  kind: 'analysis' | 'mailboxAction'
  referenceId: string
  threadId: string
  detail: string
  attemptCount: number
  lastError: string
}

const root = document.querySelector<HTMLDivElement>('#app')
if (!root) throw new Error('Missing app root')

root.replaceChildren()
root.append(buildShell())
void refreshAll()

function buildShell() {
  const main = element('main', 'shell')
  const header = element('header', 'topbar')
  const brand = element('div')
  brand.append(
    element('p', 'eyebrow', 'PRIVATE · LOCAL-FIRST'),
    element('h1', '', 'Personal Mail'),
  )
  const controls = element('div', 'top-actions')
  const connection = element('span', 'connection', 'Checking Gmail…')
  connection.id = 'connection'
  const connect = button('Connect Gmail', 'secondary')
  connect.id = 'connect'
  connect.addEventListener('click', () => location.assign('/auth/google/start'))
  const sync = button('Sync now', 'primary')
  sync.id = 'sync'
  sync.addEventListener('click', () => void synchronize(sync))
  controls.append(connection, connect, sync)
  header.append(brand, controls)

  const notice = element('section', 'privacy-note')
  const noticeText = element('div')
  noticeText.append(
    element('strong', '', 'Your mail stays on this Mac.'),
    document.createTextNode(
      ' Local AI is the default. Cloud analysis is a one-message decision every time.',
    ),
  )
  const model = element('span', 'model-chip', 'Local model')
  model.id = 'model'
  notice.append(noticeText, model)

  const content = element('div', 'content-grid')
  const inbox = element('section', 'panel inbox-panel')
  const inboxHeader = element('div', 'panel-header')
  const inboxTitle = element('div')
  inboxTitle.append(
    element('h2', '', 'Inbox intelligence'),
    element('p', 'muted', 'Gmail facts with local AI context'),
  )
  const search = document.createElement('input')
  search.id = 'search'
  search.type = 'search'
  search.placeholder = 'Search sender or subject'
  search.addEventListener(
    'input',
    debounce(() => void refreshInbox(), 250),
  )
  inboxHeader.append(inboxTitle, search)
  const list = element('div', 'thread-list')
  list.id = 'threads'
  inbox.append(inboxHeader, list)

  const rail = element('aside', 'rail')
  rail.append(buildRulePanel(), buildDeliveryPanel(), buildActivityPanel())
  content.append(inbox, rail)
  main.append(header, notice, content)
  return main
}

function buildRulePanel() {
  const panel = element('section', 'panel')
  panel.append(
    element('h2', '', 'Automation authority'),
    element('p', 'muted', 'Only matching rules may act automatically.'),
  )
  const form = document.createElement('form')
  form.id = 'rule-form'
  form.className = 'rule-form'
  const name = input('Rule name', 'name')
  name.required = true
  const sender = input('Sender contains', 'senderContains')
  const subject = input('Subject contains', 'subjectContains')
  const action = document.createElement('select')
  action.name = 'action'
  for (const [value, label] of [
    ['archive', 'Archive'],
    ['markRead', 'Mark read'],
    ['star', 'Star'],
  ]) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = label
    action.append(option)
  }
  const grant = button('Grant rule', 'primary')
  grant.type = 'submit'
  form.append(name, sender, subject, action, grant)
  form.addEventListener('submit', (event) => void createRule(event, form))
  const rules = element('div', 'rule-list')
  rules.id = 'rules'
  panel.append(form, rules)
  return panel
}

function buildActivityPanel() {
  const panel = element('section', 'panel')
  panel.append(
    element('h2', '', 'Audit trail'),
    element(
      'p',
      'muted',
      'Requested, applied, failed, or needs reconciliation.',
    ),
  )
  const activity = element('div', 'activity-list')
  activity.id = 'activity'
  panel.append(activity)
  return panel
}

function buildDeliveryPanel() {
  const panel = element('section', 'panel')
  panel.append(
    element('h2', '', 'Delivery recovery'),
    element('p', 'muted', 'Failed provider work can be retried explicitly.'),
  )
  const deliveries = element('div', 'delivery-list')
  deliveries.id = 'delivery-failures'
  panel.append(deliveries)
  return panel
}

async function refreshAll() {
  await refreshStatus()
  await Promise.all([
    refreshInbox(),
    refreshRules(),
    refreshDeliveries(),
    refreshActivity(),
  ])
}

async function refreshStatus() {
  const status = await api<Status>('/api/status')
  text(
    '#connection',
    status.connected
      ? (status.email ?? 'Gmail connected')
      : 'Gmail not connected',
  )
  text('#model', `Local · ${status.localModel}`)
  const connect = document.querySelector<HTMLButtonElement>('#connect')
  const sync = document.querySelector<HTMLButtonElement>('#sync')
  if (connect) connect.hidden = status.connected
  if (sync) sync.disabled = !status.connected
  document.body.dataset.cloudConfigured = String(status.cloudConfigured)
}

async function refreshInbox() {
  const search =
    document.querySelector<HTMLInputElement>('#search')?.value ?? ''
  const threads = await api<Thread[]>(
    `/api/inbox?search=${encodeURIComponent(search)}`,
  )
  const list = document.querySelector<HTMLDivElement>('#threads')
  if (!list) return
  list.replaceChildren()
  if (threads.length === 0) {
    list.append(
      element('p', 'empty', 'No indexed threads. Connect Gmail, then sync.'),
    )
    return
  }
  for (const thread of threads) list.append(renderThread(thread))
}

function renderThread(thread: Thread) {
  const article = element('article', `thread ${thread.unread ? 'unread' : ''}`)
  const heading = element('div', 'thread-heading')
  const sender = element(
    'strong',
    'sender',
    thread.sender || '(unknown sender)',
  )
  const time = element('time', '', formatDate(thread.receivedAt))
  heading.append(sender, time)
  const subject = element('h3', '', thread.subject)
  const snippet = element('p', 'snippet', thread.snippet)
  const analysis = element(
    'div',
    `analysis ${thread.analysis?.priority ?? 'none'}`,
  )
  if (thread.analysis) {
    analysis.append(
      element(
        'span',
        'analysis-label',
        `${thread.analysis.provider} · ${thread.analysis.priority}`,
      ),
      element('p', '', thread.analysis.summary),
      element('small', '', `Suggested: ${thread.analysis.suggestedAction}`),
    )
  } else {
    analysis.append(
      element('p', 'muted', 'Analysis queued or not yet requested.'),
    )
  }
  const actions = element('div', 'thread-actions')
  for (const [action, label] of [
    ['archive', 'Archive'],
    ['markRead', 'Read'],
    ['star', 'Star'],
  ] as const) {
    const control = button(label, 'quiet')
    control.addEventListener(
      'click',
      () => void mailboxAction(thread.threadId, action, control),
    )
    actions.append(control)
  }
  const local = button('Analyze local', 'secondary')
  local.addEventListener(
    'click',
    () => void analyze(thread.threadId, 'local', false, local),
  )
  const cloud = button('Use cloud once', 'danger-quiet')
  if (document.body.dataset.cloudConfigured !== 'true') {
    cloud.disabled = true
    cloud.title =
      'Configure AI_CLOUD_BASE_URL, AI_CLOUD_MODEL, and AI_CLOUD_API_KEY first.'
  }
  cloud.addEventListener('click', () => {
    const approved = window.confirm(
      'Send this one email body to your configured cloud AI provider? This consent applies only to this analysis.',
    )
    if (approved) void analyze(thread.threadId, 'cloud', true, cloud)
  })
  actions.append(local, cloud)
  article.append(heading, subject, snippet, analysis, actions)
  return article
}

async function refreshRules() {
  const rules = await api<Rule[]>('/api/rules')
  const target = document.querySelector<HTMLDivElement>('#rules')
  if (!target) return
  target.replaceChildren()
  for (const rule of rules) {
    const item = element('div', `rule ${rule.enabled ? '' : 'disabled'}`)
    const control = button(rule.enabled ? 'Disable' : 'Enable', 'quiet')
    control.addEventListener(
      'click',
      () => void changeRuleEnabled(rule, control),
    )
    item.append(
      element('strong', '', rule.name),
      element(
        'small',
        '',
        `${rule.enabled ? 'Enabled' : 'Disabled'} · ${rule.action} · ${rule.senderContains || 'any sender'} · ${rule.subjectContains || 'any subject'}`,
      ),
      control,
    )
    target.append(item)
  }
}

async function refreshActivity() {
  const activities = await api<Activity[]>('/api/activity')
  const target = document.querySelector<HTMLDivElement>('#activity')
  if (!target) return
  target.replaceChildren()
  for (const activity of activities) {
    const item = element('div', `activity ${activity.status}`)
    item.append(
      element('span', 'status-dot'),
      element('div', '', activity.detail),
      element('time', '', formatDate(activity.occurredAt)),
    )
    target.append(item)
  }
}

async function refreshDeliveries() {
  const deliveries = await api<DeliveryFailure[]>('/api/deliveries/dead-letter')
  const target = document.querySelector<HTMLDivElement>('#delivery-failures')
  if (!target) return
  target.replaceChildren()
  if (deliveries.length === 0) {
    target.append(element('p', 'empty', 'No failed deliveries.'))
    return
  }
  for (const delivery of deliveries) {
    const item = element('div', 'delivery-failure')
    const retry = button('Retry', 'quiet')
    retry.addEventListener('click', () => void retryDelivery(delivery, retry))
    item.append(
      element('strong', '', delivery.detail),
      element(
        'small',
        '',
        `${delivery.attemptCount} attempts · ${delivery.lastError}`,
      ),
      retry,
    )
    target.append(item)
  }
}

async function synchronize(control: HTMLButtonElement) {
  await withBusy(control, 'Syncing…', async () => {
    const result = await api<{ imported: number; automations: number }>(
      '/api/sync',
      { method: 'POST' },
    )
    notify(
      `Imported ${result.imported} changed threads; scheduled ${result.automations} authorized actions.`,
    )
    await refreshAll()
  })
}

async function analyze(
  threadId: string,
  provider: 'local' | 'cloud',
  cloudOptIn: boolean,
  control: HTMLButtonElement,
) {
  await withBusy(control, 'Queued…', async () => {
    await api('/api/analyze', {
      method: 'POST',
      body: JSON.stringify({ threadId, provider, cloudOptIn }),
    })
    notify(
      `${provider === 'local' ? 'Local' : 'One-time cloud'} analysis queued.`,
    )
    window.setTimeout(
      () => void Promise.all([refreshInbox(), refreshActivity()]),
      900,
    )
  })
}

async function mailboxAction(
  threadId: string,
  action: 'archive' | 'markRead' | 'star',
  control: HTMLButtonElement,
) {
  await withBusy(control, 'Queued…', async () => {
    await api('/api/actions', {
      method: 'POST',
      body: JSON.stringify({ threadId, action }),
    })
    notify(
      `${action} requested; Gmail confirmation will appear in the audit trail.`,
    )
    window.setTimeout(
      () => void Promise.all([refreshInbox(), refreshActivity()]),
      900,
    )
  })
}

async function createRule(event: SubmitEvent, form: HTMLFormElement) {
  event.preventDefault()
  const submit = form.querySelector<HTMLButtonElement>('button')
  if (!submit) return
  const values = new FormData(form)
  await withBusy(submit, 'Granting…', async () => {
    await api('/api/rules', {
      method: 'POST',
      body: JSON.stringify({
        name: values.get('name'),
        senderContains: values.get('senderContains'),
        subjectContains: values.get('subjectContains'),
        action: values.get('action'),
      }),
    })
    form.reset()
    notify('Automation authority granted and evaluated against the inbox.')
    await Promise.all([refreshRules(), refreshActivity()])
  })
}

async function changeRuleEnabled(rule: Rule, control: HTMLButtonElement) {
  const enabled = !rule.enabled
  await withBusy(control, enabled ? 'Enabling…' : 'Disabling…', async () => {
    const result = await api<{ scheduled: number }>(
      `/api/rules/${encodeURIComponent(rule.ruleId)}/enabled`,
      {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      },
    )
    notify(
      enabled
        ? `Automation authority restored; scheduled ${result.scheduled} matching actions.`
        : 'Automation authority revoked for this rule.',
    )
    await refreshRules()
  })
}

async function retryDelivery(
  delivery: DeliveryFailure,
  control: HTMLButtonElement,
) {
  await withBusy(control, 'Retrying…', async () => {
    await api(`/api/deliveries/${encodeURIComponent(delivery.jobId)}/retry`, {
      method: 'POST',
    })
    notify(`${delivery.kind} delivery queued for retry.`)
    await refreshDeliveries()
  })
}

async function api<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.method && init.method !== 'GET'
        ? { 'x-personal-mail-action': '1' }
        : {}),
      ...init.headers,
    },
  })
  const payload = (await response.json()) as T | { error?: string }
  if (!response.ok)
    throw new Error(
      'error' in (payload as object)
        ? (payload as { error?: string }).error
        : `HTTP ${response.status}`,
    )
  return payload as T
}

async function withBusy(
  control: HTMLButtonElement,
  label: string,
  run: () => Promise<void>,
) {
  const original = control.textContent
  control.disabled = true
  control.textContent = label
  try {
    await run()
  } catch (cause) {
    notify(cause instanceof Error ? cause.message : String(cause), true)
  } finally {
    control.disabled = false
    control.textContent = original
  }
}

function notify(message: string, error = false) {
  let toast = document.querySelector<HTMLDivElement>('#toast')
  if (!toast) {
    toast = element('div', 'toast')
    toast.id = 'toast'
    document.body.append(toast)
  }
  toast.textContent = message
  toast.classList.toggle('error', error)
  toast.classList.add('visible')
  window.setTimeout(() => toast?.classList.remove('visible'), 4500)
}

function input(placeholder: string, name: string) {
  const control = document.createElement('input')
  control.name = name
  control.placeholder = placeholder
  return control
}

function button(label: string, className: string) {
  const control = document.createElement('button')
  control.type = 'button'
  control.className = className
  control.textContent = label
  return control
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  content?: string,
) {
  const node = document.createElement(tag)
  node.className = className
  if (content !== undefined) node.textContent = content
  return node
}

function text(selector: string, value: string) {
  const node = document.querySelector(selector)
  if (node) node.textContent = value
}

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(date)
    : value
}

function debounce(callback: () => void, delay: number) {
  let timer = 0
  return () => {
    window.clearTimeout(timer)
    timer = window.setTimeout(callback, delay)
  }
}
