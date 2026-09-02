// Translates Nx's graph into the project table the Nix prototypes read.
//
// The input is the graph Nx exports through its documented command:
//
//   nx graph --file=results/nx-graph-export.json
//
// That export carries everything the bridge needs: each project's root, the
// dependency edges, and the atomizer's per-test-file target names, from which
// the test file paths are read. No Nx internals are involved, so the bridge
// does not break when Nx moves something under nx/src. (scripts/dump-nx.mjs
// does reach into internals, but only to measure Nx's task inputs and hashes
// for the comparison; nothing the prototypes build depends on it.)
//
// The one thing the export does not carry is the difference between a
// dependency and a dev dependency: Nx reports both as `type: "static"`. That is
// recovered from the manifests, and it is what lets a Nix test derivation
// depend on a test-only package without its build derivation depending on it.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const exportPath = process.argv[2] ?? 'results/nx-graph-export.json'
const outputPath = process.argv[3] ?? 'nix/projects.json'

const { graph } = JSON.parse(readFileSync(exportPath, 'utf8'))

const attrOf = (projectName) => projectName.replace(/^@nx-exp\//, '')

const ATOMIZED_PREFIX = 'test-ci--'

const projects = {}
for (const [name, node] of Object.entries(graph.nodes)) {
  const root = node.data.root
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

  const workspaceOnly = (record) =>
    Object.keys(record ?? {})
      .filter((dep) => dep in graph.nodes)
      .map(attrOf)
      .sort()

  const runtimeDeps = workspaceOnly(manifest.dependencies)
  const devDeps = workspaceOnly(manifest.devDependencies)

  // Any edge Nx reports that neither manifest section explains. An import Nx
  // resolved but nobody declared would show up here rather than being silently
  // folded into one of the two lists.
  const unclassifiedNxEdges = (graph.dependencies[name] ?? [])
    .map((edge) => attrOf(edge.target))
    .filter((dep) => !runtimeDeps.includes(dep) && !devDeps.includes(dep))
    .sort()

  projects[attrOf(name)] = {
    name,
    root,
    runtimeDeps,
    devDeps,
    unclassifiedNxEdges,
    testFiles: Object.keys(node.data.targets ?? {})
      .filter((target) => target.startsWith(ATOMIZED_PREFIX))
      .map((target) => target.slice(ATOMIZED_PREFIX.length))
      .sort(),
  }
}

const output = { generatedFrom: exportPath, projects }

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`)

const totalTestFiles = Object.values(projects).reduce(
  (sum, project) => sum + project.testFiles.length,
  0,
)
const unclassified = Object.entries(projects).filter(
  ([, project]) => project.unclassifiedNxEdges.length > 0,
)
for (const [attr, project] of unclassified) {
  console.error(
    `${attr}: Nx reports edges no manifest declares: ${project.unclassifiedNxEdges.join(', ')}`,
  )
}
console.error(
  `wrote ${outputPath}: ${Object.keys(projects).length} projects, ${totalTestFiles} test files`,
)
