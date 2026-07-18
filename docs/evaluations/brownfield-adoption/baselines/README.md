# Published brownfield baselines

This directory contains the five frozen assignments for
`specter-brownfield-adoption` version 1. The canonical index is
[`../assignment-matrix.json`](../assignment-matrix.json); it records each
assignment and metadata digest, exact source/preparation/assignment revisions,
stack and command references, and two independent attempt IDs per app.

The published seed is the SHA-256 of the UTF-8 string
`specter-brownfield-adoption:1`. Attempt allocation order is the matrix's seeded
hash ordering. The seed controls ordering only; it does not change an assignment
or permit attempts to share a working copy.

All assignments use `gpt-5.6-sol`, `high` reasoning, and a 90-minute active-work
limit. Before copying one, verify its matrix digest, validate it against the
frozen assignment schema, and verify its snapshot and package digests against
the source artifact and frozen-kit manifest.

Attempts may run concurrently only when their fixed services do not conflict.
Mongo Returns and MySQL Shipments serialize on host port `42133`; MySQL
Shipments and Outline serialize on host port `42135`. The matrix names the exact
services and published definitions. Stop and verify service cleanup before
releasing either port.

No baseline, frozen input, prompt, schema, or kit artifact may change after an
attempt starts. Scoring begins only in an isolated copy issued from one of these
bundles.
