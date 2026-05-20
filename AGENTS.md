## Project Runtime

- The dev and preview servers use the fixed five-digit port `41731`.
- `vite.config.ts` sets `server.strictPort` and `preview.strictPort` to `true`, so Vite must fail instead of falling back to another port if `41731` is occupied.
- If port `41731` is already in use, treat that as a conflict to investigate. Do not choose a replacement port unless the user explicitly asks for one.

## Code Style

- Avoid hasty abstractions. Prefer duplicating schemas and nearby logic over extracting reusable helpers.
- Do not reuse Zod schemas unless there is a clear necessity; ask first before introducing shared schemas.
- Use the ask tool for clarifying questions. Never ask the user questions in a direct response.
