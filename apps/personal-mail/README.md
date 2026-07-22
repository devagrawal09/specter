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

When the MacBook sleeps, leaves the tailnet, or the process stops, sync and
automations pause. Specter's Event Log and reaction cursor resume durable work
when the process returns.
