# Outline frozen baseline

This directory publishes the coordinator-owned inputs for the Outline real-world
brownfield attempt. `prep.patch` is the binary-capable diff from the pinned
upstream parent through the final assignment commit. It omits the three
frozen-kit archives and the ignored guidance extraction; use the immutable kit
in `../../../frozen-kit/` for those files.

## Reconstruct the prepared repository

Set these paths to the main Specter checkout and a new Outline checkout:

```sh
SPECTER_REPO=/absolute/path/to/specter
OUTLINE_REPO=/absolute/path/to/outline
```

Clone and apply the published patch at the pinned revision:

```sh
git clone https://github.com/outline/outline.git "$OUTLINE_REPO"
git -C "$OUTLINE_REPO" checkout --detach d2bf2b8c5a208884b9662dad72244ca8d8924c14
git -C "$OUTLINE_REPO" apply --check --binary "$SPECTER_REPO/docs/evaluations/brownfield-adoption/baselines/real-world/outline/prep.patch"
git -C "$OUTLINE_REPO" apply --binary "$SPECTER_REPO/docs/evaluations/brownfield-adoption/baselines/real-world/outline/prep.patch"
```

Copy the immutable kit inputs that are deliberately absent from the patch:

```sh
mkdir -p "$OUTLINE_REPO/specter-evaluation/frozen-kit"
cp "$SPECTER_REPO/docs/evaluations/brownfield-adoption/frozen-kit/specter-ts-core-0.3.0.tgz" "$OUTLINE_REPO/specter-evaluation/frozen-kit/"
cp "$SPECTER_REPO/docs/evaluations/brownfield-adoption/frozen-kit/specter-ts-brownfield-verifier-0.0.0.tgz" "$OUTLINE_REPO/specter-evaluation/frozen-kit/"
cp "$SPECTER_REPO/docs/evaluations/brownfield-adoption/frozen-kit/guidance.tar.gz" "$OUTLINE_REPO/specter-evaluation/frozen-kit/"
```

Verify the reconstructed fixed inputs:

```sh
cmp "$SPECTER_REPO/docs/evaluations/brownfield-adoption/baselines/real-world/outline/specter-assignment.json" "$OUTLINE_REPO/specter-assignment.json"
cmp "$SPECTER_REPO/docs/evaluations/brownfield-adoption/baselines/real-world/outline/legacy-snapshot.json" "$OUTLINE_REPO/specter-evaluation/legacy-snapshot.json"
shasum -a 256 "$OUTLINE_REPO/specter-evaluation/frozen-kit/specter-ts-core-0.3.0.tgz" "$OUTLINE_REPO/specter-evaluation/frozen-kit/specter-ts-brownfield-verifier-0.0.0.tgz" "$OUTLINE_REPO/specter-evaluation/frozen-kit/guidance.tar.gz"
```

The expected kit digests, in command order, are:

```text
f31c26efb71c0b64d6ddc62e391d5fe0e632d4fb7c4cd811c4f353c61abff51c
eb743e888035655ea008cb37e71a1f6ea062f54bf4931b8ec79e42ab77f23ec1
86a847d5dbc0d63089f90f4d4e6fb0283bb4714d89441358b1141b895c0c18d1
```

Extract the ignored guidance before the scored clock starts:

```sh
mkdir -p "$OUTLINE_REPO/specter-evaluation/guidance"
tar -xzf "$OUTLINE_REPO/specter-evaluation/frozen-kit/guidance.tar.gz" -C "$OUTLINE_REPO/specter-evaluation/guidance"
```

## Prewarm and validate

Run the dependency installation once to populate the project-local Yarn cache,
then prove the prepared cache works with package networking disabled:

```sh
cd "$OUTLINE_REPO"
npm exec --yes --package=node@24.14.0 --package=@yarnpkg/cli-dist@4.11.0 -- yarn install --immutable
npm exec --yes --package=node@24.14.0 --package=@yarnpkg/cli-dist@4.11.0 -- env YARN_ENABLE_NETWORK=0 yarn install --immutable --immutable-cache
```

Start only Outline's PostgreSQL and Redis services and confirm readiness:

```sh
docker compose up -d postgres redis
docker compose exec -T postgres pg_isready -U user -d outline
docker compose exec -T redis redis-cli ping
docker compose exec -T postgres psql -U user -d outline -tAc "SELECT 1 FROM pg_database WHERE datname='outline-test'"
```

If the final command does not print `1`, create the isolated test database:

```sh
docker compose exec -T postgres createdb -U user outline-test
```

Migrate and run the complete green baseline:

```sh
npm exec --yes --package=node@24.14.0 --package=@yarnpkg/cli-dist@4.11.0 -- env NODE_ENV=test yarn db:migrate
npm exec --yes --package=node@24.14.0 --package=@yarnpkg/cli-dist@4.11.0 -- yarn format:check
npm exec --yes --package=node@24.14.0 --package=@yarnpkg/cli-dist@4.11.0 -- yarn oxfmt --check specter-evaluation specter-assignment.json package.json tsconfig.json .yarnrc.yml
npm exec --yes --package=node@24.14.0 --package=@yarnpkg/cli-dist@4.11.0 -- yarn lint
npm exec --yes --package=node@24.14.0 --package=@yarnpkg/cli-dist@4.11.0 -- yarn oxlint specter-evaluation
npm exec --yes --package=node@24.14.0 --package=@yarnpkg/cli-dist@4.11.0 -- yarn tsc --pretty false
npm exec --yes --package=node@24.14.0 --package=@yarnpkg/cli-dist@4.11.0 -- yarn build
npm exec --yes --package=node@24.14.0 --package=@yarnpkg/cli-dist@4.11.0 -- env NODE_ENV=test yarn vitest run --project server server/routes/api/accessRequests/accessRequests.test.ts
npm exec --yes --package=node@24.14.0 --package=@yarnpkg/cli-dist@4.11.0 -- env NODE_ENV=test yarn vitest run --config specter-evaluation/vitest.config.ts
```

Leave PostgreSQL and Redis running, leave strict application port `42135` free,
and begin the scored attempt only after the coordinator starts its clock.
