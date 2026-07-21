# Behavioral conformance vectors

Each JSON file describes inputs and required observable outcomes without
prescribing a language API or persistence layout. Runtime implementations MAY
translate the envelopes into idiomatic test harness calls, but MUST preserve the
listed order, identity, status, and error semantics.

These vectors complement `fixtures/`, which exercise individual wire messages.
