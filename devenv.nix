{
  # https://devenv.sh/packages/
  packages = with pkgs; [
    git
    bashInteractive
    biome
  ];

  env = with pkgs; {
    BIOME_BINARY="${biome}/bin/biome";
  };

  # https://devenv.sh/languages/
  languages.javascript = {
    # disable prepending node_modules/.bin to PATH
    # it is causing trouble with biome
    enable = true;
    bun = {
      enable = true;
      install = {
        enable = true;
      };
    };
  };

  # See full reference at https://devenv.sh/reference/options/
}
