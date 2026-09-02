# Machinery shared by the per-package and per-test-file prototypes: how a
# workspace skeleton is assembled around one package, and how a Vitest run is
# turned into a deterministic output.
{ lib
, workspace
}:
rec {
  repoRoot = ../.;

  table = builtins.fromJSON (builtins.readFile ./projects.json);

  # Workspace-root files reached through a relative path. They are split
  # because tsc and Vitest do not read the same ones: every package's tsconfig
  # extends tsconfig.base.json, and every package's vitest config merges
  # vitest.shared.ts, but neither tool reads the other's file. Handing both to
  # both would make an edit to the shared Vitest config rebuild every tsc
  # output for nothing.
  sharedBuildFiles = [
    (repoRoot + "/tsconfig.base.json")
  ];

  sharedTestFiles = sharedBuildFiles ++ [
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

  # A test run is not reproducible and does not need to be: the derivation
  # succeeding is the evidence that the tests passed, and nothing consumes the
  # log's content. `nix build --rebuild` therefore does not apply to these
  # derivations.
  #
  # Without pipefail the exit status would be tee's, so a failing test would
  # still produce a successful derivation.
  runVitest = project: files: ''
    vitest=$PWD/node_modules/.bin/vitest
    cd ${project.root}
    set -o pipefail
    "$vitest" run ${files} --reporter=default 2>&1 | tee $TMPDIR/test.log
  '';

  installLog = ''
    mkdir -p $out
    cp $TMPDIR/test.log $out/test.log
  '';
}
