# Personal Mail

Personal Mail is a single-user, AI-first Gmail client built on Specter 0.4. It
runs on the owner's MacBook, listens only on `127.0.0.1:41738`, and is intended
to be exposed exclusively through Tailscale Serve. Gmail remains authoritative
for mailbox state; Specter durably records imported facts, AI requests/results,
explicit automation authority, and mailbox-action outcomes.

## Security and privacy

- Never bind this service to a LAN or public interface. Vite dev, preview, and
  the production build use the fixed strict port `41738` on loopback.
- Do not use Tailscale Funnel. Serve it only inside the tailnet:

  ```sh
  tailscale serve --bg http://127.0.0.1:41738
  ```

- Set `SPECTER_MAIL_ACCESS_MODE=tailscale` and `TAILSCALE_ALLOWED_LOGIN` before
  `pnpm start`. Requests through Tailscale Serve must carry the matching
  `Tailscale-User-Login` identity header. Local mode is accepted only for
  development and tests.
- OAuth tokens and indexed message content live only in the ignored local
  SQLite database. Keep the database directory owner-readable only and include
  it in encrypted backups if backed up at all.
- Local OpenAI-compatible inference defaults to
  `http://127.0.0.1:11434/v1`. Cloud inference is disabled unless configured,
  and each cloud request must explicitly opt in. There is no global cloud mode.
- Automation rules are explicit grants. Disable a rule in the app to revoke its
  authority. The delivery worker checks the rule again immediately before a
  queued automatic action reaches Gmail, so revocation also stops queued work.

## Google setup

Create a private Google Cloud project, enable the Gmail API, and create a Web
OAuth client with the redirect URI you will actually use. For local development:

`http://127.0.0.1:41738/auth/google/callback`

For the private service, use the HTTPS Tailscale Serve URL, for example
`https://your-mac.your-tailnet.ts.net/auth/google/callback`, and set the same
value in `GOOGLE_REDIRECT_URI`.

Copy `.env.example` to `.env`, set `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET`, then run:

```sh
pnpm --filter @specter/personal-mail dev
```

Open `http://127.0.0.1:41738`, connect Gmail, and press **Sync now**. The OAuth
scope is `gmail.modify`; no credentials or real email fixtures are committed.

## Effect and retry semantics

Mailbox mutations follow requested -> applied / failed / reconciliation-needed.
The Gmail adapter persists an attempt before calling Gmail and reconciles
ambiguous attempts by reading current labels before retrying. This narrows the
crash window but does not claim exactly-once remote effects. Archive, mark-read,
and star are label-state mutations designed to be safely reconcilable.

Reaction Slices only write provider work to the SQLite outbox. One runtime-owned
worker performs Gmail and AI calls after the Slice transaction commits. Failed
work is retried with a lease and backoff, then moved to dead-letter without
blocking later work. The **Delivery recovery** panel lists safe failure metadata
and requires an explicit retry.

When the MacBook sleeps, leaves the tailnet, or the process stops, sync and
automations pause. Specter's Event Log, Slice cursors, and the outbox resume
durable work when the process returns. The Event Log owns domain results; the
outbox only owns delivery attempts and dead-letter state.

Gmail reads use bounded concurrency, request timeouts, and retries for transient
network, 408, 429, and 5xx failures. The Gmail history cursor advances only
after the whole import is recorded. AI requests also have a request timeout.
See `.env.example` for the limits.

## Validation

The browser test runs against loopback-only fake Gmail and local-AI providers;
it does not need or read live credentials:

```sh
pnpm --filter @specter/personal-mail test
pnpm --filter @specter/personal-mail test:e2e
```

The runtime integration suite covers SQLite delivery outside Slice
transactions, dead-letter recovery after restart, later work after a failed
delivery, and rule revocation while an automatic action is queued. Live Gmail,
OAuth, Tailscale identity forwarding, sleep/wake, and the chosen local model
still require an operator smoke test on the target Mac.
