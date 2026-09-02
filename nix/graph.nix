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

  # Vitest's own include pattern is `tests/**/*.test.ts`, so this walks the
  # tree rather than listing one directory. It is an approximation of what
  # Vitest would discover, which is why nix/per-test-file.nix carries a guard
  # that asks Vitest directly and fails when the two disagree. The per-package
  # granularity does not need this list at all: `vitest run` discovers its own
  # files, and Vitest is the authority on that.
  testFilesUnder = root:
    let
      walk = prefix:
        let
          dir = repoRoot + "/${root}/${prefix}";
          entries = if builtins.pathExists dir then builtins.readDir dir else { };
          fileNames = lib.attrNames
            (lib.filterAttrs (name: type: type == "regular" && lib.hasSuffix ".test.ts" name) entries);
          dirNames = lib.attrNames (lib.filterAttrs (_: type: type == "directory") entries);
        in
        map (name: "${prefix}/${name}") fileNames
        ++ lib.concatMap (name: walk "${prefix}/${name}") dirNames;
    in
    lib.sort (a: b: a < b) (walk "tests");

  projects = lib.listToAttrs (lib.mapAttrsToList
    (root: manifest: {
      name = attrOf manifest.name;
      value = {
        inherit (manifest) name;
        inherit root;
        runtimeDeps = workspaceDeps (manifest.dependencies or { });
        devDeps = workspaceDeps (manifest.devDependencies or { });
        testFiles = testFilesUnder root;
      };
    })
    manifests);
  # An optional override. Deriving the graph from the manifests is the default
  # because it costs nothing and needs neither Nx nor a generated file. But if
  # the manifests ever stop being the graph — a hoisted node_modules where
  # phantom imports resolve, or a workspace whose edges come from tsconfig path
  # aliases — then something has to run Nx, and its answer has to reach the
  # evaluator. Dropping a generated table at nix/projects.json switches to it,
  # with no other change. `scripts/nx-to-nix.mjs` produces one.
  #
  # The third option is import-from-derivation: run Nx inside a derivation and
  # import the result, which keeps the answer always fresh at the cost of a
  # build during evaluation. See FINDINGS.md for when that trade is worth
  # making; this repo does not need it, so it does not pay for it.
  overridePath = ./projects.json;
  override = (builtins.fromJSON (builtins.readFile overridePath)).projects;

  usingOverride = builtins.pathExists overridePath;
in
{
  inherit projectRoots workspaceGlobs usingOverride;

  projects = if usingOverride then override else projects;

  # What the graph was derived from, so a guard can report it.
  source = if usingOverride then "nix/projects.json" else "workspace manifests";
}
