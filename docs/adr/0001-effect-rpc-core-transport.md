# Effect RPC as core transport

Specter uses Effect RPC as its core client/server transport so a Specter App can expose end-to-end type-safe, serializable command dispatch and query operations. This is a deliberate framework commitment rather than a pluggable adapter boundary: alternatives such as manual HTTP handlers or Hono RPC would leave the client contract less directly tied to the Effect-based app model.

Current implementation status: `SpecterClient<TConfig>` defines the app-inferred top-level client shape for Command Slice and Query Slice methods, and Solid views receive a Specter Client through context. The concrete Effect RPC transport adapter is still pending because the Effect RPC packages are not installed; the reference app currently implements that client shape over the existing Hono HTTP boundary until the adapter lands.
