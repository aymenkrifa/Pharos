<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/assets/pharos-logo-dark.svg">
    <img src="assets/assets/pharos-logo-light.svg" alt="Pharos" width="540">
  </picture>
</div>

# Pharos (GNOME Shell extension)

Named for the Lighthouse of Alexandria: a colored light on the horizon that
warns you before you run onto the rocks. Pharos watches your Claude **5-hour**
and **7-day** usage limits from the GNOME top panel. As usage climbs, the
beacon lights up in stages — and its *shape* changes along with its color, so
the warning survives grayscale themes and color-blind eyes:

| Usage | Beacon |
|---|---|
| < 50% | clear water — tower and flame, untinted |
| ≥ 50% | light on the horizon — short rays, gold |
| ≥ 75% | full beam — long rays, ember |
| ≥ 90% | on the rocks — beam + exclamation badge, red |

The beacon always shows the worst of the two windows; the thresholds are
configurable in Settings.

## How it works

- Usage is always fetched when you **open the panel menu**, hit **Refresh now**,
  or **switch accounts**.
- It reads the OAuth token from Claude Code's credentials file
  (`~/.claude/.credentials.json` by default), then calls
  `https://api.anthropic.com/api/oauth/usage`.

## Accounts

Out of the box Pharos tracks a single account via
`~/.claude/.credentials.json` — no configuration needed.

If you use more than one Claude account (say, work and personal, each with its
own `CLAUDE_CONFIG_DIR`), add them in **Settings → Accounts**: give each a
label and the path to its `.credentials.json` (e.g.
`~/.claude-work/.credentials.json`; leave the path blank for the default
location). With two or more accounts configured, the panel menu gains an
account switcher and the panel tag shows the active account — as the full
label (`Work 5/40`), just its first letter (`W 5/40`), or hidden (`5/40`),
per the **Panel label** setting. The menu itself always shows full labels.

### Panel color freshness

The beacon is tinted from the **last successful fetch** — it is not a live
reading. If you only fetch on menu-open, then between opens the color is frozen
at "how things looked the last time you looked," which can be misleading (it may
show green while you've actually climbed into the red).

To avoid that, there's an optional **background refresh** (Settings → *Background
refresh (seconds)*, default **300s / 5 min**). While enabled, Pharos re-fetches
on that interval even when the menu is closed, so the color stays current. Set
it to **0** to disable background polling entirely and go back to
fetch-only-on-open.

## Token refresh

Claude's `accessToken` is short-lived — normally it's only renewed when Claude
Code itself makes a request. If the laptop sits locked (or Claude Code just
hasn't run for a while), the stored token expires and the API would reject it
with a 401/403.

Pharos refreshes the token itself so that never surfaces to you:

- **When?** Just-in-time, on every fetch — whether that's you opening the menu
  or a background poll. If the stored token is expired (or within 60s of
  expiry) at fetch time, it refreshes before calling the usage endpoint. (With
  background refresh enabled, this also keeps the token warm on its own.)
- **How?** It exchanges the `refreshToken` for a new `accessToken` via
  `POST https://platform.claude.com/v1/oauth/token` (the same OAuth flow Claude
  Code uses), then **writes the rotated tokens back** to the credentials file —
  preserving the other fields and `0600` permissions — so Pharos and Claude
  Code stay in sync.
- **Fallback:** if a usage request still returns 401/403, it refreshes once and
  retries.
- **When it can't help:** if the *refresh token* itself is expired or revoked,
  you'll see `Token refresh HTTP 4xx. Run Claude Code to re-auth.` — log in
  again via Claude Code and it'll work on the next open.

The net effect: open the menu after a lock and it just works, instead of
showing "Token rejected." The first open after expiry does one extra HTTP
round-trip (the refresh) before usage loads; after that the new token is good
for hours.

## Install

```sh
git clone https://github.com/aymenkrifa/Pharos.git
cd Pharos
glib-compile-schemas schemas/

EXT=~/.local/share/gnome-shell/extensions/pharos@aymenkrifa.github.io
mkdir -p "$EXT"
cp -r extension.js prefs.js lib metadata.json stylesheet.css schemas assets "$EXT/"
```

Then reload GNOME Shell:

- **X11:** `Alt+F2` → type `r` → `Enter`.
- **Wayland:** log out and back in.

And enable it (once):

```sh
gnome-extensions enable pharos@aymenkrifa.github.io
```

To update after editing files in this repo, re-run the copy step and reload the
shell again.

## Settings

Open **Settings…** from the menu (or `gnome-extensions prefs
pharos@aymenkrifa.github.io`) to configure:

- **Background refresh (seconds)** — 0 disables background polling.
- **Caution / warning / critical thresholds (%)** — where the beacon changes
  state (defaults 50 / 75 / 90).
- **Accounts** — optional list of labeled credentials files (see
  [Accounts](#accounts) above).
- **Panel label** — show the active account in the bar as the full label,
  just its first letter, or not at all.

## Code structure

```
extension.js        entry point (enable/disable)
prefs.js            preferences dialog
lib/
  accounts.js       account list + credentials path resolution (shared with prefs)
  client.js         UsageClient — usage fetch + OAuth token refresh
  format.js         reset-time formatting
  meter.js          one usage-window row (label, bar, caption)
  indicator.js      the panel button and menu
assets/             logo lockups + the four beacon state icons
```

`lib/accounts.js` and `lib/format.js` are imported by both the shell process
and the GTK prefs process, so they must stay free of Shell/St imports.

## License

GPL-2.0-or-later — see [LICENSE](LICENSE).
