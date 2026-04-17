{ pkgs, lib, ... }:
let
  runtimeLibraries = with pkgs; [
    alsa-lib
    atk
    cairo
    dbus
    expat
    fontconfig
    freetype
    gdk-pixbuf
    glib
    gtk3
    libdrm
    libxkbcommon
    nspr
    nss
    pango
    stdenv.cc.cc
    xorg.libX11
    xorg.libXcomposite
    xorg.libXcursor
    xorg.libXdamage
    xorg.libXext
    xorg.libXfixes
    xorg.libXi
    xorg.libXrandr
    xorg.libXrender
    xorg.libxcb
  ];
in {
  # https://devenv.sh/packages/
  packages =
    with pkgs;
    [
      git
      bashInteractive
      biome
    ]
    ++ runtimeLibraries;

  env = with pkgs; {
    BIOME_BINARY="${biome}/bin/biome";
    LD_LIBRARY_PATH = lib.makeLibraryPath runtimeLibraries;
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
