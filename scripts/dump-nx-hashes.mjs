// Prints Nx's own task hashes as JSON, keyed by task id.
//
// The task hash is the fair counterpart to a Nix derivation path: both answer
// "would this unit of work be reused?". `nx show projects --affected` answers a
// coarser, project-level question and is not comparable.
import { readFileSync } from 'node:fs'
import { createProjectGraphAsync } from '@nx/devkit'
import { readNxJson } from 'nx/src/config/configuration.js'
import { createTaskGraph } from 'nx/src/tasks-runner/create-task-graph.js'
import { createTaskHasher } from 'nx/src/hasher/create-task-hasher.js'

const targets = (process.argv[2] ?? 'test').split(',')

const nxJson = readNxJson()
const projectGraph = await createProjectGraphAsync({ exitOnError: false })
const projectNames = Object.keys(projectGraph.nodes).sort()

const taskGraph = createTaskGraph(
  projectGraph,
  nxJson.targetDefaults ?? {},
  projectNames,
  targets,
  undefined,
  {},
)

const hasher = createTaskHasher(projectGraph, nxJson, {})
const taskIds = Object.keys(taskGraph.tasks).sort()
const tasks = taskIds.map((id) => taskGraph.tasks[id])
const perTaskEnvs = Object.fromEntries(tasks.map((task) => [task.id, process.env]))
const hashes = await hasher.hashTasks(tasks, taskGraph, perTaskEnvs)

process.stdout.write(
  `${JSON.stringify(
    Object.fromEntries(taskIds.map((id, index) => [id, hashes[index].value])),
    null,
    2,
  )}\n`,
)
