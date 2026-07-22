# Behavioral conformance vectors

Each JSON file describes observation-delivery inputs and required collector
outcomes without prescribing a language API or persistence layout. Producers
and collectors MAY translate the envelopes into idiomatic test harness calls,
but MUST preserve the listed identity, count, retry, and deduplication semantics.

These vectors complement `fixtures/`, which exercise individual wire messages.
