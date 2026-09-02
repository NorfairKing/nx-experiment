# The one thing Nix has to take on trust, checked against pnpm.
#
# nix/graph.nix derives the project graph from the workspace manifests during
# evaluation, which needs no Nx, no generated file and no
# import-from-derivation. The manifests are the graph in a pnpm workspace with
# isolated linking: an import of an undeclared workspace package does not
# resolve, so it is a hard build error rather than a missing edge. See
# results/correctness-probes.json.
#
# What Nix cannot read is pnpm-workspace.yaml, for want of a YAML parser, so
# graph.nix restates the workspace globs. Drift there is the one remaining
# silent failure: a project outside Nix's globs gets no derivations and nothing
# notices. This derivation closes that by asking pnpm, which reads that file
# itself.
#
# The other guards cover the rest: `build-*` catches an import the manifests do
# not declare, because these derivations link only declared dependencies, and
# `guard-*` in nix/per-test-file.nix catches a test file Vitest would run that
# no derivation covers.
{ lib
, stdenvNoCC
, nodejs
, pnpm
, support
}:
let
  inherit (support) table repoRoot;

  # Every manifest in the repository, not only those under Nix's globs, so pnpm
  # can find a project Nix missed.
  everyManifest = lib.fileset.unions [
    (lib.fileset.fileFilter (file: file.name == "package.json") repoRoot)
    (repoRoot + "/pnpm-workspace.yaml")
  ];
in
stdenvNoCC.mkDerivation {
  name = "nx-exp-workspace-projects";

  src = lib.fileset.toSource {
    root = repoRoot;
    fileset = everyManifest;
  };

  nativeBuildInputs = [ nodejs pnpm ];
  dontPatchELF = true;
  dontStrip = true;

  expectedRoots = lib.concatStringsSep "\n"
    (lib.mapAttrsToList (_: project: project.root) table.projects);

  graphSource = table.source;

  buildPhase = ''
    runHook preBuild

    export HOME=$TMPDIR
    # The root manifest pins a packageManager, and pnpm 11 tries to fetch that
    # exact version before doing anything. There is no network in here, and the
    # pnpm on PATH is the one we want. nixpkgs' own pnpm fetcher sets the same
    # variable for the same reason.
    export pnpm_config_pm_on_fail=ignore
    export pnpm_config_update_notifier=false
    export pnpm_config_offline=true

    echo "graph derived from: $graphSource"
    node ${../scripts/check-workspace-projects.mjs} | tee $TMPDIR/guard.log

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p $out
    cp $TMPDIR/guard.log $out/guard.log
    runHook postInstall
  '';
}
