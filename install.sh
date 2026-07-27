#!/bin/sh
# Install Pharos from this checkout into the current user's extensions.
set -e

UUID="pharos@aymenkrifa.github.io"
EXT="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"

glib-compile-schemas schemas/
mkdir -p "$EXT"
cp -r extension.js prefs.js lib metadata.json stylesheet.css schemas assets "$EXT/"

echo "Pharos installed to $EXT"
echo
# The shell only scans for extensions at startup, so the reload has to happen
# before the enable — otherwise the enable is a silent no-op. Print just the
# instruction that applies, rather than making the reader work out which
# session they are in: on Ubuntu, GDMSESSION reads "ubuntu" either way.
echo "Now reload GNOME Shell:"
case "$XDG_SESSION_TYPE" in
  wayland)
    echo "  log out and back in"
    echo "  (Wayland has no in-place restart — the shell is the display server)"
    ;;
  x11)
    echo "  press Alt+F2, type r, press Enter"
    ;;
  *)
    echo "  log out and back in"
    echo "  (on X11 you can instead press Alt+F2, type r, press Enter)"
    ;;
esac
echo
echo "Then light the beacon (once):"
echo "  gnome-extensions enable $UUID"
