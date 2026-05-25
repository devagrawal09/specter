# Todos Reference Application

This feature is Specter's executable reference application. It demonstrates the current lib API with Event Definitions, Event Drafts, Command Slices, Projection Slices, a Reaction Slice, and Views.

The slices use explicit SQLite-backed Slice State. Command handlers emit Event Drafts for accepted commands and reject expected domain failures through typed Effect failure instead of emitting error events.
