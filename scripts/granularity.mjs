// Measures what each granularity level costs and what it buys.
//
// Node count and evaluation time are the cost; the invalidation counts are the
// benefit. Both are measured the same way for every level, so the ratio is
// comparable even though the absolute numbers are specific to this workspace.
//
// Evaluation time is whatever Nix's own caching gives on a repeated call; there
// is no attempt to force a cold evaluator, because nothing cheap does that.
// Treat the figures as a comparison between levels, not as absolute cost.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { dirname } from 'node:path'

const outputPath = process.argv[2] ?? 'results/granularity.json'

const run = (command, args) =>
  execFileSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, NX_DAEMON: 'false' },
  })

const LEVELS = [
  {
    id: 'per-package',
    prefix: 'test-',
    description: 'one Vitest derivation per package',
  },
  {
    id: 'per-test-file',
    prefix: 'file-',
    description: 'one derivation per test file, whole tests directory as input',
  },
  {
    id: 'per-test-file-narrow',
    prefix: 'narrow-',
    description: 'one derivation per test file, only that file as input',
  },
]

const drvPathsFor = (prefix) => {
  const apply = `set:
    builtins.listToAttrs (
      map (name: { inherit name; value = set.\${name}.drvPath; })
        (builtins.filter (name: builtins.match "${prefix}.*" name != null)
          (builtins.attrNames set))
    )`
  const started = process.hrtime.bigint()
  const paths = JSON.parse(
    run('nix', ['eval', '--json', '.#packages.x86_64-linux', '--apply', apply]),
  )
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6
  return { paths, elapsedMs }
}

const MUTATIONS = [
  {
    id: 'one-test-file',
    file: 'packages/core/tests/hash.test.ts',
    apply: (file) =>
      appendFileSync(
        file,
        "\nit('is an added assertion', () => {\n  expect(fnv1a('x')).toBe(fnv1a('x'))\n})\n",
      ),
  },
  {
    id: 'shared-source',
    file: 'packages/core/src/hash.ts',
    apply: (file) => appendFileSync(file, '\nconst unused = 1\nvoid unused\n'),
  },
]

const assertClean = () => {
  const status = run('git', ['status', '--porcelain'])
  if (status.trim() !== '') throw new Error(`working tree is not clean:\n${status}`)
}

assertClean()

const levels = []
for (const level of LEVELS) {
  const { paths, elapsedMs } = drvPathsFor(level.prefix)
  levels.push({
    ...level,
    nodeCount: Object.keys(paths).length,
    evaluationMs: Math.round(elapsedMs),
    baseline: paths,
  })
}

const invalidation = []
for (const mutation of MUTATIONS) {
  try {
    mutation.apply(mutation.file)
    run('git', ['add', '--', mutation.file])

    const perLevel = {}
    for (const level of levels) {
      const { paths } = drvPathsFor(level.prefix)
      const changed = Object.keys(level.baseline).filter(
        (attr) => paths[attr] !== level.baseline[attr],
      )
      perLevel[level.id] = {
        invalidated: changed.length,
        total: level.nodeCount,
        attrs: changed.sort(),
      }
    }
    invalidation.push({ id: mutation.id, file: mutation.file, levels: perLevel })
  } finally {
    run('git', ['restore', '--staged', '--worktree', '--', mutation.file])
  }
  assertClean()
}

const output = {
  levels: levels.map(({ baseline, ...rest }) => rest),
  invalidation,
}

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`)

for (const level of output.levels) {
  console.error(
    `${level.id.padEnd(22)} nodes ${String(level.nodeCount).padStart(3)}   eval ${String(level.evaluationMs).padStart(5)}ms`,
  )
}
for (const entry of invalidation) {
  const parts = Object.entries(entry.levels)
    .map(([id, v]) => `${id}=${v.invalidated}/${v.total}`)
    .join('  ')
  console.error(`${entry.id.padEnd(22)} ${parts}`)
}
console.error(`wrote ${outputPath}`)
