# Reference HTTP/SSE binding

The default base path is `/specter/v1`. All JSON responses include
`Specter-Protocol-Version: 1`.

| Method | Path | Request kind | Response kind |
| --- | --- | --- | --- |
| GET | `/capabilities` | none | `capabilities.response` |
| POST | `/capabilities` | `capabilities.request` | `capabilities.response` |
| POST | `/commands` | `command.request` | `command.response` |
| POST | `/queries` | `query.request` | `query.response` |
| POST | `/subscriptions` | `subscription.request` | SSE subscription messages |
| GET | `/reaction-tickets/{id}` | path ID | `reaction-ticket.response` |
| POST | `/observations` | `observations.batch` | `observations.ack` |

POST bodies use `application/json`. Subscription responses use
`text/event-stream`; each frame's event name equals its message `kind` and its
data is the complete JSON protocol message. Cancelling the HTTP request cancels
the runtime subscription. Bindings MAY add authentication, compression, or
transport-specific headers without changing protocol messages.

Public failures use `{ "error": { "code", "message", "details"? } }` and an
appropriate non-2xx status. Protocol operation errors that are part of a valid
Command, Query, Reaction, or subscription lifecycle use that operation's typed
response message.
