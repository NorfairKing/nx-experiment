// Prints the atomizer's per-test-file targets, which are the closest thing Nx
// has to a per-test-file unit of work.
//
// A target name is scoped to its project, so the same test file path in two
// projects yields two tasks under one name. `targetNames` is what `nx run-many
// -t` takes (it runs the name in every project that has it); `taskCount` is the
// number of tasks that actually implies.
import { createProjectGraphAsync } from '@nx/devkit'

const graph = await createProjectGraphAsync({ exitOnError: false })
const tasks = []
for (const [project, node] of Object.entries(graph.nodes)) {
  for (const target of Object.keys(node.data.targets ?? {})) {
    if (target.startsWith('test-ci--')) tasks.push(`${project}:${target}`)
  }
}
const targetNames = [...new Set(tasks.map((task) => task.split(':')[1]))].sort()

process.stdout.write(
  `${JSON.stringify({ targetNames, taskCount: tasks.length, tasks: tasks.sort() }, null, 2)}\n`,
)
