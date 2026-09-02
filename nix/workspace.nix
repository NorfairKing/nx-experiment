# Pieces shared by every prototype: the pnpm dependency closure and the
# workspace skeleton the per-package derivations are assembled inside.
{ lib
, stdenvNoCC
, fetchPnpmDeps
, pnpmConfigHook
, pnpm
, nodejs
}:
let
  root = ../.;

  # The dependency closure must depend on manifests and the lockfile only.
  # Including sources here would make every source edit refetch and reinstall
  # every dependency, which is the coarseness failure this experiment is about.
  manifests = lib.fileset.toSource {
    inherit root;
    fileset = lib.fileset.unions [
      (root + "/package.json")
      (root + "/pnpm-workspace.yaml")
      (root + "/pnpm-lock.yaml")
      (lib.fileset.fileFilter (file: file.name == "package.json") (root + "/packages"))
      (lib.fileset.fileFilter (file: file.name == "package.json") (root + "/apps"))
    ];
  };

  pnpmDeps = fetchPnpmDeps {
    pname = "nx-experiment";
    src = manifests;
    inherit pnpm;
    fetcherVersion = 4;
    hash = "sha256-qSamwIQUr1rYUXQAj9G6XfCYCo3J11mbi4kRjw3SMBc=";
  };

  # pnpm's node_modules links back into the workspace package directories, so
  # the installed tree is only self-consistent alongside the manifest skeleton
  # it was installed from; both are kept in one output.
  nodeModules = stdenvNoCC.mkDerivation {
    name = "nx-experiment-node-modules";
    src = manifests;
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
  inherit manifests pnpmDeps nodeModules;
}
