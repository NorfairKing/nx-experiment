{
  description = "Nix + Nx + pnpm/Vitest granular testing experiment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs?ref=nixos-unstable";
    pre-commit-hooks = {
      url = "github:cachix/pre-commit-hooks.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    { self
    , nixpkgs
    , pre-commit-hooks
    }:
    let
      system = "x86_64-linux";
      inherit (nixpkgs) lib;
      pkgs = import nixpkgs {
        inherit system;
        overlays = [ (import ./nix/overlay.nix) ];
      };
      inherit (pkgs) nxExperiment;

      prefixed = prefix: lib.mapAttrs' (name: lib.nameValuePair "${prefix}-${name}");
    in
    {
      overlays.${system} = import ./nix/overlay.nix;

      packages.${system} =
        {
          inherit (nxExperiment)
            installInputs wholeManifests pnpmDeps nodeModules allTests;
        }
        # Prototype 1 and 2: one derivation per package.
        // prefixed "build" nxExperiment.builds
        // prefixed "test" nxExperiment.tests
        # Prototype 3: one derivation per test file, at two input granularities.
        // prefixed "file" nxExperiment.perFile
        // prefixed "narrow" nxExperiment.perFileNarrow
        // prefixed "guard" nxExperiment.guards;

      checks.${system} = {
        pre-commit = pre-commit-hooks.lib.${system}.run {
          src = ./.;
          hooks = {
            nixpkgs-fmt.enable = true;
            statix.enable = true;
            deadnix.enable = true;
          };
        };
      }
      # Every package's tests, and the check that the per-test-file
      # enumeration still matches what Vitest itself discovers.
      // prefixed "test" nxExperiment.tests
      // prefixed "guard" nxExperiment.guards;

      devShells.${system}.default = pkgs.mkShell {
        name = "nx-experiment-shell";
        packages = [
          pkgs.nodejs
          pkgs.pnpm
          pkgs.jq
        ];
        shellHook = self.checks.${system}.pre-commit.shellHook;
      };
    };
}
