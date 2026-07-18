import { execFileSync } from 'node:child_process'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../..')
const temporaryRoot = mkdtempSync(
  join(tmpdir(), 'specter-brownfield-packed-consumer-'),
)

try {
  const packDirectory = join(temporaryRoot, 'packs')
  const consumerDirectory = join(temporaryRoot, 'consumer')
  const verifierDirectory = join(
    consumerDirectory,
    'node_modules',
    '@specter-ts',
    'brownfield-verifier',
  )
  const coreDirectory = join(
    consumerDirectory,
    'node_modules',
    '@specter-ts',
    'core',
  )
  mkdirSync(packDirectory, { recursive: true })
  mkdirSync(verifierDirectory, { recursive: true })

  const packageManagerPath = process.env.npm_execpath
  if (packageManagerPath) {
    execFileSync(
      process.execPath,
      [packageManagerPath, 'pack', '--pack-destination', packDirectory],
      { cwd: packageRoot, stdio: 'pipe' },
    )
  } else {
    execFileSync(
      'npm',
      [
        'pack',
        '--cache',
        join(temporaryRoot, 'npm-cache'),
        '--pack-destination',
        packDirectory,
      ],
      { cwd: packageRoot, stdio: 'pipe' },
    )
  }
  const tarballs = readdirSync(packDirectory).filter((file) =>
    file.endsWith('.tgz'),
  )
  if (tarballs.length !== 1) {
    throw new Error(`Expected one verifier tarball, found ${tarballs.length}`)
  }
  execFileSync(
    'tar',
    [
      '-xzf',
      join(packDirectory, tarballs[0]),
      '-C',
      verifierDirectory,
      '--strip-components=1',
    ],
    { stdio: 'pipe' },
  )
  cpSync(resolve(packageRoot, 'test-consumers/core-stub'), coreDirectory, {
    recursive: true,
  })

  cpSync(
    resolve(packageRoot, 'test-consumers/driver.ts'),
    join(consumerDirectory, 'driver.ts'),
  )
  writeFileSync(
    join(consumerDirectory, 'package.json'),
    `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`,
  )
  writeFileSync(
    join(consumerDirectory, 'runtime.mjs'),
    readFileSync(resolve(packageRoot, 'test-consumers/runtime.mjs')),
  )

  const configurations = [
    {
      name: 'nodenext',
      compilerOptions: {
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        target: 'ES2022',
      },
    },
    {
      name: 'bundler',
      compilerOptions: {
        module: 'ESNext',
        moduleResolution: 'Bundler',
        target: 'ES2022',
      },
    },
  ]
  for (const configuration of configurations) {
    const configPath = join(
      consumerDirectory,
      `tsconfig.${configuration.name}.json`,
    )
    writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          compilerOptions: {
            ...configuration.compilerOptions,
            noEmit: true,
            skipLibCheck: false,
            strict: true,
            verbatimModuleSyntax: true,
          },
          files: ['./driver.ts'],
        },
        null,
        2,
      )}\n`,
    )
    execFileSync(
      resolve(repositoryRoot, 'node_modules/.bin/tsc'),
      ['-p', configPath],
      { cwd: consumerDirectory, stdio: 'inherit' },
    )
  }

  rmSync(coreDirectory, { recursive: true, force: true })
  symlinkSync(resolve(repositoryRoot, 'packages/core'), coreDirectory, 'dir')
  execFileSync(process.execPath, [join(consumerDirectory, 'runtime.mjs')], {
    cwd: consumerDirectory,
    stdio: 'inherit',
  })
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}
