# The Last Lantern

A controller-first, voice-led solo fantasy adventure that doubles as an end-to-end equipment and interface test for the future Oathbound experience.

## Run

1. Copy `.env.example` to `.env` and set `OPENAI_API_KEY`.
2. From the repository root, run `pnpm dev:last-lantern`.
3. Open `http://127.0.0.1:41738` in Chrome.

The app stores durable story progress in `data/last-lantern.sqlite`. Without an API key, Demo Mode still exercises the complete campaign, dice confirmation, controller navigation, persistence, and checkpoint recovery using scripted on-screen narration.

Use the left stick or D-pad to navigate, A to confirm, B to dismiss a correction card, and hold the left trigger to speak in Live Mode. The only keyboard-only interaction is typing the hero's name. The completed screen can reset the test; each finished SQLite database is retained beside the new database as a timestamped backup.
