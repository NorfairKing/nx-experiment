final: _prev: {
  nxExperiment =
    let
      workspace = final.callPackage ./workspace.nix { };
      support = final.callPackage ./support.nix { inherit workspace; };
      perPackage = final.callPackage ./per-package.nix { inherit support; };
      perTestFile = final.callPackage ./per-test-file.nix { inherit support; }
        perPackage.builds;
    in
    {
      inherit (workspace) installInputs pnpmDeps nodeModules;
      inherit (perPackage) builds tests allTests;
      inherit (perTestFile) perFile perFileNarrow guards;
    };
}
