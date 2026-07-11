# Booking Reference Application

This feature is Specter's richer executable reference application. It models meeting-room bookings with room administration, approval-required booking requests, conflict checks, lifecycle transitions, independent read models, comprehensive scenarios, and an approval notification reaction.

Pending booking requests hold room time until they are approved, rejected, or canceled. Booking conflicts use half-open intervals, so a booking ending at 10:00 does not conflict with one starting at 10:00.

Each Slice directory separates `spec.ts` from `impl.ts`. The spec contains only the stable name, human-readable description, and nonempty scenarios expressed with exact kebab-case Events. The implementation imports its spec and owns runtime schemas, Event Definitions, SQLite state, repeated `apply` registrations, and its handler.

Scenario tests run every implementation with the complete Booking Event catalog. Each implementation's applied Event types exactly match the union of Events used by its Given scenarios.
