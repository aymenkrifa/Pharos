<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/assets/pharos-logo-dark.svg">
    <img src="assets/assets/pharos-logo-light.svg" alt="Pharos" width="540">
  </picture>
  <p><em>Your Claude 5-hour and 7-day usage limits, in the GNOME top panel.</em></p>
  <p><a href="https://pharos.aymenkrifa.com"><b>pharos.aymenkrifa.com</b></a></p>
</div>

# Pharos

A colored light on the horizon, before you run onto the rocks. As usage
climbs, the beacon changes shape and color:

| Beacon | Meaning |
|:---:|---|
| <img src="assets/assets/pharos-state-ok.svg" width="22" alt="clear water"> | **Clear water** — below 50% |
| <img src="assets/assets/pharos-state-caution.svg" width="22" alt="light on the horizon"> | **Light on the horizon** — from 50% |
| <img src="assets/assets/pharos-state-warning.svg" width="22" alt="full beam"> | **Full beam** — from 75% |
| <img src="assets/assets/pharos-state-critical.svg" width="22" alt="on the rocks"> | **On the rocks** — from 90% |

## Install

Needs GNOME Shell 46–48 and
[Claude Code](https://claude.com/product/claude-code) signed in on your
machine.

Download the [latest release](https://github.com/aymenkrifa/Pharos/releases/latest)
and install it:

```sh
curl -LO https://github.com/aymenkrifa/Pharos/releases/latest/download/pharos@aymenkrifa.github.io.shell-extension.zip
gnome-extensions install pharos@aymenkrifa.github.io.shell-extension.zip
```

Reload GNOME Shell (X11: `Alt+F2`, `r`, `Enter` — Wayland: log out and back
in), then:

```sh
gnome-extensions enable pharos@aymenkrifa.github.io
```

<details>
<summary>Install from source instead</summary>

```sh
git clone https://github.com/aymenkrifa/Pharos.git
cd Pharos
./install.sh
```

Then reload and enable as above.

</details>

## Accounts

One account works out of the box — Pharos reads Claude Code's login from
`~/.claude` and keeps the token fresh on its own.

More than one account? Add each in **Settings → Accounts** with a label and
the path to its `.credentials.json`. The menu gets a switcher, and the panel
shows which account you're watching.

If Pharos ever says *"Run Claude Code to re-auth"*, log in with Claude Code
once and reopen the menu.

## Settings

- **Background refresh** — keeps the beacon current between menu opens
  (0 = refresh only when the menu is opened).
- **Thresholds** — where the beacon changes state (50 / 75 / 90 by default).
- **Panel label** — show the active account as its full name, first letter,
  or not at all.

## License

GPL-2.0-or-later — see [LICENSE](LICENSE).

---

Made by [Aymen Krifa](https://aymenkrifa.com).
