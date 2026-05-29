# Adapter-based transport

Specter core defines the app contract and typed client shape, but concrete transports such as Effect RPC over HTTP live in adapters or optional entrypoints. This supersedes the earlier Effect RPC core transport decision: keeping transport out of the core aligns it with storage agnosticism while still allowing an Effect RPC adapter to provide the default server/client integration for projects that want it.
