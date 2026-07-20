# Releasing

Pharos is a GNOME Shell extension. A release is **automated**: pushing a
`v*` tag triggers `.github/workflows/release.yml`, which builds the
`pharos@aymenkrifa.github.io.shell-extension.zip` and publishes a GitHub
Release with auto-generated notes.

## Versioning

- Tags use the **`v` prefix**: `v0.3`, `v0.4`, `v0.5`, …
- GNOME requires an **integer** `version` in `metadata.json`. Keep them in
  lockstep: tag `v0.N` ↔ `metadata.json` `"version": N`.
- Stay pre-1.0 (`v0.x`) until the behavior is frozen for a 1.0 promise.

## Before tagging — bump the version

Update these in the release commit:

1. **`metadata.json`** — `"version": N` (the integer GNOME uses for update
   ordering; must increase every release).
2. **`docs/index.html`** — the header badge default:
   `<a id="ver-badge" ...>v0.N</a>` (it self-corrects from the GitHub API at
   runtime, but this is what search engines and no-JS visitors see).

## Cut the release

```sh
# after the version bump is committed and pushed to main
git tag v0.N
git push origin v0.N
```

That's it — the workflow builds the zip and creates the release marked Latest.
Keep releases non-prerelease so `releases/latest/download/...` (the README's
install link) keeps resolving.

## Verify

```sh
gh run list --workflow=release.yml --limit 1   # build succeeded
gh release list                                # v0.N is Latest
curl -o /dev/null -sw "%{http_code}\n" -L \
  https://github.com/aymenkrifa/Pharos/releases/latest/download/pharos@aymenkrifa.github.io.shell-extension.zip
```

## Notes

- The site publishes from `main` `/docs` via GitHub Pages; pushing to `main`
  redeploys it.
- To also list Pharos on extensions.gnome.org, upload the built `.zip` from the
  release at https://extensions.gnome.org/upload/ (manual, human-reviewed).
