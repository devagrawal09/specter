---
name: openspec-apply-change
description: Implement a Specter OpenSpec change from its single temporary spec.md, validate it, update lasting docs, and remove the change before merge. Use when the user wants to implement or continue an active OpenSpec change.
---

# Apply an OpenSpec change

Implement the one-file change and remove its temporary plan when the work is
ready to merge. Never archive or sync it.

1. Identify the change and its owning app, package, or repository root. Run
   `openspec context --json` from that owner and confirm the reported root.
2. Run these commands from the same owner:

   ```sh
   openspec status --change <name> --json
   openspec instructions apply --change <name> --json
   ```

3. Read the returned context file. It must resolve to the change's single
   `spec.md`. If the change is blocked or the file is missing, stop and report
   the problem.
4. Work through pending checkboxes in order. Make focused code and test changes,
   run the listed checks, and mark finished tasks in `spec.md`.
5. If implementation changes the plan, update the same `spec.md`; do not create
   another OpenSpec artifact.
6. Before merge, put any lasting knowledge in the relevant README or docs. If
   no durable documentation is needed, confirm that explicitly.
7. When implementation, validation, and documentation are complete, delete the
   exact `openspec/changes/<name>/` directory. This is cleanup of the temporary
   plan, not an archive.
8. Run `node scripts/validate-openspec.mjs` from the repository root.

Report the completed behavior, checks run, docs updated, and deleted change
directory. If work remains, keep the change directory and report what blocks
completion.
