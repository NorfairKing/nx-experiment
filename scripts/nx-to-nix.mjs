// Translates the Nx graph dump into the project table the Nix prototypes read.
//
// Nx's project graph collapses `dependencies` and `devDependencies` into one
// edge set (both arrive as type "static"), so the runtime/test split is
// recovered from the manifests instead. Keeping them apart is what lets a Nix
// test derivation depend on a test-only package without its build derivation
// depending on it too.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const graphPath = process.argv[2] ?? 'results/nx-graph.json'
const outputPath = process.argv[3] ?? 'nix/projects.json'

const graph = JSON.parse(readFileSync(graphPath, 'utf8'))

const attrOf = (projectName) => projectName.replace(/^@nx-exp\//, '')

const projects = {}
for (const [name, project] of Object.entries(graph.projects)) {
  const manifest = JSON.parse(
    readFileSync(join(project.root, 'package.json'), 'utf8'),
  )
  const workspaceOnly = (record) =>
    Object.keys(record ?? {})
      .filter((dep) => dep in graph.projects)
      .map(attrOf)
      .sort()

  const runtimeDeps = workspaceOnly(manifest.dependencies)
  const devDeps = workspaceOnly(manifest.devDependencies)

  const nxEdges = (graph.internalDependencies[name] ?? []).map((edge) =>
    attrOf(edge.target),
  )
  const unclassified = nxEdges
    .filter((dep) => !runtimeDeps.includes(dep) && !devDeps.includes(dep))
    .sort()

  projects[attrOf(name)] = {
    name,
    root: project.root,
    runtimeDeps,
    devDeps,
    unclassifiedNxEdges: unclassified,
    testFiles: project.files
      .filter((file) => file.startsWith(`${project.root}/tests/`))
      .map((file) => file.slice(project.root.length + 1))
      .sort(),
  }
}

const output = {
  generatedFrom: {
    nxVersion: graph.nxVersion,
    graph: graphPath,
  },
  projects,
}

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`)

const totalTestFiles = Object.values(projects).reduce(
  (sum, p) => sum + p.testFiles.length,
  0,
)
console.error(
  `wrote ${outputPath}: ${Object.keys(projects).length} projects, ${totalTestFiles} test files`,
)
