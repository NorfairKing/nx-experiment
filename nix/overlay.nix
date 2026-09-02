final: _prev: {
  nxExperiment =
    let
      workspace = final.callPackage ./workspace.nix { };
      perPackage = final.callPackage ./per-package.nix { inherit workspace; };
      perTestFile = final.callPackage ./per-test-file.nix { inherit workspace; } {
        inherit (perPackage) builds;
      };
    in
    {
      inherit (workspace) installInputs wholeManifests pnpmDeps nodeModules;
      inherit (perPackage) builds tests allTests;
      inherit (perTestFile) perFile perFileNarrow guards;
    };
}
