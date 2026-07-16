# ColonyBench Reference Boundaries

- Keep each Slice specification immutable in its own `spec.ts`. Specifications
  contain only a name, description, and nonempty scenarios built with
  `@specter-ts/core/spec` and `event()`.
- Complete schemas, the parameterized store, repeated typed `apply`
  registrations, and the handler in the neighboring `impl.ts`.
- The union of a Slice's scenario `given` Event types must exactly match its
  implementation apply registrations. Accepted command outcomes must list
  every Event type that command can emit.
- Event types are kebab-case. Scenario payloads are exact and preserve all
  domain identifiers and values.
- Domain IDs belong in command inputs or prior Events. Slice handlers must not
  generate IDs, timestamps, or random values.
- `control` and `simulation` are separate app boundaries. They may share only
  their public bridge contract and runner-facing app types; Slice
  implementations must not import sibling Slices.
- Always await `createSpecterApp` through the app factories in `src/index.ts`.
- Test selected implementations with `testSliceImplementations` and an
  explicit Event Definition catalog.
