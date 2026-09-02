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
      pkgs = import nixpkgs {
        inherit system;
        overlays = [ (import ./nix/overlay.nix) ];
      };
    in
    {
      overlays.${system} = import ./nix/overlay.nix;

      packages.${system} =
        let
          inherit (pkgs) nxExperiment;
          prefixed = prefix: set:
            nixpkgs.lib.mapAttrs' (name: nixpkgs.lib.nameValuePair "${prefix}-${name}") set;
        in
        {
          inherit (nxExperiment) manifests pnpmDeps nodeModules allTests;
        }
        // prefixed "build" nxExperiment.builds
        // prefixed "test" nxExperiment.tests;

      checks.${system} = {
        pre-commit = pre-commit-hooks.lib.${system}.run {
          src = ./.;
          hooks = {
            nixpkgs-fmt.enable = true;
            statix.enable = true;
            deadnix.enable = true;
          };
        };
      };

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
