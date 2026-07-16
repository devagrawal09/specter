import { createEventDefinition } from '@specter-ts/core'
import { z } from 'zod'

export const githubRepositoryAttachedEvent = createEventDefinition(
  'github-repository-attached',
  z.object({
    repositoryId: z.string(),
    owner: z.string(),
    name: z.string(),
    url: z.string(),
  }),
)

export const githubRepositoryRefreshedEvent = createEventDefinition(
  'github-repository-refreshed',
  z.object({
    repositoryId: z.string(),
    refreshedAt: z.string(),
    openIssueCount: z.number().int().nonnegative(),
    defaultBranch: z.string(),
  }),
)

export const githubRepositoryRefreshFailedEvent = createEventDefinition(
  'github-repository-refresh-failed',
  z.object({
    repositoryId: z.string(),
    failedAt: z.string(),
    error: z.string(),
  }),
)

export const githubIssuesImportedEvent = createEventDefinition(
  'github-issues-imported',
  z.object({
    repositoryId: z.string(),
    importedAt: z.string(),
    issueCount: z.number().int().nonnegative(),
  }),
)

export const githubEventDefinitions = [
  githubRepositoryAttachedEvent,
  githubRepositoryRefreshedEvent,
  githubRepositoryRefreshFailedEvent,
  githubIssuesImportedEvent,
] as const
