# Effect RPC as core transport

Specter uses Effect RPC as its core client/server transport so a Specter App can expose end-to-end type-safe, serializable command dispatch and projection query operations. This is a deliberate framework commitment rather than a pluggable adapter boundary: alternatives such as manual HTTP handlers or Hono RPC would leave the client contract less directly tied to the Effect-based app model.

Current implementation status: `SpecterClient<TConfig>` defines the app-inferred top-level client shape for Command Slice and Projection Slice methods. The concrete transport adapter is still pending, so current runtime code continues to use the existing HTTP boundary until the Effect RPC adapter lands.
