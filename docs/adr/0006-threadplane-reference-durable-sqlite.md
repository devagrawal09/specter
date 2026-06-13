# Threadplane Reference durable SQLite boundary

The Threadplane Reference application uses TanStack Start server functions as its UI boundary and keeps the Specter runtime server-side. The client imports only the server-function bridge; SQLite clients, Node APIs, and the composed Specter App live in server-only modules.

The app persists its Specter Event Log and Slice State with local SQLite via `@libsql/client`. Events are stored append-only in one ordered log. Slice State is stored per Slice as JSON plus its Slice Cursor, which is sufficient for this Reference application because its active slices use plain state objects and Sets rather than SQL-native read models.

This keeps the Reference application durable across runtime restarts without adding auth, realtime delivery, or workspace file persistence yet. Those concerns remain separate future capabilities owned by Workspaces, not by additional Channel or Workstream concepts.
