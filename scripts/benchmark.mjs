// Times what can be timed without touching the shared Nix store.
//
// An earlier version measured cold builds by deleting outputs first. Do not
// bring that back. `nix store delete` scans every GC root and then runs a
// "deleting unused links" pass over /nix/store/.links; on a store deduplicating
// a couple of hundred gigabytes that is an enormous traversal, and this script
// called it once per output path — seventy-odd times per run — while Nix was
// building in parallel. It took the machine down.
//
// It was also measuring the wrong thing. Deleting only the test outputs left
// every tsc output in place, so "cold" meant "everything except the
// compilation" and drifted with whatever an earlier run had left behind: the
// same per-package figure came out at 23 s on one run and 80 s on the next.
//
// What is left needs no deletion:
//
//   cached       build something already built; the cost of asking
//   incremental  one source file in the shared foundation changes, and each
//                system rebuilds what it must. A unique edit per run produces
//                derivations nothing has built before, so this is real work
//                without deleting anything.
//
// A full from-source build is not measured. See FINDINGS.md.
import { execFileSync } from 'node:child_process'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'

const outputPath = process.argv[2] ?? 'results/benchmark.json'

// Fixed so the numbers are comparable between runs, and low enough not to
// swamp the machine.
const MAX_JOBS = '4'

const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    env: { ...process.env, NX_DAEMON: 'false' },
    ...options,
  })

const time = (label, fn) => {
  const started = process.hrtime.bigint()
  fn()
  const ms = Math.round(Number(process.hrtime.bigint() - started) / 1e6)
  console.error(`${label.padEnd(42)} ${String(ms).padStart(6)} ms`)
  return ms
}

const attrsWithPrefix = (prefix) =>
  JSON.parse(
    run('nix', [
      'eval',
      '--json',
      '.#packages.x86_64-linux',
      '--apply',
      `set: builtins.filter (n: builtins.match "${prefix}.*" n != null) (builtins.attrNames set)`,
    ]),
  )

// Appends something no run has appended before, so the derivations it
// invalidates have never been built and the timing is real work. Returns a
// function that puts the file back.
const mutate = (file) => {
  assertNoResidue([file])
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`
  appendFileSync(
    file,
    `\n// ${MUTATION_MARKER} ${stamp}\nconst unused${stamp} = 1\nvoid unused${stamp}\n`,
  )
  run('git', ['add', '--', file])
  return () => run('git', ['restore', '--staged', '--worktree', '--', file])
}

const buildAll = (attrs) =>
  run('nix', [
    'build',
    '--no-link',
    '--max-jobs',
    MAX_JOBS,
    ...NIX_OPTIONS,
    ...attrs.map((attr) => `.#${attr}`),
  ])

// A harness that crashes mid-mutation leaves its edit in the working tree, and
// a later `git add -A` can commit it. That residue is invisible to a clean-tree
// check, so refuse to start instead.
const MUTATION_MARKER = 'harness-mutation'

const assertNoResidue = (files) => {
  for (const file of files) {
    if (!existsSync(file)) continue
    if (readFileSync(file, 'utf8').includes(MUTATION_MARKER)) {
      throw new Error(
        `${file} already contains a harness mutation (${MUTATION_MARKER}); ` +
          'a previous run left it behind and it may have been committed',
      )
    }
  }
}

const LEVELS = [
  { id: 'per-package', prefix: 'test-' },
  { id: 'per-test-file', prefix: 'file-' },
  { id: 'per-test-file-narrow', prefix: 'narrow-' },
]

const results = {
  maxJobs: Number(MAX_JOBS),
  postBuildHookDisabled: true,
  nix: {},
  nx: {},
}

// Editing the shared Vitest config invalidates every test derivation at every
// granularity, and no build derivation, so this rebuilds each level's whole
// set from a state nothing has built. It is the well-defined replacement for
// the cold column that was withdrawn: same work, no store deletion.
const SHARED_TEST_CONFIG = 'vitest.shared.ts'

for (const level of LEVELS) {
  const attrs = attrsWithPrefix(level.prefix)
  buildAll(attrs)
  const cachedMs = time(`nix ${level.id} (cached)`, () => buildAll(attrs))

  const restore = mutate(SHARED_TEST_CONFIG)
  let everyUnitMs
  try {
    everyUnitMs = time(`nix ${level.id} (every unit rebuilt)`, () => buildAll(attrs))
  } finally {
    restore()
  }

  results.nix[level.id] = { derivations: attrs.length, cachedMs, everyUnitMs }
}

const SHARED_SOURCE = 'packages/core/src/hash.ts'
const allTestAttrs = attrsWithPrefix('test-')

buildAll(allTestAttrs)
run('node_modules/.bin/nx', ['run-many', '-t', 'test'])

{
  const restore = mutate(SHARED_SOURCE)
  try {
    results.nix.incrementalSharedSourceMs = time(
      'nix, every test, after a shared-source edit',
      () => buildAll(allTestAttrs),
    )
    results.nx.incrementalSharedSourceMs = time(
      'nx affected -t test, after the same edit',
      () => run('node_modules/.bin/nx', ['affected', '-t', 'test', '--base=HEAD']),
    )
  } finally {
    restore()
  }
}

// The fixed cost of one unit of work, measured directly rather than divided
// out of a total. An isolated leaf package whose tests take single-digit
// milliseconds, edited uniquely so nothing has built the result: what is left
// is almost entirely overhead.
const LEAF_SOURCE = 'packages/orphan/src/base32.ts'

buildAll(['test-orphan'])
run('node_modules/.bin/nx', ['run', '@nx-exp/orphan:test'])

{
  const restore = mutate(LEAF_SOURCE)
  try {
    results.nix.singleLeafDerivationMs = time(
      'nix, one leaf test derivation, after an edit',
      () => buildAll(['test-orphan']),
    )
    results.nx.singleLeafTaskMs = time(
      'nx, the same leaf test task, after the edit',
      () => run('node_modules/.bin/nx', ['run', '@nx-exp/orphan:test']),
    )
  } finally {
    restore()
  }
}

run('node_modules/.bin/nx', ['reset'])
results.nx.runManyColdMs = time('nx run-many -t test (empty nx cache)', () =>
  run('node_modules/.bin/nx', ['run-many', '-t', 'test']),
)
results.nx.runManyWarmMs = time('nx run-many -t test (warm)', () =>
  run('node_modules/.bin/nx', ['run-many', '-t', 'test']),
)

// Nx refuses to run the atomizer's *group* target without Nx Cloud, so the
// individual per-file targets are named explicitly instead. Those run locally
// with no such restriction, which is what makes the atomizer's file list usable
// by an orchestrator that is not Nx Cloud.
const atomized = JSON.parse(run('node', ['scripts/list-atomized-targets.mjs']))
results.nx.atomizedTaskCount = atomized.taskCount
results.nx.atomizedTargetNames = atomized.targetNames.length
try {
  run('node_modules/.bin/nx', ['run', '@nx-exp/core:test-ci'], { stdio: 'pipe' })
  results.nx.groupTargetRunsLocally = true
} catch (error) {
  results.nx.groupTargetRunsLocally = false
  results.nx.groupTargetRefusal =
    String(error.stdout ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .find((line) => line.includes('Nx Cloud')) ?? 'refused'
}

run('node_modules/.bin/nx', ['reset'])
results.nx.atomizedColdMs = time('nx atomized per-file tasks (empty cache)', () =>
  run('node_modules/.bin/nx', ['run-many', '-t', ...atomized.targetNames]),
)

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(results, null, 2)}\n`)
console.error(`wrote ${outputPath}`)
