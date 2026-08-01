# Repository organization Specification

## Purpose

Define how OpenSpec planning ownership is divided across the Specter monorepo
without creating a second copy of executable Specter Slice behavior.

## Requirements

### Requirement: Independent workspace roots

Every direct app and package SHALL own an independent OpenSpec root containing
only that workspace's requirements, proposed changes, designs, tasks, and
archive.

#### Scenario: Change owned by one workspace

- **GIVEN** a change affects one app or package
- **WHEN** an OpenSpec change is created
- **THEN** it is created from that workspace directory
- **AND** all of its artifacts remain in that workspace's `openspec/` directory

### Requirement: Narrow repository root

The top-level OpenSpec root SHALL contain only requirements and changes that
apply across the repository, such as organization, shared tooling,
contribution rules, and releases.

#### Scenario: Workspace behavior is not placed at the root

- **GIVEN** behavior is owned by one app or package
- **WHEN** its requirements are recorded
- **THEN** they are recorded in the owning workspace's OpenSpec root
- **AND** the top-level specs do not duplicate that behavior

### Requirement: Explicit cross-workspace ownership

A change that affects several apps or packages SHALL keep each workspace's
behavioral requirements in that workspace's OpenSpec root.

#### Scenario: Coordinated change across workspaces

- **GIVEN** one improvement affects multiple workspace owners
- **WHEN** the work is planned
- **THEN** each affected workspace receives its own OpenSpec change
- **AND** a top-level change is used only when repository-wide coordination is
  itself required

### Requirement: Specter remains the executable behavior contract

OpenSpec specifications SHALL describe observable capability requirements
without duplicating exact Specter Slice Events, outputs, or rejection examples.

#### Scenario: A Slice behavior changes

- **GIVEN** an OpenSpec requirement changes behavior implemented by a Specter
  Slice
- **WHEN** the implementation is updated
- **THEN** the exact examples are updated in the Slice's `spec.ts` and exported
  `spec.json`
- **AND** executable Specter Scenario tests verify those examples
