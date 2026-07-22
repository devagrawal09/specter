# Specter Slice specification format

`spec.ts` is the TypeScript authoring source. A project build runs `specter-spec export` with explicit files, directories, or globs and writes deterministic `spec.json` beside each source file. Implementations and every language runtime consume only that JSON document.

Version 1 contains behavior only: Slice kind, lower-camel-case name, description, and exact Given/When/Then examples. It uses strict JSON Schema 2020-12 and rejects unknown fields. Values must be plain JSON with finite numbers and safe integers; dates, maps, classes, functions, `undefined`, bigint, cycles, `NaN`, and infinities are invalid.

Runtimes must support the declared `formatVersion` exactly, compare scenario values by exact structural JSON equality (object key order is irrelevant), compare rejection reason strings exactly, and enforce the same Specter conformance rules as the TypeScript runtime.

Specification digests use `sha256:<lowercase hex>` over RFC 8785 JCS-compatible canonical JSON: object keys are ordered by raw UTF-16 code units, strings and finite numbers use ECMAScript JSON serialization, and arrays preserve order. The v1 portable-value profile excludes values that JCS cannot represent consistently, including non-finite numbers and integers outside JavaScript's safe range.
