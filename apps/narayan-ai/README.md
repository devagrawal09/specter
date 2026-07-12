# Narayan AI

A starter app combining Specter, TanStack Solid Start, Drizzle SQLite, Twilio WhatsApp webhooks, and Mastra/OpenRouter assistant replies.

## Setup

```bash
pnpm install
cp apps/narayan-ai/.env.example apps/narayan-ai/.env
pnpm --filter @specter/narayan-ai db:generate
pnpm --filter @specter/narayan-ai db:migrate
pnpm --filter @specter/narayan-ai dev
```

The app uses fixed port `41735` with `strictPort: true`.

## Environment

Use placeholders from `.env.example`; do not commit real secrets.

Required for production Twilio sends:

```bash
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
```

Optional:

```bash
NARAYAN_AI_DB_PATH=./data/narayan-ai.db
NARAYAN_AI_PUBLIC_URL=https://your-public-tunnel.example
TWILIO_CONTENT_SID=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_CONTENT_VARIABLES_JSON={"1":"{{body}}","2":"Narayan AI"}
TWILIO_VALIDATE_SIGNATURE=true
OPENROUTER_API_KEY=***
OPENROUTER_MODEL=openai/gpt-4o-mini
```

If `OPENROUTER_API_KEY` is missing, the Mastra reaction plugin returns a deterministic fallback reply. If Twilio credentials are missing, outbound sends are recorded as failed instead of making a network call.

When `TWILIO_CONTENT_SID` is set, outbound sends use a Twilio Content template. `TWILIO_CONTENT_VARIABLES_JSON` supports `{{body}}`, `{{to}}`, and `{{outboundMessageId}}` placeholders; omit it to default to `{ "1": body, "2": "Narayan AI" }`.

## Twilio Sandbox

Set the Twilio WhatsApp sandbox incoming webhook to:

```text
https://your-public-tunnel.example/api/twilio/incoming
```

For local curl verification without Twilio signature validation:

```bash
TWILIO_VALIDATE_SIGNATURE=false pnpm --filter @specter/narayan-ai dev
```

Then run:

```bash
curl -i -X POST http://localhost:41735/api/twilio/incoming \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'MessageSid=SMXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' \
  --data-urlencode 'From=whatsapp:+15551234567' \
  --data-urlencode 'To=whatsapp:+14155238886' \
  --data-urlencode 'Body=Do you deliver in Kashi today?'
```

Expected response:

```xml
<Response/>
```

## Scripts

```bash
pnpm --filter @specter/narayan-ai dev
pnpm --filter @specter/narayan-ai dev:kill
pnpm --filter @specter/narayan-ai typecheck
pnpm --filter @specter/narayan-ai test
pnpm --filter @specter/narayan-ai build
pnpm --filter @specter/narayan-ai db:generate
pnpm --filter @specter/narayan-ai db:migrate
pnpm --filter @specter/narayan-ai db:studio
```
