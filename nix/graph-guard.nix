# The staleness guard for the dependency edges.
#
# nix/projects.json is a checked-in cache of a semantic analysis. When it drifts
# from the workspace, the failure direction is not symmetric:
#
#   an edge in projects.json that reality lacks    over-approximates; runs too
#                                                  much; harmless
#   an edge reality has that projects.json lacks   the dependency's store path
#                                                  is not linked, so tsc or
#                                                  Vitest cannot resolve the
#                                                  import: loud
#   a project missing from projects.json entirely  no derivation is generated,
#                                                  so its tests never run and
#                                                  nothing reports a problem:
#                                                  SILENT
#
# The silent case is the one worth a guard. This derivation rebuilds the project
# table from the manifests alone — discovered by globbing the source tree, not
# read from any Nix-side list — and fails when it disagrees with the checked-in
# table.
#
# It is deliberately independent of Nx. A guard generated from the same source
# as the data it checks proves only that the generator is deterministic. This
# one would notice a project Nx never reported, or a project Nx reported and the
# bridge dropped.
#
# What it does not check is whether the manifests match what the source actually
# imports. That is what the build derivations check, since pnpm's strict layout
# and these derivations' hand-built node_modules both make an undeclared import
# a hard resolution error. Both are in `nix flake check`.
{ lib
, stdenvNoCC
, nodejs
, support
, workspace
}:
let
  inherit (support) table;

  checkGraph = ../scripts/check-graph-agreement.mjs;
in
stdenvNoCC.mkDerivation {
  name = "nx-exp-graph-agreement";

  # The reduced manifests, whose own project list comes from readDir over the
  # source tree rather than from nix/projects.json.
  src = workspace.installInputs;

  nativeBuildInputs = [ nodejs ];
  dontPatchELF = true;
  dontStrip = true;

  expected = builtins.toJSON (lib.mapAttrs
    (_: project: {
      inherit (project) name root runtimeDeps devDeps;
    })
    table.projects);

  buildPhase = ''
    runHook preBuild
    node ${checkGraph} | tee $TMPDIR/guard.log
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p $out
    cp $TMPDIR/guard.log $out/guard.log
    runHook postInstall
  '';
}
