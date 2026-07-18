// Network layer: fetches usage from Anthropic's OAuth usage endpoint and keeps
// the stored Claude Code tokens fresh. No UI imports — errors are surfaced as
// UsageError and rendered by the indicator.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup';

import { resolveCredentialsPath } from './accounts.js';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async', 'send_and_read_finish');

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const OAUTH_BETA = 'oauth-2025-04-20';

// OAuth token endpoint + public Claude Code client id, used to swap an expired
// refresh token for a fresh access token (same flow Claude Code itself uses).
const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

// Refresh the access token when it expires within this window, so a request
// never goes out with a token about to lapse mid-flight.
const EXPIRY_MARGIN_MS = 60_000;

function isCancelled(e) {
    return e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED) ?? false;
}

// Read the credentials file, returning the full parsed JSON plus a handle to
// the claudeAiOauth block (accessToken / refreshToken / expiresAt) and the path
// so it can be written back after a token refresh.
function readCredentials(path) {
    const file = Gio.File.new_for_path(path);
    const [ok, contents] = file.load_contents(null);
    if (!ok)
        throw new Error(`cannot read ${path}`);
    const json = JSON.parse(new TextDecoder().decode(contents));
    const oauth = json?.claudeAiOauth;
    if (!oauth?.accessToken)
        throw new Error('no claudeAiOauth.accessToken in credentials');
    return { json, oauth, path };
}

// Persist refreshed tokens back to the credentials file, preserving all other
// fields and 0600 permissions so we stay in sync with Claude Code.
function writeCredentials(path, json) {
    const file = Gio.File.new_for_path(path);
    const data = new TextEncoder().encode(JSON.stringify(json, null, 2));
    file.replace_contents(data, null, false, Gio.FileCreateFlags.PRIVATE, null);
}

// A failed fetch, with `message` already phrased for direct display in the
// menu. `kind` lets the caller special-case some failures (rate-limit gets a
// retry instead of an error state).
export class UsageError extends Error {
    constructor(kind, message) {
        super(message);
        this.kind = kind;
    }
}

export class UsageClient {
    constructor() {
        this._session = new Soup.Session();
        this._session.timeout = 15;
    }

    // Fetch the usage report for one account. Handles token freshness in both
    // directions: refreshes just-in-time when the stored token is (nearly)
    // expired, and reactively — once — when the server rejects it anyway.
    // Throws UsageError, or the raw Gio CANCELLED error when aborted.
    async fetchUsage(account, cancellable) {
        let creds;
        try {
            creds = readCredentials(resolveCredentialsPath(account));
        } catch (e) {
            throw new UsageError('credentials', `Credentials error: ${e.message}`);
        }

        const expiresAt = creds.oauth.expiresAt ?? 0;
        if (creds.oauth.refreshToken && expiresAt &&
            expiresAt <= Date.now() + EXPIRY_MARGIN_MS) {
            const token = await this._refreshToken(creds, cancellable);
            return this._requestUsage(token, cancellable);
        }

        try {
            return await this._requestUsage(creds.oauth.accessToken, cancellable);
        } catch (e) {
            if (e instanceof UsageError && e.kind === 'auth' && creds.oauth.refreshToken) {
                const token = await this._refreshToken(creds, cancellable);
                return this._requestUsage(token, cancellable);
            }
            throw e;
        }
    }

    // One GET against the usage endpoint with the given bearer token.
    async _requestUsage(token, cancellable) {
        const msg = Soup.Message.new('GET', USAGE_URL);
        msg.request_headers.append('Authorization', `Bearer ${token}`);
        msg.request_headers.append('anthropic-beta', OAUTH_BETA);

        let bytes;
        try {
            bytes = await this._session.send_and_read_async(
                msg, GLib.PRIORITY_DEFAULT, cancellable);
        } catch (e) {
            if (isCancelled(e))
                throw e;
            throw new UsageError('network', `Network error: ${e.message}`);
        }

        // Read the status via the plain-uint property: get_status() returns the
        // Soup.Status ENUM, and GJS throws on codes it doesn't define (429!).
        const status = msg.status_code;
        if (status === 401 || status === 403)
            throw new UsageError('auth', 'Token rejected (401/403). Run Claude Code to refresh.');
        if (status === 429)
            throw new UsageError('rate-limit', 'Rate limited');
        if (status !== 200)
            throw new UsageError('http', `HTTP ${status}`);

        try {
            return JSON.parse(new TextDecoder().decode(bytes.get_data()));
        } catch (e) {
            throw new UsageError('parse', `Parse error: ${e.message}`);
        }
    }

    // Exchange the refresh token for a new access token and write the rotated
    // tokens back to the credentials file.
    async _refreshToken(creds, cancellable) {
        const body = JSON.stringify({
            grant_type: 'refresh_token',
            refresh_token: creds.oauth.refreshToken,
            client_id: OAUTH_CLIENT_ID,
        });
        const msg = Soup.Message.new('POST', TOKEN_URL);
        msg.set_request_body_from_bytes(
            'application/json',
            new GLib.Bytes(new TextEncoder().encode(body)));

        let bytes;
        try {
            bytes = await this._session.send_and_read_async(
                msg, GLib.PRIORITY_DEFAULT, cancellable);
        } catch (e) {
            if (isCancelled(e))
                throw e;
            throw new UsageError('token-refresh', `Token refresh failed: ${e.message}`);
        }

        if (msg.status_code !== 200) {
            throw new UsageError('token-refresh',
                `Token refresh HTTP ${msg.status_code}. Run Claude Code to re-auth.`);
        }

        let data;
        try {
            data = JSON.parse(new TextDecoder().decode(bytes.get_data()));
        } catch (e) {
            throw new UsageError('token-refresh', `Token refresh parse error: ${e.message}`);
        }
        if (!data?.access_token)
            throw new UsageError('token-refresh', 'Token refresh: no access_token in response.');

        // Persist the rotated tokens so we and Claude Code stay in sync. A
        // writeback failure isn't fatal — the fresh token still works for this
        // fetch — so just log it.
        try {
            const oauth = creds.json.claudeAiOauth;
            oauth.accessToken = data.access_token;
            if (data.refresh_token)
                oauth.refreshToken = data.refresh_token;
            if (data.expires_in)
                oauth.expiresAt = Date.now() + data.expires_in * 1000;
            writeCredentials(creds.path, creds.json);
        } catch (e) {
            logError(e, 'pharos: credentials writeback');
        }

        return data.access_token;
    }

    destroy() {
        this._session?.abort();
        this._session = null;
    }
}
