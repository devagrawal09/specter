# Todos Reference Application

This feature is Specter's executable reference application. It demonstrates the current framework API with Event Definitions, Event Drafts, Command Slices, Query Slices, and a Reaction Slice.

The slices use explicit SQLite-backed Slice State. Command handlers emit Event Drafts for accepted commands and reject expected domain failures by throwing instead of emitting error events.

Each Slice has a stable name plus a human-readable description, and each scenario has its own description. Scenario tests use those descriptions directly as suite and test names.
