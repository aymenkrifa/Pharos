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
echo "Now reload GNOME Shell:"
echo "  X11:     press Alt+F2, type r, press Enter"
echo "  Wayland: log out and back in"
echo
echo "Then light the beacon (once):"
echo "  gnome-extensions enable $UUID"
