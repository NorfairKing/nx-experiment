# The project graph, derived at evaluation time from the workspace manifests.
#
# This replaces a generated, checked-in table. Nothing here runs Nx, and
# nothing imports from a derivation, so evaluation stays pure and fast: it is
# `readDir` over the workspace globs and `fromJSON` over each manifest.
#
# Why this is enough, rather than needing Nx's import analysis: pnpm's isolated
# node_modules only links a package's *declared* dependencies, so an import of
# an undeclared workspace package does not resolve. It is a hard error at build
# time, and Nx reports no edge for it either — verified in
# results/correctness-probes.json, where an undeclared import and a
# cross-package tsconfig path alias both yield an empty Nx edge list. In a
# pnpm-strict workspace the manifests are the graph.
#
# This does NOT hold for a hoisted node_modules layout (npm, yarn classic),
# where an undeclared import resolves through hoisting. There the manifests
# under-report and Nx's analysis earns its place.
{ lib }:
let
  repoRoot = ../.;

  # The one thing Nix cannot read: pnpm-workspace.yaml, because Nix has no YAML
  # parser. The globs are restated here instead. They are two lines that change
  # about never, and the graph-agreement check in nix/graph-guard.nix compares
  # this list against what pnpm itself installed.
  workspaceGlobs = [ "packages" "apps" ];

  projectRootsUnder = parent:
    let entries = builtins.readDir (repoRoot + "/${parent}");
    in map (name: "${parent}/${name}")
      (lib.attrNames (lib.filterAttrs (_: type: type == "directory") entries));

  projectRoots = lib.concatMap projectRootsUnder workspaceGlobs;

  manifestAt = root: builtins.fromJSON (builtins.readFile (repoRoot + "/${root}/package.json"));

  manifests = lib.listToAttrs (map
    (root: { name = root; value = manifestAt root; })
    projectRoots);

  workspaceNames = lib.mapAttrsToList (_: manifest: manifest.name) manifests;

  attrOf = name: lib.last (lib.splitString "/" name);

  workspaceDeps = record:
    lib.sort (a: b: a < b)
      (map attrOf
        (lib.filter (dep: lib.elem dep workspaceNames) (lib.attrNames record)));

  projects = lib.listToAttrs (lib.mapAttrsToList
    (root: manifest: {
      name = attrOf manifest.name;
      value = {
        inherit (manifest) name;
        inherit root;
        runtimeDeps = workspaceDeps (manifest.dependencies or { });
        devDeps = workspaceDeps (manifest.devDependencies or { });
      };
    })
    manifests);
in
{
  inherit projects projectRoots workspaceGlobs;
}
