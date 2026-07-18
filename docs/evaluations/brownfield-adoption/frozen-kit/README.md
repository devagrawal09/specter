# Frozen brownfield evaluation kit

These artifacts are the immutable inputs for all ten scored attempts. Verify
their SHA-256 digests against `manifest.json` before copying them into an
assignment repository.

- `specter-ts-core-0.3.0.tgz` is the locally packed evaluated core package.
- `specter-ts-brownfield-verifier-0.0.0.tgz` is the visible black-box adapter
  harness.
- `guidance.tar.gz` contains the Specter skill, runtime and brownfield guides,
  reference-app code, adapter contracts, maintained adapter sources and tests,
  and verifier source.

Extract guidance before the active-work clock starts. Install the two package
archives with the application's existing package manager and prewarm the
resulting dependency state. Scored agents may inspect everything in the kit but
must not edit the verifier or fetch replacement material from the network.

The model, reasoning setting, prompt, schemas, and 90-minute active-work limit
are also frozen in `manifest.json`. Changing any listed input requires a new
evaluation, not an in-place update to an attempt.
