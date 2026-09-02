// Handoff section 17: deliberately break things that a granular scheme could
// get wrong, and record which mechanism notices.
//
// Section 17's rule is that a conservative system running a little too much
// beats one that silently omits tests, so what matters for each case is not
// only whether it is caught but *how*: a build failure is loud and acceptable,
// a passing check that ran fewer tests is the dangerous outcome.
//
// Each case mutates tracked files and is reverted in a finally block. The
// working tree must be clean to start.
import { execFileSync } from 'node:child_process'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'

const outputPath = process.argv[2] ?? 'results/correctness-probes.json'

const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, NX_DAEMON: 'false' },
    ...options,
  })

const succeeds = (command, args) => {
  try {
    run(command, args, { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

const nixBuilds = (attr) => succeeds('nix', ['build', `.#${attr}`, '--no-link'])

// Which workspace edges Nx reports for a project, and which of those no
// manifest explains. The second list is what the bridge would silently drop.
const nxEdgesFor = (project) => {
  run('node_modules/.bin/nx', ['reset'])
  run('node_modules/.bin/nx', [
    'graph',
    '--file=results/nx-graph-probe.json',
  ])
  const { graph } = JSON.parse(readFileSync('results/nx-graph-probe.json', 'utf8'))
  const edges = (graph.dependencies[project] ?? [])
    .filter((edge) => edge.target in graph.nodes)
    .map((edge) => edge.target)
    .sort()
  const root = graph.nodes[project].data.root
  const manifest = JSON.parse(readFileSync(`${root}/package.json`, 'utf8'))
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ])
  return { edges, undeclared: edges.filter((edge) => !declared.has(edge)) }
}

const assertClean = () => {
  const status = run('git', ['status', '--porcelain'])
  if (status.trim() !== '') throw new Error(`working tree is not clean:\n${status}`)
}

const CASES = [
  {
    id: 'undeclared-import',
    description:
      'a leaf package imports a workspace package its manifest does not declare',
    files: ['packages/orphan/src/base32.ts'],
    apply() {
      const path = 'packages/orphan/src/base32.ts'
      writeFileSync(
        path,
        `import { fnv1a } from '@nx-exp/core'\nvoid fnv1a\n${readFileSync(path, 'utf8')}`,
      )
    },
    measure() {
      return {
        buildDerivationSucceeds: nixBuilds('build-orphan'),
        testDerivationSucceeds: nixBuilds('test-orphan'),
        graphGuardSucceeds: nixBuilds('graphAgreement'),
        nx: nxEdgesFor('@nx-exp/orphan'),
      }
    },
  },
  {
    id: 'type-error-in-leaf',
    description:
      'a type error in a leaf package, in code no test exercises',
    files: ['packages/orphan/src/base32.ts'],
    apply() {
      appendFileSync(
        'packages/orphan/src/base32.ts',
        '\nexport function alphabetSize(): number {\n  const size: number = "thirty-two"\n  return size\n}\n',
      )
    },
    measure() {
      return {
        buildDerivationSucceeds: nixBuilds('build-orphan'),
        testDerivationSucceeds: nixBuilds('test-orphan'),
        graphGuardSucceeds: nixBuilds('graphAgreement'),
      }
    },
  },
  {
    id: 'tsconfig-path-alias-across-packages',
    description:
      'a package reaches into another package through a tsconfig paths alias, with nothing in its manifest',
    files: ['packages/orphan/tsconfig.json', 'packages/orphan/src/base32.ts'],
    apply() {
      const tsconfig = JSON.parse(readFileSync('packages/orphan/tsconfig.json', 'utf8'))
      tsconfig.compilerOptions.paths = { '#core/*': ['../core/src/*'] }
      writeFileSync('packages/orphan/tsconfig.json', `${JSON.stringify(tsconfig, null, 2)}\n`)
      const path = 'packages/orphan/src/base32.ts'
      writeFileSync(
        path,
        `import { fnv1a } from '#core/hash.js'\nvoid fnv1a\n${readFileSync(path, 'utf8')}`,
      )
    },
    measure() {
      return {
        buildDerivationSucceeds: nixBuilds('build-orphan'),
        testDerivationSucceeds: nixBuilds('test-orphan'),
        graphGuardSucceeds: nixBuilds('graphAgreement'),
        nx: nxEdgesFor('@nx-exp/orphan'),
      }
    },
  },
  {
    id: 'generated-source',
    description:
      'a source file produced by a generator and not committed, imported by committed code',
    files: ['packages/orphan/src/base32.ts'],
    extraPaths: ['packages/orphan/src/generated.ts'],
    apply() {
      // Not staged: this is what an uncommitted generated file looks like.
      writeFileSync(
        'packages/orphan/src/generated.ts',
        'export const GENERATED_MARKER = 0xabcd\n',
      )
      const path = 'packages/orphan/src/base32.ts'
      writeFileSync(
        path,
        `import { GENERATED_MARKER } from './generated.js'\nvoid GENERATED_MARKER\n${readFileSync(path, 'utf8')}`,
      )
    },
    measure() {
      return {
        buildDerivationSucceeds: nixBuilds('build-orphan'),
        testDerivationSucceeds: nixBuilds('test-orphan'),
        graphGuardSucceeds: nixBuilds('graphAgreement'),
        generatedFileIsTrackedByGit:
          run('git', ['ls-files', 'packages/orphan/src/generated.ts']).trim() !== '',
      }
    },
  },
]

assertClean()

const results = []
for (const testCase of CASES) {
  let measured
  try {
    testCase.apply()
    // Nix reads the git tree, so a mutation has to be staged to be visible at
    // all. A case that deliberately leaves a file untracked says so.
    run('git', ['add', '--', ...testCase.files])
    measured = testCase.measure()
  } finally {
    run('git', ['restore', '--staged', '--worktree', '--', ...testCase.files])
    for (const path of testCase.extraPaths ?? []) rmSync(path, { force: true })
    run('git', ['checkout', '--', '.'])
    if (existsSync('results/nx-graph-probe.json')) {
      rmSync('results/nx-graph-probe.json', { force: true })
    }
  }
  assertClean()

  results.push({ ...testCase, apply: undefined, measure: undefined, measured })
  const caught = [
    measured.buildDerivationSucceeds === false ? 'build' : null,
    measured.testDerivationSucceeds === false ? 'test' : null,
    measured.graphGuardSucceeds === false ? 'graph guard' : null,
  ].filter(Boolean)
  console.error(
    `${testCase.id.padEnd(36)} caught by: ${caught.length > 0 ? caught.join(', ') : 'NOTHING'}`,
  )
}

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(
  outputPath,
  `${JSON.stringify(
    results.map(({ id, description, measured }) => ({ id, description, measured })),
    null,
    2,
  )}\n`,
)
console.error(`wrote ${outputPath}`)
