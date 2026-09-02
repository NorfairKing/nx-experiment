// Exports Nx's project graph, task graph and per-task input specifications as
// JSON, so the Nix side can consume Nx's analysis without running Nx.
//
// Every Nx entry point below except createProjectGraphAsync is reached through
// `nx/src/...`, which the `nx` package exposes but does not document as a
// public API; treat the shapes here as pinned to the nx version in the lockfile.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { createProjectGraphAsync } from '@nx/devkit'
import { readNxJson } from 'nx/src/config/configuration.js'
import { createProjectFileMapUsingProjectGraph } from 'nx/src/project-graph/file-map-utils.js'
import { createTaskGraph } from 'nx/src/tasks-runner/create-task-graph.js'
import { getInputs, getTargetInputs } from 'nx/src/hasher/task-hasher.js'

const targets = (process.argv[2] ?? 'test').split(',')
const outputPath = process.argv[3] ?? 'results/nx-graph.json'

const nxJson = readNxJson()
const projectGraph = await createProjectGraphAsync({ exitOnError: false })
const fileMap = await createProjectFileMapUsingProjectGraph(projectGraph)

const workspaceProjects = Object.keys(projectGraph.nodes).sort()

const internalDependencies = Object.fromEntries(
  workspaceProjects.map((name) => [
    name,
    (projectGraph.dependencies[name] ?? [])
      .filter((edge) => edge.target in projectGraph.nodes)
      .map((edge) => ({ target: edge.target, type: edge.type }))
      .sort((a, b) => a.target.localeCompare(b.target)),
  ]),
)

const projects = Object.fromEntries(
  workspaceProjects.map((name) => {
    const node = projectGraph.nodes[name]
    return [
      name,
      {
        root: node.data.root,
        projectType: node.data.projectType ?? null,
        targets: Object.keys(node.data.targets ?? {}).sort(),
        files: (fileMap[name] ?? []).map((f) => f.file).sort(),
        targetInputs: Object.fromEntries(
          Object.keys(node.data.targets ?? {})
            .sort()
            .map((target) => [target, getTargetInputs(nxJson, node, target)]),
        ),
      },
    ]
  }),
)

const taskGraph = createTaskGraph(
  projectGraph,
  nxJson.targetDefaults ?? {},
  workspaceProjects,
  targets,
  undefined,
  {},
)

const taskInputs = Object.fromEntries(
  Object.keys(taskGraph.tasks)
    .sort()
    .map((id) => [id, getInputs(taskGraph.tasks[id], projectGraph, nxJson)]),
)

const output = {
  nxVersion: JSON.parse(readFileSync('node_modules/nx/package.json', 'utf8'))
    .version,
  targets,
  projects,
  internalDependencies,
  taskGraph: {
    roots: [...taskGraph.roots].sort(),
    tasks: Object.fromEntries(
      Object.keys(taskGraph.tasks)
        .sort()
        .map((id) => [
          id,
          {
            project: taskGraph.tasks[id].target.project,
            target: taskGraph.tasks[id].target.target,
            outputs: taskGraph.tasks[id].outputs ?? [],
          },
        ]),
    ),
    dependencies: Object.fromEntries(
      Object.keys(taskGraph.dependencies)
        .sort()
        .map((id) => [id, [...taskGraph.dependencies[id]].sort()]),
    ),
  },
  taskInputs,
}

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`)
console.error(
  `wrote ${outputPath}: ${workspaceProjects.length} projects, ${Object.keys(taskGraph.tasks).length} tasks`,
)
