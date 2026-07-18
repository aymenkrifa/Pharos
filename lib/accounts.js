// Account model shared by the extension and the preferences dialog.
//
// This module is imported by BOTH the shell process (indicator) and the GTK
// prefs process — it must only depend on GLib, never on Shell or St/Clutter.

import GLib from 'gi://GLib';

// Expand a leading "~" so paths typed into the preferences dialog
// (e.g. ~/.claude-work/.credentials.json) resolve correctly.
export function expandPath(path) {
    if (path === '~')
        return GLib.get_home_dir();
    if (path.startsWith('~/'))
        return GLib.build_filenamev([GLib.get_home_dir(), path.slice(2)]);
    return path;
}

// Parse the JSON-encoded {label, path} account entries from settings, skipping
// malformed ones. Returns the raw (possibly empty) list — the prefs dialog
// works with this directly.
export function readAccounts(settings) {
    const accounts = [];
    for (const entry of settings.get_strv('accounts')) {
        try {
            const a = JSON.parse(entry);
            if (a && typeof a.label === 'string') {
                accounts.push({
                    label: a.label,
                    path: typeof a.path === 'string' ? a.path : '',
                });
            }
        } catch (_e) {
            // Skip malformed entries rather than breaking the indicator.
        }
    }
    return accounts;
}

export function writeAccounts(settings, accounts) {
    settings.set_strv('accounts', accounts.map(a => JSON.stringify(a)));
}

// Like readAccounts(), but an empty list yields a single anonymous account so
// the extension works out of the box against plain ~/.claude with no switcher.
export function loadAccounts(settings) {
    const accounts = readAccounts(settings);
    if (accounts.length === 0)
        accounts.push({ label: '', path: '' });
    return accounts;
}

// Credentials file for an account: its explicit path if set, otherwise Claude
// Code's default location.
export function resolveCredentialsPath(account) {
    const explicit = (account?.path ?? '').trim();
    if (explicit)
        return expandPath(explicit);
    return GLib.build_filenamev([GLib.get_home_dir(), '.claude', '.credentials.json']);
}
