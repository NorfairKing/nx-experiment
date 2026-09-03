// Architecture D: would deriving Nix derivations from Nx's *task* graph give a
// different set than deriving them from the project graph?
//
// FINDINGS argued not, from the shape of the data, and said plainly that it was
// never built. This measures it instead, without building a parallel
// implementation: if the two graphs are isomorphic — same nodes, same edges —
// then generating derivations from either produces the same derivations, and
// there is nothing to gain.
//
// Nodes are compared as `<project>:<target>` against `<build|test>-<project>`,
// and edges as the dependencies each unit would have to wait for.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createProjectGraphAsync } from '@nx/devkit'
import { readNxJson } from 'nx/src/config/configuration.js'
import { createTaskGraph } from 'nx/src/tasks-runner/create-task-graph.js'

const outputPath = process.argv[2] ?? 'results/task-graph-comparison.json'

const run = (command, args) =>
  execFileSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

const attrOf = (projectName) => projectName.replace(/^@[^/]+\//, '')

// --- what Nix builds, from the project graph it derives during evaluation
const projects = JSON.parse(
  run('nix', [
    'eval',
    '--json',
    '--impure',
    '--expr',
    'let lib = (import <nixpkgs> { }).lib; in (import ./nix/graph.nix { inherit lib; }).projects',
  ]),
)

const nixUnits = new Map()
for (const [attr, project] of Object.entries(projects)) {
  // A build waits for its runtime dependencies' builds.
  nixUnits.set(`build-${attr}`, project.runtimeDeps.map((d) => `build-${d}`).sort())
  // A test waits for its dependencies' builds, dev ones included, and not for
  // its own build: the tests import src directly.
  nixUnits.set(
    `test-${attr}`,
    [...project.runtimeDeps, ...project.devDeps].map((d) => `build-${d}`).sort(),
  )
}

// --- what Nx's task graph says
const nxJson = readNxJson()
const projectGraph = await createProjectGraphAsync({ exitOnError: false })
const projectNames = Object.keys(projectGraph.nodes).sort()
const taskGraph = createTaskGraph(
  projectGraph,
  nxJson.targetDefaults ?? {},
  projectNames,
  ['test'],
  undefined,
  {},
)

const taskToUnit = (taskId) => {
  const [project, target] = taskId.split(':')
  return `${target}-${attrOf(project)}`
}

const nxUnits = new Map()
for (const [taskId, deps] of Object.entries(taskGraph.dependencies)) {
  nxUnits.set(taskToUnit(taskId), deps.map(taskToUnit).sort())
}

// --- compare
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])

const onlyInNix = [...nixUnits.keys()].filter((u) => !nxUnits.has(u)).sort()
const onlyInNx = [...nxUnits.keys()].filter((u) => !nixUnits.has(u)).sort()
const edgeDifferences = []
for (const [unit, deps] of nixUnits) {
  if (!nxUnits.has(unit)) continue
  const theirs = nxUnits.get(unit)
  if (!sameList(deps, theirs)) {
    edgeDifferences.push({ unit, fromProjectGraph: deps, fromTaskGraph: theirs })
  }
}

const isomorphic =
  onlyInNix.length === 0 && onlyInNx.length === 0 && edgeDifferences.length === 0

const result = {
  note:
    'Nodes and edges of the units each graph would generate. Isomorphic means ' +
    'architecture D generates the same derivations as architecture A, so there ' +
    'is nothing to gain from it in this workspace.',
  nixUnits: nixUnits.size,
  nxUnits: nxUnits.size,
  onlyInNix,
  onlyInNx,
  edgeDifferences,
  isomorphic,
}

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`)
console.error(
  `nix units ${result.nixUnits}, nx task units ${result.nxUnits}\n` +
    `only in nix: ${onlyInNix.length ? onlyInNix.join(', ') : 'none'}\n` +
    `only in nx:  ${onlyInNx.length ? onlyInNx.join(', ') : 'none'}\n` +
    `edge differences: ${edgeDifferences.length}\n` +
    `isomorphic: ${isomorphic}`,
)
