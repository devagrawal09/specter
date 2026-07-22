# Reference HTTP binding

The default base path is `/specter/v1`. Every response for the exact
`/specter/v1/observations` protocol route includes
`Specter-Protocol-Version: 1`, including wrong-method and failure responses.

| Method | Path | Request kind | Response kind |
| --- | --- | --- | --- |
| POST | `/observations` | `observations.batch` | `observations.ack` |
| POST | `/specifications` | `specifications.publish` | `specifications.ack` |

POST bodies require a parsed media type of `application/json`; media-type
parameters such as `charset=utf-8` are allowed. Bindings MAY add authentication,
compression, or transport-specific headers without changing protocol messages.

Public failures use `{ "error": { "code", "message", "details"? } }` and an
appropriate non-2xx status. Failure details MUST NOT expose private runtime or
collector exceptions.

The collector dashboard and CLI use collector-owned `/v1/*` read endpoints.
Those endpoints are not part of this protocol and do not carry the
`Specter-Protocol-Version` header.
