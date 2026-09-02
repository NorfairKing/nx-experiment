// Times a cold run of each granularity level, and the Nx baseline.
//
// "Cold" means the outputs are deleted from the Nix store first, so the timing
// is real work rather than a cache lookup. The Nx numbers clear the Nx cache
// the same way. Wall clock here includes each runner's fixed startup cost,
// which is the point: it is what finer granularity has to pay for.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const outputPath = process.argv[2] ?? 'results/benchmark.json'

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
  console.error(`${label.padEnd(34)} ${String(ms).padStart(6)} ms`)
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

const buildAll = (attrs) => run('nix', ['build', '--no-link', ...attrs.map((a) => `.#${a}`)])

// A test run is not reproducible, so --rebuild cannot be used to force real
// work. Cold timing deletes the outputs instead. The aggregate allTests
// derivation references every per-package test output and has to go first, or
// those deletions are refused.
const outPathsOf = (attrs) =>
  run('nix', ['path-info', ...attrs.map((a) => `.#${a}`)]).split('\n').filter(Boolean)

const deleteOutputs = (paths) => run('nix', ['store', 'delete', ...paths])

const NIX_LEVELS = [
  { id: 'per-package', prefix: 'test-' },
  { id: 'per-test-file', prefix: 'file-' },
  { id: 'per-test-file-narrow', prefix: 'narrow-' },
]

const results = { nix: {}, nx: {} }

// allTests pins every per-package test output; drop it before deleting.
try {
  deleteOutputs(outPathsOf(['allTests']))
} catch {
  // Not built yet, nothing to drop.
}

for (const level of NIX_LEVELS) {
  const attrs = attrsWithPrefix(level.prefix)
  buildAll(attrs)
  deleteOutputs(outPathsOf(attrs))
  results.nix[level.id] = {
    derivations: attrs.length,
    coldMs: time(`nix ${level.id} (cold)`, () => buildAll(attrs)),
    cachedMs: time(`nix ${level.id} (cached)`, () => buildAll(attrs)),
  }
  deleteOutputs(outPathsOf(attrs))
}

run('pnpm', ['exec', 'nx', 'reset'])
results.nx.runManyColdMs = time('nx run-many -t test (cold)', () =>
  run('pnpm', ['exec', 'nx', 'run-many', '-t', 'test']),
)
results.nx.runManyWarmMs = time('nx run-many -t test (warm)', () =>
  run('pnpm', ['exec', 'nx', 'run-many', '-t', 'test']),
)

// Nx refuses to run the atomizer's *group* target without Nx Cloud, so the
// individual per-file targets are named explicitly instead. Those run locally
// with no such restriction, which is what makes the atomizer's file list
// usable by an orchestrator that is not Nx Cloud.
const atomized = JSON.parse(run('node', ['scripts/list-atomized-targets.mjs']))
results.nx.atomizedTaskCount = atomized.taskCount
results.nx.atomizedTargetNames = atomized.targetNames.length
try {
  run('pnpm', ['exec', 'nx', 'run', '@nx-exp/core:test-ci'])
  results.nx.groupTargetRunsLocally = true
} catch (error) {
  results.nx.groupTargetRunsLocally = false
  results.nx.groupTargetRefusal = String(error.stdout ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .find((line) => line.includes('Nx Cloud')) ?? 'refused'
}

run('pnpm', ['exec', 'nx', 'reset'])
results.nx.atomizedColdMs = time('nx atomized per-file tasks (cold)', () =>
  run('pnpm', ['exec', 'nx', 'run-many', '-t', ...atomized.targetNames]),
)

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(results, null, 2)}\n`)
console.error(`wrote ${outputPath}`)
