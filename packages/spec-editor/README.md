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
selected `spec.json`. The editor does not load runtime telemetry or Event
schemas.
