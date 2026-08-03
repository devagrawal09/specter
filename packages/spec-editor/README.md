# `@specter-ts/spec-editor`

Local visual editing for committed portable Specter Slice specifications.

```sh
specter-spec-editor .
```

The command serves `http://127.0.0.1:41739` and discovers
`src/features/**/spec.json` below the selected project root. It never follows
symlinks outside `src/features`. A specification with adjacent `spec.ts` is
shown read-only because JSON is still generated for that Slice.

Saving validates the complete document through `@specter-ts/spec`, checks that
the file has not changed since it was loaded, and atomically replaces only the
selected `spec.json`. Changes to the same file are handled one at a time, so a
second save or delete with an old revision fails instead of overwriting newer
work. Starting a new Slice while the current draft is dirty requires explicit
confirmation.

The server accepts requests only for the exact local address
`127.0.0.1:41739`. Browser mutation requests must come from that same origin,
and all mutation requests must use `application/json`. CLI clients may omit the
`Origin` header. The editor does not load runtime telemetry or Event schemas.
