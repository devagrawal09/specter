# Booking Reference Application

This feature is Specter's richer executable reference application. It models meeting-room bookings with room administration, approval-required booking requests, conflict checks, lifecycle transitions, independent read models, comprehensive scenarios, and an approval notification reaction.

Pending booking requests hold room time until they are approved, rejected, or canceled. Booking conflicts use half-open intervals, so a booking ending at 10:00 does not conflict with one starting at 10:00.

Each Slice has a stable name plus a human-readable description, and each scenario has its own description. Scenario tests use those descriptions directly as suite and test names.
