## Project Runtime

- The dev and preview servers use the fixed five-digit port `41731`.
- `vite.config.ts` sets `server.strictPort` and `preview.strictPort` to `true`, so Vite must fail instead of falling back to another port if `41731` is occupied.
- If port `41731` is already in use, treat that as a conflict to investigate. Do not choose a replacement port unless the user explicitly asks for one.
