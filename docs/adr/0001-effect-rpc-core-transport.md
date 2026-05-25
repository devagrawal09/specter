# Effect RPC as core transport

Specter uses Effect RPC as its core client/server transport so a Specter App can expose end-to-end type-safe, serializable command dispatch and query operations. This is a deliberate framework commitment rather than a pluggable adapter boundary: alternatives such as manual HTTP handlers or Hono RPC would leave the client contract less directly tied to the Effect-based app model.

Current implementation status: `SpecterClient<TConfig>` defines the app-inferred top-level client shape for Command Slice and Query Slice methods, and Solid views receive a Specter Client through context. The reference app now serves a Specter RPC group at `/rpc` with Effect RPC over streaming HTTP/NDJSON. Hono still owns static assets and shell routing, but command dispatch and query calls no longer use hand-written JSON HTTP endpoints.
