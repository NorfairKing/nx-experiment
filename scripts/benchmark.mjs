// Times each granularity level and the Nx baseline.
//
// A test run is not reproducible, so `nix build --rebuild` cannot be used to
// force real work; the cold measurement deletes the outputs instead. A path the
// store still considers alive cannot be deleted, so each run records how many
// of its outputs were actually removed: a run that could not be fully emptied
// is reported rather than presented as cold.
//
// Wall clock here includes each runner's fixed startup cost, which is the
// point: it is what finer granularity has to pay for.
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
  console.error(`${label.padEnd(36)} ${String(ms).padStart(6)} ms`)
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

// nix path-info refuses a path that is not in the store yet, which is exactly
// the state after a deletion, so the output paths are evaluated instead.
const outPathsOf = (attrs) =>
  attrs.map((attr) =>
    run('nix', ['eval', '--raw', `.#${attr}.outPath`]).trim(),
  )

const isValid = (path) => {
  try {
    run('nix', ['path-info', path], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

// Deletes what it can and reports what survived, one path at a time so one
// live path does not abort the rest.
const deleteOutputs = (paths) => {
  for (const path of paths) {
    try {
      run('nix', ['store', 'delete', path], { stdio: 'pipe' })
    } catch {
      // Still alive: a concurrent nix process may hold a temporary root.
    }
  }
  return paths.filter((path) => !isValid(path)).length
}

const NIX_LEVELS = [
  { id: 'per-package', prefix: 'test-' },
  { id: 'per-test-file', prefix: 'file-' },
  { id: 'per-test-file-narrow', prefix: 'narrow-' },
]

const results = { nix: {}, nx: {} }

// allTests pins every per-package test output, so it has to go first.
deleteOutputs(outPathsOf(['allTests']))

for (const level of NIX_LEVELS) {
  const attrs = attrsWithPrefix(level.prefix)
  buildAll(attrs)
  const outPaths = outPathsOf(attrs)
  const deleted = deleteOutputs(outPaths)
  results.nix[level.id] = {
    derivations: attrs.length,
    outputsDeletedBeforeColdRun: `${deleted}/${outPaths.length}`,
    coldMs: time(`nix ${level.id} (cold)`, () => buildAll(attrs)),
    cachedMs: time(`nix ${level.id} (cached)`, () => buildAll(attrs)),
  }
}

function buildAll(attrs) {
  return run('nix', ['build', '--no-link', ...attrs.map((a) => `.#${a}`)])
}

run('node_modules/.bin/nx', ['reset'])
results.nx.runManyColdMs = time('nx run-many -t test (cold)', () =>
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
results.nx.atomizedColdMs = time('nx atomized per-file tasks (cold)', () =>
  run('node_modules/.bin/nx', ['run-many', '-t', ...atomized.targetNames]),
)

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(results, null, 2)}\n`)
console.error(`wrote ${outputPath}`)
