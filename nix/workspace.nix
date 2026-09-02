# Pieces shared by every prototype: the pnpm dependency closure and the
# workspace skeleton the per-package derivations are assembled inside.
{ lib
, stdenvNoCC
, runCommand
, fetchPnpmDeps
, pnpmConfigHook
, pnpm
, nodejs
}:
let
  root = ../.;

  projectRoots =
    let
      dirsIn = parent: lib.attrNames
        (lib.filterAttrs (_: type: type == "directory") (builtins.readDir (root + "/${parent}")));
    in
    map (name: "packages/${name}") (dirsIn "packages")
    ++ map (name: "apps/${name}") (dirsIn "apps");

  # pnpm reads a manifest for its identity and its dependency specifiers; a
  # description or a script it never runs is not an input to the install.
  #
  # Reducing each manifest in the evaluator rather than in a build step is what
  # makes this precise: builtins.toFile addresses the reduced manifest by its
  # content, so an edit to an ignored field produces the same store path and
  # nothing downstream is invalidated. A build step that stripped the same
  # fields would still take the full manifests as its input, and every
  # dependent derivation would be rebuilt for an irrelevant edit.
  reduceManifest = path:
    let
      raw = builtins.fromJSON (builtins.readFile path);
      kept = lib.filterAttrs (_: value: value != null) {
        inherit (raw) name version;
        private = raw.private or null;
        packageManager = raw.packageManager or null;
        dependencies = raw.dependencies or null;
        devDependencies = raw.devDependencies or null;
        peerDependencies = raw.peerDependencies or null;
        optionalDependencies = raw.optionalDependencies or null;
      };
    in
    builtins.toFile "package.json" (builtins.toJSON kept);

  # Only the dependency-relevant part of every manifest, plus the two files
  # that pin resolution.
  installInputs = runCommand "nx-experiment-install-inputs" { } ''
    mkdir -p $out
    cp ${root + "/pnpm-workspace.yaml"} $out/pnpm-workspace.yaml
    cp ${root + "/pnpm-lock.yaml"} $out/pnpm-lock.yaml
    cp ${reduceManifest (root + "/package.json")} $out/package.json
    ${lib.concatMapStringsSep "\n"
      (projectRoot: ''
        mkdir -p $out/${projectRoot}
        cp ${reduceManifest (root + "/${projectRoot}/package.json")} $out/${projectRoot}/package.json
      '')
      projectRoots}
  '';

  pnpmDeps = fetchPnpmDeps {
    pname = "nx-experiment";
    src = installInputs;
    inherit pnpm;
    fetcherVersion = 4;
    hash = "sha256-qSamwIQUr1rYUXQAj9G6XfCYCo3J11mbi4kRjw3SMBc=";
  };

  # pnpm's node_modules links back into the workspace package directories, so
  # the installed tree is only self-consistent alongside the manifest skeleton
  # it was installed from; both are kept in one output.
  nodeModules = stdenvNoCC.mkDerivation {
    name = "nx-experiment-node-modules";
    src = installInputs;
    inherit pnpmDeps;
    nativeBuildInputs = [ pnpm pnpmConfigHook nodejs ];
    dontBuild = true;
    dontPatchELF = true;
    dontStrip = true;
    installPhase = ''
      runHook preInstall
      mkdir -p $out
      cp -r . $out/
      runHook postInstall
    '';
  };

in
{
  inherit installInputs pnpmDeps nodeModules;
}
