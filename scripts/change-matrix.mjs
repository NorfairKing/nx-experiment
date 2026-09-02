// Measures, for each class of source change, what Nx considers affected and
// which Nix derivations the change invalidates.
//
// Nix only sees files git knows about, so a change to an untracked file is
// invisible to the Nix side; every mutation below therefore touches a tracked
// file, and new files are staged before measuring.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'

const outputPath = process.argv[2] ?? 'results/change-matrix.json'

const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, NX_DAEMON: 'false' },
    ...options,
  })

const DRV_PATHS_APPLY = `set:
  builtins.listToAttrs (
    map (name: { inherit name; value = set.\${name}.drvPath; })
      (builtins.filter (name: builtins.match "(build|test)-.*" name != null)
        (builtins.attrNames set))
  )`

const nixDrvPaths = () =>
  JSON.parse(
    run('nix', [
      'eval',
      '--json',
      '.#packages.x86_64-linux',
      '--apply',
      DRV_PATHS_APPLY,
    ]),
  )

const nxAffectedProjects = () => {
  const raw = run('pnpm', [
    'exec',
    'nx',
    'show',
    'projects',
    '--affected',
    '--base=HEAD',
    '--json',
  ])
  return JSON.parse(raw).sort()
}

// Nx's task hash is the fair counterpart to a Nix derivation path: both decide
// whether the unit of work is reused. Project-level affectedness is recorded
// too, because that is what selects tasks before any hash is consulted.
const nxTaskHashes = () =>
  JSON.parse(run('node', ['scripts/dump-nx-hashes.mjs', 'test']))

const nxAffectedTestTasks = () => {
  const raw = run('pnpm', [
    'exec',
    'nx',
    'show',
    'projects',
    '--affected',
    '--base=HEAD',
    '--withTarget=test',
    '--json',
  ])
  return JSON.parse(raw).sort()
}

