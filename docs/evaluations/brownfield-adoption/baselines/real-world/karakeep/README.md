# Karakeep frozen brownfield baseline

This bundle reconstructs the frozen Karakeep assignment from upstream parent
`bc50630767079b060488d1d790b96de1e06ea6ba`. `prep.patch` is the binary-capable
parent-to-assignment diff ending at
`a8e01ad9b0664e3e4ed28a0d8491395bd2715d88`; it excludes the shared frozen-kit
archives and the ignored extracted guidance so those inputs are not duplicated.

## Reconstruct

From a clean clone of `https://github.com/karakeep-app/karakeep.git`:

```sh
git checkout bc50630767079b060488d1d790b96de1e06ea6ba
git apply --binary /path/to/karakeep/prep.patch
mkdir -p specter-evaluation/frozen-kit
cp /path/to/specter/docs/evaluations/brownfield-adoption/frozen-kit/{specter-ts-core-0.3.0.tgz,specter-ts-brownfield-verifier-0.0.0.tgz,guidance.tar.gz} \
  specter-evaluation/frozen-kit/
```

Verify the expected hashes from `specter-assignment.json` and `metadata.json`,
then extract guidance before the scored clock:

```sh
mkdir -p specter-evaluation/guidance
tar -xzf specter-evaluation/frozen-kit/guidance.tar.gz \
  -C specter-evaluation/guidance
```

## Offline prewarm

The prepared evaluation host uses the bundled Node 24 runtime, pinned pnpm
11.2.1, prewarmed npm cache, and prewarmed pnpm store:

```sh
NODE24=/Users/devagr/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
KARAKEEP_NPM_CACHE=/private/tmp/karakeep-npm-cache
KARAKEEP_PNPM_STORE=/Users/devagr/Library/pnpm/store/v11
export PATH="$(dirname "$NODE24"):/opt/homebrew/bin:/usr/bin:/bin"
pnpm11() {
  npm_config_cache="$KARAKEEP_NPM_CACHE" \
    pnpm_config_store_dir="$KARAKEEP_PNPM_STORE" \
    npm exec --offline --yes --package=pnpm@11.2.1 -- pnpm "$@"
}
pnpm11 install --offline --frozen-lockfile
NO_COLOR=false pnpm11 seed:apply
NO_COLOR=false DATA_DIR="$PWD/data" pnpm11 db:migrate
sqlite3 -readonly data/db.db < specter-evaluation/verify-snapshot.sql
```

The exact scored baseline, adapter-verifier, and domain-acceptance commands are
in `specter-assignment.json`. Reconstruction prepares inputs only; it does not
implement adapters, migrate the domain operation, or start the scored run.
