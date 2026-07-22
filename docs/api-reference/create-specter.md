# `create-specter`

**Status:** The commands and generated files below describe the Specter 0.4
main-branch preview. npm currently serves stable 0.2.1, whose generated project
and API differ from this preview.

`create-specter` is a command-line package. It does not expose a supported
JavaScript import entrypoint or public library types. Its public interface is
the `create-specter` executable.

## Create a project

The stable npm 0.2.1 initializer is available as:

```sh
npm create specter@latest my-app -- --install
```

Use the [main-branch preview setup](../getting-started.md) to explore the 0.4
API today. After building the repository, its preview CLI executable is
`packages/create-specter/dist/index.js`.

```text
create-specter [project-directory] [--force] [--install]
```

| Argument or option | Default | Behavior |
| --- | --- | --- |
| `project-directory` | `my-specter-app` | Directory to create; its basename becomes the package name. |
| `--install` | off | Runs `npm install` after copying the starter. |
| `--force` | off | Replaces a non-empty target directory. The CLI refuses to replace the current directory or filesystem root. |
| `--yes`, `-y` | n/a | Accepted compatibility flags; they are ignored. |

Without `--force`, an existing empty directory is accepted and a non-empty one
fails before files are copied.

## Generate a Slice

Run generators from an existing project's root. Point `SPECTER_CHECKOUT` at the
absolute path of the cloned and built preview repository; do not use `npx` for
these preview-only commands. Review a dry-run first:

```sh
SPECTER_CHECKOUT=/absolute/path/to/specter
node "$SPECTER_CHECKOUT/packages/create-specter/dist/index.js" \
  generate slice addTodo \
  --kind command \
  --feature todos \
  --dry-run
```

```text
create-specter generate slice <lowerCamelName>
  --kind <command|query|reaction>
  --feature <kebab-name>
  [--root <directory>]
  [--dry-run]
  [--force]
```

| Argument or option | Default | Behavior |
| --- | --- | --- |
| `<lowerCamelName>` | required | Slice name and implementation export base, such as `addTodo`. |
| `--kind` | required | Generates a `command`, `query`, or `reaction` builder chain. |
| `--feature` | required | Kebab-case feature directory, such as `todos`. |
| `--root` | `src/features` | Relative Slice root. Absolute and parent-traversing paths are rejected. |
| `--dry-run` | off | Prints the planned files and next steps without writing. |
| `--force` | off | Replaces existing generated target files. Review carefully; this does not merge them. |

The generator creates one bundle of eight files:

```text
src/features/todos/add-todo/
├── spec.ts           # required default-exported authoring source
├── impl.ts           # required named TypeScript implementation
├── events.ts         # starter Event Definition and catalog
├── projection.ts     # starter private Slice State
├── registry.ts       # explicit registration arrays
├── scenarios.test.ts # focused executable specification test
├── db-schema.ts      # projection re-export for the app schema
└── MIGRATION.md      # database and registration checklist
```

Only `spec.ts` and `impl.ts` are framework-required source artifacts. The other
files are explicit starter choices. The generated project runs
`specter-spec export` before development, typecheck, tests, and builds; that
step writes ignored adjacent `spec.json`, which `impl.ts` consumes as its only
specification input. Merge generated registration and schema exports into the
application's existing composition points instead of creating parallel
registries.

Generated templates contain tracer names and `TODO` markers. Replace them with
domain Events, exact Scenarios, runtime schemas, projection logic, and handlers
before treating the Slice as implemented.

## Generator behavior and constraints

- `generate --help` and `generate slice --help` print generator usage without
  writing.
- Unknown options, duplicate options, missing option values, extra positional
  arguments, invalid names, and unsafe paths fail explicitly.
- Slice names must be lower camel case; feature names must be kebab-case.
- All planned paths must remain inside the project root.
- Writes are atomic per file. A dry-run writes nothing.
- Without `--force`, any existing planned file aborts generation before the
  bundle is written.

## Related documentation

- [Getting started](../getting-started.md)
- [File structure](../architecture/file-structure.md)
- [Vertical Slice Architecture](../architecture/vertical-slice-architecture.md)
- [Slice tests](../specifications/slice-tests.md)
- [Persistence APIs](persistence.md)