// Each mutation names the tracked file it touches and how to undo it.
const mutations = [
  {
    id: 'leaf-source',
    description: 'source of an isolated leaf package with no dependants',
    file: 'packages/orphan/src/base32.ts',
    apply: (file) => appendFileSync(file, '\nconst unused = 1\nvoid unused\n'),
  },
  {
    id: 'shared-source',
    description: 'source of the foundation package five packages depend on',
    file: 'packages/core/src/hash.ts',
    apply: (file) => appendFileSync(file, '\nconst unused = 1\nvoid unused\n'),
  },
  {
    id: 'chain-leaf-source',
    description: 'source at the bottom of the isolated four-deep chain',
    file: 'packages/chain-d/src/index.ts',
    apply: (file) => appendFileSync(file, '\nconst unused = 1\nvoid unused\n'),
  },
  {
    id: 'dev-only-dependency-source',
    description: 'source of a package other packages depend on only for tests',
    file: 'packages/test-utils/src/random.ts',
    apply: (file) => appendFileSync(file, '\nconst unused = 1\nvoid unused\n'),
  },
  {
    id: 'test-file',
    description: 'a test file, with no source change',
    file: 'packages/orphan/tests/base32.test.ts',
    apply: (file) =>
      appendFileSync(
        file,
        "\nit('is an added assertion', () => {\n  expect(encodeBase32([2])).toBe(encodeBase32([2]))\n})\n",
      ),
  },
  {
    id: 'package-manifest',
    description: 'a package.json, without changing any dependency',
    file: 'packages/orphan/package.json',
    apply: (file) => {
      const meta = JSON.parse(readFileSync(file, 'utf8'))
      meta.description = 'touched by the change matrix'
      writeFileSync(file, `${JSON.stringify(meta, null, 2)}\n`)
    },
  },
  {
    id: 'package-vitest-config',
    description: 'one package’s vitest config',
    file: 'packages/orphan/vitest.config.ts',
    apply: (file) => appendFileSync(file, '\n// touched\n'),
  },
  {
    id: 'shared-vitest-config',
    description: 'the vitest config every package merges',
    file: 'vitest.shared.ts',
    apply: (file) => appendFileSync(file, '\n// touched\n'),
  },
  {
    id: 'shared-tsconfig',
    description: 'the tsconfig every package extends',
    file: 'tsconfig.base.json',
    apply: (file) => {
      const config = JSON.parse(readFileSync(file, 'utf8'))
      config.compilerOptions.preserveConstEnums = true
      writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`)
    },
  },
  {
    id: 'lockfile',
    description: 'the pnpm lockfile',
    file: 'pnpm-lock.yaml',
    apply: (file) => appendFileSync(file, '\n# touched\n'),
  },
  {
    id: 'readme',
    description: 'a new README in one package',
    file: 'packages/orphan/README.md',
    isNew: true,
    apply: (file) => writeFileSync(file, '# orphan\n\nA leaf package.\n'),
  },
]

const restore = (mutation) => {
  if (mutation.isNew) {
    run('git', ['reset', '--quiet', '--', mutation.file])
    rmSync(mutation.file, { force: true })
  } else {
    // The file was staged so Nix would see it, so both the index and the
    // working tree have to come back from HEAD.
    run('git', ['restore', '--staged', '--worktree', '--', mutation.file])
  }
}

const assertClean = () => {
  const status = run('git', ['status', '--porcelain'])
  if (status.trim() !== '') {
    throw new Error(`working tree is not clean:\n${status}`)
  }
}

assertClean()

const baselineDrvPaths = nixDrvPaths()
const baselineTaskHashes = nxTaskHashes()
const baselineProjects = Object.keys(baselineDrvPaths)
  .filter((attr) => attr.startsWith('test-'))
  .map((attr) => attr.slice('test-'.length))
  .sort()

console.error(`baseline: ${baselineProjects.length} test derivations`)

const results = []
for (const mutation of mutations) {
  mutation.apply(mutation.file)
  // Nix reads the git tree, so a new file has to be staged to be seen at all.
  run('git', ['add', '--', mutation.file])

  const drvPaths = nixDrvPaths()
  const changed = (prefix) =>
    Object.keys(baselineDrvPaths)
      .filter((attr) => attr.startsWith(prefix))
      .filter((attr) => drvPaths[attr] !== baselineDrvPaths[attr])
      .map((attr) => attr.slice(prefix.length))
      .sort()

  const affected = nxAffectedProjects()
  const affectedTests = nxAffectedTestTasks()
  const taskHashes = nxTaskHashes()
  const rehashed = (suffix) =>
    Object.keys(baselineTaskHashes)
      .filter((id) => id.endsWith(suffix))
      .filter((id) => taskHashes[id] !== baselineTaskHashes[id])
      .map((id) => id.replace(/^@nx-exp\//, '').replace(suffix, ''))
      .sort()

  const result = {
    id: mutation.id,
    description: mutation.description,
    file: mutation.file,
    nx: {
      affectedProjects: affected.map((n) => n.replace(/^@nx-exp\//, '')),
      affectedTestProjects: affectedTests.map((n) => n.replace(/^@nx-exp\//, '')),
      rehashedBuildTasks: rehashed(':build'),
      rehashedTestTasks: rehashed(':test'),
    },
    nix: {
      invalidatedBuilds: changed('build-'),
      invalidatedTests: changed('test-'),
    },
  }
  results.push(result)
  const n = (count) => String(count).padStart(2)
  console.error(
    `${mutation.id.padEnd(28)} nx affected ${n(result.nx.affectedTestProjects.length)}` +
      `  nx rehashed ${n(result.nx.rehashedTestTasks.length)}` +
      `  nix invalidated ${n(result.nix.invalidatedTests.length)}` +
      `   (of ${baselineProjects.length})`,
  )

  restore(mutation)
  assertClean()
}

const output = {
  totalProjects: baselineProjects.length,
  legend: {
    nxAffectedProjects:
      'projects nx show projects --affected reports; project-level, ignores target inputs',
    nxRehashedTestTasks:
      'test tasks whose Nx task hash changed; the unit Nx actually reuses or reruns',
    nixInvalidatedTests:
      'test derivations whose .drv path changed; the unit Nix actually reuses or rebuilds',
  },
  projects: baselineProjects,
  changes: results,
}

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`)
console.error(`wrote ${outputPath}`)
