import { demoEventDefinitions } from './features/demos/events'
import { githubEventDefinitions } from './features/github/events'
import { opencodeEventDefinitions } from './features/opencode/events'
import { operatorWorkflowEventDefinitions } from './features/operator-workflows/events'
import { opportunityEventDefinitions } from './features/opportunities/events'
import { projectEventDefinitions } from './features/projects/events'
import { suggestionEventDefinitions } from './features/suggestions/events'
import { taskEventDefinitions } from './features/tasks/events'

export const eventDefinitions = {
  opportunities: opportunityEventDefinitions,
  projects: projectEventDefinitions,
  tasks: taskEventDefinitions,
  demos: demoEventDefinitions,
  github: githubEventDefinitions,
  opencode: opencodeEventDefinitions,
  suggestions: suggestionEventDefinitions,
  operatorWorkflows: operatorWorkflowEventDefinitions,
} as const

export const plannedSliceGroups = [
  {
    featureGroup: 'opportunities',
    note: 'Opportunity Radar is a broad feature group; planned Slices remain granular one-command or one-query units, each separating spec.ts from complete impl.ts implementations.',
    slices: [
      'create-opportunity',
      'update-opportunity',
      'prioritize-opportunity',
      'archive-opportunity',
      'request-opportunity-conversion',
      'confirm-opportunity-conversion',
      'opportunity-list-query',
      'opportunity-detail-query',
    ],
  },
  {
    featureGroup: 'projects',
    note: 'Project Shiproom is a broad feature group; planned Slices remain granular one-command or one-query units, each separating spec.ts from complete impl.ts implementations.',
    slices: [
      'create-project',
      'update-project-status',
      'add-project-milestone',
      'complete-project-milestone',
      'add-project-link',
      'project-detail-query',
    ],
  },
  {
    featureGroup: 'tasks',
    note: 'Nexus Task Loop and scoring are broad concepts; planned Slices remain granular around task state and score awards.',
    slices: [
      'create-task',
      'triage-task',
      'start-task',
      'request-task-completion',
      'confirm-task-completion',
      'roll-forward-task',
      'request-score-award',
      'award-score',
      'task-list-query',
    ],
  },
  {
    featureGroup: 'demos',
    note: 'DemoLab is a broad feature group; planned Slices remain granular for demos, stages, steps, and rehearsal records.',
    slices: [
      'create-demo',
      'add-demo-stage',
      'reorder-demo-stage',
      'add-demo-step',
      'complete-demo-rehearsal',
      'demo-detail-query',
    ],
  },
  {
    featureGroup: 'github',
    note: 'GitHub Integration is a broad feature group; planned Slices remain granular and read-only for the MVP.',
    slices: [
      'attach-github-repository',
      'refresh-github-repository-reaction',
      'record-github-repository-refreshed',
      'record-github-repository-refresh-failed',
      'import-github-issues',
      'github-repository-query',
    ],
  },
  {
    featureGroup: 'opencode',
    note: 'OpenCode Integration is a broad feature group; planned Slices remain granular and preserve direct event/operation mapping with no normalized layer.',
    slices: [
      'request-opencode-run',
      'record-opencode-run-started',
      'record-opencode-run-status-changed',
      'record-opencode-log-appended',
      'record-opencode-tool-completed',
      'record-opencode-file-changed',
      'record-opencode-suggestion-created',
      'record-opencode-run-completed',
      'record-opencode-run-failed',
      'opencode-runs-query',
      'opencode-run-timeline-query',
    ],
  },
  {
    featureGroup: 'suggestions',
    note: 'Agent Suggestions is a broad feature group; planned Slices remain granular for record, apply, reject, and query flows.',
    slices: [
      'record-agent-suggestion',
      'apply-agent-suggestion',
      'reject-agent-suggestion',
      'pending-suggestions-query',
    ],
  },
  {
    featureGroup: 'operator-workflows',
    note: 'Operator Workflows is a broad feature group; planned Slices remain granular for preview, confirmation, follow-up, and cancellation.',
    slices: [
      'preview-operator-workflow',
      'confirm-operator-workflow-run',
      'send-opencode-followup',
      'cancel-opencode-run',
    ],
  },
] as const
