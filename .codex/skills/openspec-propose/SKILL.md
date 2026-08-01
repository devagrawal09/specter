---
name: openspec-propose
description: Create the single temporary spec.md for a new Specter repository, app, or package change. Use when the user wants to plan or start an OpenSpec change.
---

# Propose an OpenSpec change

Create one temporary change spec. Do not create proposal, design, task,
delta-spec, sync, or archive artifacts.

1. Identify the smallest owner: one app, one package, or the repository only
   for a truly global change.
2. Run `openspec context --json` with that owner as the working directory.
   Stop if the reported root is not the chosen owner.
3. Choose a short kebab-case change name and run:

   ```sh
   openspec new change <name> --schema ongoing-change
   openspec instructions spec --change <name> --json
   ```

4. Follow the returned template, instruction, context, and rules. Write only
   the returned `resolvedOutputPath`, which must be one `spec.md`.
5. Keep the spec concise but complete: goal, scope and non-goals, required
   behavior, task checkboxes, validation, and lasting documentation work.
6. Run `openspec status --change <name> --json` and confirm the `spec` artifact
   is done.

Report the owner, change name, `spec.md` path, and that it is ready to apply.
