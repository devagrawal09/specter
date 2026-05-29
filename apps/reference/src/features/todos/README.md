# Todos Reference Application

This feature is Specter's executable reference application. It demonstrates the current framework API with Event Definitions, Event Drafts, Command Slices, Query Slices, and a Reaction Slice.

The slices use explicit SQLite-backed Slice State. Command handlers emit Event Drafts for accepted commands and reject expected domain failures by throwing instead of emitting error events.
