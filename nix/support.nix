# Machinery shared by the per-package and per-test-file prototypes: how a
# workspace skeleton is assembled around one package, and how a Vitest run is
# turned into a deterministic output.
{ lib
, writeText
, workspace
}:
rec {
  repoRoot = ../.;

  table = builtins.fromJSON (builtins.readFile ./projects.json);

  # Read by every tsc and vitest invocation through a relative path, so every
  # derivation legitimately depends on them.
  sharedFiles = [
    (repoRoot + "/tsconfig.base.json")
    (repoRoot + "/vitest.shared.ts")
  ];

  projectPath = project: suffix: repoRoot + "/${project.root}/${suffix}";

  toSource = name: fileset: lib.fileset.toSource
    {
      root = repoRoot;
      inherit fileset;
    } // { inherit name; };

  # Node resolves a bare specifier by walking up from the *importing* file, so a
  # dependency's store path can only satisfy its own imports if it carries its
  # own node_modules. Giving every build output one makes each store path a
  # self-contained runtime closure, and makes Nix's recorded references match
  # the package graph.
  linkDepsInto = builds: dir: deps: lib.concatMapStringsSep "\n"
    (dep: "ln -sfn ${builds.${dep}} ${dir}/node_modules/@nx-exp/${dep}")
    deps;

  prepareTree = builds: project: deps: ''
    export HOME=$TMPDIR
    export CI=true
    ln -s ${workspace.nodeModules}/node_modules ./node_modules
    mkdir -p ${project.root}/node_modules/@nx-exp
    ${linkDepsInto builds project.root deps}
  '';

  # Vitest's own output carries a wall-clock start time and per-file durations,
  # so storing it verbatim makes the derivation non-reproducible, which defeats
  # `nix build --rebuild` and any content-addressed early cutoff. The summary
  # keeps which files ran and how many assertions passed, and drops the timing.
  normalizeLog = writeText "normalize-vitest-log.mjs" ''
    import { readFileSync } from 'node:fs'

    const plain = readFileSync(process.argv[2], 'utf8').replace(
      /\x1b\[[0-9;]*m/g,
      "",
    )

    const outcomes = []
    const totals = []
    for (const line of plain.split("\n")) {
      // A result line is "<mark> <project label> <file> (<n> tests) <duration>";
      // the lazy prefix skips the label so the file is the token before the count.
      const outcome = line.match(/^\s*([✓×↓])\s+.*?(\S+)\s+\((\d+) tests?\)/)
      if (outcome) {
        outcomes.push(outcome[1] + " " + outcome[2] + " (" + outcome[3] + " tests)")
        continue
      }
      const total = line.match(/^\s*(Test Files|Tests)\s+(.*?)\s*$/)
      if (total) totals.push(total[1] + " " + total[2])
    }

    process.stdout.write([...outcomes.sort(), ...totals].join("\n") + "\n")
  '';

  # Runs Vitest from the project directory and records a deterministic summary.
  # Without pipefail the exit status would be tee's, so a failing test would
  # still produce a successful derivation.
  runVitest = project: files: ''
    vitest=$PWD/node_modules/.bin/vitest
    node_bin=$(command -v node)
    cd ${project.root}
    set -o pipefail
    "$vitest" run ${files} --reporter=default 2>&1 | tee $TMPDIR/test.log
    "$node_bin" ${normalizeLog} $TMPDIR/test.log > $TMPDIR/summary
  '';

  installSummary = ''
    mkdir -p $out
    cp $TMPDIR/summary $out/summary
  '';
}
