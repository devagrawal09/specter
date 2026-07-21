# Reference HTTP binding

The default base path is `/specter/v1`. All JSON responses include
`Specter-Protocol-Version: 1`.

| Method | Path | Request kind | Response kind |
| --- | --- | --- | --- |
| POST | `/observations` | `observations.batch` | `observations.ack` |

POST bodies require a parsed media type of `application/json`; media-type
parameters such as `charset=utf-8` are allowed. Bindings MAY add authentication,
compression, or transport-specific headers without changing protocol messages.

Public failures use `{ "error": { "code", "message", "details"? } }` and an
appropriate non-2xx status. Failure details MUST NOT expose private runtime or
collector exceptions.

The collector dashboard and CLI use collector-owned `/v1/*` read endpoints.
Those endpoints are not part of this protocol and do not carry the
`Specter-Protocol-Version` header.
