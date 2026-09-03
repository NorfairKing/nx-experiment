// Measures how Nix evaluation scales with project count.
//
// This is the question that decides whether the architecture holds at size:
// evaluation happens on every invocation, before any build, and it is the one
// cost that plausibly grows with the workspace.
//
// Nothing is built and nothing is installed. A fixed-output derivation's path
// depends only on its name and hash, so pnpmDeps evaluates without being
// fetched. That makes this measurement cheap and safe to repeat.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const outputPath = process.argv[2] ?? 'results/scale.json'
const sizes = (process.argv[3] ?? '25,50,100,200,400').split(',').map(Number)
const RUNS = 3

const run = (command, args) =>
  execFileSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, NX_DAEMON: 'false' },
  })

const DRV_APPLY = `set:
  builtins.length (builtins.attrValues (builtins.mapAttrs (n: v: v.drvPath)
    (builtins.listToAttrs (map (name: { inherit name; value = set.\${name}; })
      (builtins.filter (name: builtins.match "(build|test)-.*" name != null)
        (builtins.attrNames set))))))`

const measure = (dir) => {
  const times = []
  let derivations = 0
  for (let i = 0; i < RUNS; i++) {
    const started = process.hrtime.bigint()
    const out = run('nix', [
      'eval',
      '--json',
      `path:${resolve(dir)}#packages.x86_64-linux`,
      '--apply',
      DRV_APPLY,
    ])
    times.push(Math.round(Number(process.hrtime.bigint() - started) / 1e6))
    derivations = JSON.parse(out)
  }
  return { derivations, times: times.sort((a, b) => a - b) }
}

// Does package size matter, or only project count? Evaluation copies each
// project directory into the store, so a workspace of large uneven packages
// could cost more than a uniform synthetic one. Measured at one size, both
// ways, rather than left as a caveat.
const measureVariation = (size) => {
  const shapes = ['uniform', 'varied'].map((shape) => {
    const dir = `scale/${shape}-${size}`
    run('node', [
      'scripts/generate-scale-workspace.mjs',
      String(size),
      dir,
      ...(shape === 'varied' ? ['varied'] : []),
    ])
    const sourceBytes = Number(
      run('bash', [
        '-c',
        `find ${dir} -name '*.ts' -exec cat {} + | wc -c`,
      ]).trim(),
    )
    const { derivations, times } = measure(dir)
    const median = times[Math.floor(times.length / 2)]
    console.error(
      `${shape.padEnd(8)} ${String(sourceBytes).padStart(8)} source bytes  ` +
        `${String(derivations).padStart(4)} derivations  eval ${String(median).padStart(5)} ms`,
    )
    return { shape, sourceBytes, derivations, evaluationMs: median }
  })
  return shapes
}

const results = []
for (const size of sizes) {
  const dir = `scale/${size}`
  const generated = run('node', ['scripts/generate-scale-workspace.mjs', String(size), dir])
  const projects = Number(/generated \S+: (\d+) projects/.exec(generated ?? '')?.[1] ?? 0)

  // The generator reports on stderr; read the count back from the manifests
  // instead of trusting a parse.
  const actualProjects = run('bash', [
    '-c',
    `ls -d ${dir}/packages/*/ ${dir}/apps/*/ 2>/dev/null | wc -l`,
  ]).trim()

  const { derivations, times } = measure(dir)
  const median = times[Math.floor(times.length / 2)]
  const entry = {
    requested: size,
    projects: Number(actualProjects),
    derivations,
    evaluationMs: { min: times[0], median, max: times[times.length - 1] },
    msPerProject: Number((median / Number(actualProjects)).toFixed(1)),
  }
  results.push(entry)
  console.error(
    `${String(entry.projects).padStart(4)} projects  ` +
      `${String(derivations).padStart(4)} derivations  ` +
      `eval ${String(median).padStart(6)} ms  ` +
      `${String(entry.msPerProject).padStart(5)} ms/project`,
  )
  void projects
}

const VARIATION_SIZE = 200
const variation = measureVariation(VARIATION_SIZE)

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(
  outputPath,
  `${JSON.stringify(
    {
      note:
        'Evaluation only: nothing built, nothing installed. Three runs per size, ' +
        'median reported. Derivations counts one build and one test per project.',
      runsPerSize: RUNS,
      sizes: results,
      variation: {
        note:
          'Same project count, uniform small packages against uneven larger ones, ' +
          'to test whether evaluation cost tracks source size or only project count.',
        requestedProjects: VARIATION_SIZE,
        shapes: variation,
      },
    },
    null,
    2,
  )}\n`,
)
console.error(`wrote ${outputPath}`)
