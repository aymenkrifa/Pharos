// The Pharos panel button: beacon icon + usage tag, and the dropdown menu with
// per-window meters, account switcher, and refresh/settings actions.

import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { loadAccounts } from './accounts.js';
import { UsageClient, UsageError } from './client.js';
import { formatReset, formatRelative } from './format.js';
import { parseLimits, resolveSelection } from './limits.js';
import { UsageMeter } from './meter.js';

// Beacon states: the icon SHAPE changes per state so the warning survives
// grayscale themes; the tint is layered on top. `color: null` means untinted
// — inherit the panel color. Thresholds between states come from settings;
// icons and tints are fixed brand values.
const STATE_OK = { icon: 'pharos-symbolic', color: null };
const STATE_CAUTION = { icon: 'pharos-caution-symbolic', color: '#E8B54A' };
const STATE_WARNING = { icon: 'pharos-warning-symbolic', color: '#E07B39' };
const STATE_CRITICAL = { icon: 'pharos-critical-symbolic', color: '#D64541' };
const ALL_STATES = [STATE_OK, STATE_CAUTION, STATE_WARNING, STATE_CRITICAL];

// Menu bar fill for the untinted OK state — neutral, visible on any theme.
const NEUTRAL_BAR = 'rgba(190, 190, 190, 0.8)';

// The panel tag is rendered as Pango markup so each metric can carry its own
// state color; everything interpolated into it must go through this.
function escapeMarkup(text) {
    return GLib.markup_escape_text(text, -1);
}

export const PharosIndicator = GObject.registerClass(
    class PharosIndicator extends PanelMenu.Button {
        _init(settings, uuid, path) {
            super._init(0.0, 'Pharos');

            this._settings = settings;
            this._uuid = uuid;
            this._client = new UsageClient();
            this._cancellable = null;
            this._timerId = 0;
            this._retryId = 0;
            this._retryCount = 0;
            this._shownAccount = null; // index whose data is on screen, or null
            this._lastUpdate = null;
            this._lastOk = false;
            this._lastLimits = null; // parsed limits from the last good fetch
            this._ageTickId = 0;
            this._accountsReloadId = 0;

            this._accounts = loadAccounts(this._settings);
            this._activeIndex = this._clampIndex(
                this._settings.get_int('active-account-index'));

            // Panel tag MARKUP minus the freshness suffix (account prefix +
            // per-metric colored numbers); the age suffix "(1m)" is appended
            // on top by _renderPanel() once the data is a minute old — fresh
            // data gets no suffix.
            this._tagBase = escapeMarkup(this._labelPrefix());

            // Panel: icon plus the tag.
            const box = new St.BoxLayout({ style_class: 'panel-status-indicators-box' });
            // Load the per-state beacon icons, with a stock fallback so the
            // indicator still renders if the assets are missing.
            this._gicons = {};
            for (const { icon } of ALL_STATES) {
                const p = GLib.build_filenamev([path, 'assets', 'icons', `${icon}.svg`]);
                if (GLib.file_test(p, GLib.FileTest.EXISTS))
                    this._gicons[icon] = Gio.icon_new_for_string(p);
            }
            this._icon = new St.Icon({ style_class: 'system-status-icon' });
            if (this._gicons[STATE_OK.icon])
                this._icon.gicon = this._gicons[STATE_OK.icon];
            else
                this._icon.icon_name = 'utilities-system-monitor-symbolic';
            this._tag = new St.Label({
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'pharos-tag',
            });
            this._setTagMarkup(this._tagBase);
            box.add_child(this._icon);
            box.add_child(this._tag);
            this.add_child(box);

            // Brand header: the Pharos lockup at the top of the menu (the
            // dark-background variant — shell menus are dark chrome). Sizing
            // comes from the stylesheet; purely visual, skipped if missing.
            const logoPath = GLib.build_filenamev(
                [path, 'assets', 'assets', 'pharos-logo-dark.svg']);
            if (GLib.file_test(logoPath, GLib.FileTest.EXISTS)) {
                const logoItem = new PopupMenu.PopupBaseMenuItem({ reactive: false });
                logoItem.add_child(new St.Bin({
                    style_class: 'pharos-menu-logo',
                    x_expand: true,
                    x_align: Clutter.ActorAlign.CENTER,
                }));
                this.menu.addMenuItem(logoItem);
                this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            }

            // Account switcher rows (radio dot marks the active account). The
            // section stays empty — no rows, no separator — unless two or more
            // accounts are configured.
            this._accountSection = new PopupMenu.PopupMenuSection();
            this.menu.addMenuItem(this._accountSection);
            this._accountItems = [];
            this._rebuildAccountMenu();

            // Menu rows: one meter per limit the account reports, then
            // status + actions. Rows are created dynamically from the API's
            // limits; until the first fetch they're seeded from the cached
            // known-limits list so the menu doesn't open empty.
            this._metersSection = new PopupMenu.PopupMenuSection();
            this._meters = new Map(); // limit key -> UsageMeter
            this._meterKeys = null;

            this._extraItem = new PopupMenu.PopupMenuItem('', { reactive: false });
            this._extraItem.visible = false;
            this._updatedItem = new PopupMenu.PopupMenuItem('Never updated', { reactive: false });
            this._updatedItem.label.add_style_class_name('pharos-updated');

            this.menu.addMenuItem(this._metersSection);
            this._syncMeterRows(this._cachedLimitInfos());
            this.menu.addMenuItem(this._extraItem);
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            this.menu.addMenuItem(this._updatedItem);

            const refresh = new PopupMenu.PopupMenuItem('Refresh now');
            refresh.connect('activate', () => this._refresh());
            this.menu.addMenuItem(refresh);

            const prefs = new PopupMenu.PopupMenuItem('Settings…');
            prefs.connect('activate', () => this._openPrefs());
            this.menu.addMenuItem(prefs);

            // Fetch each time the menu is opened.
            this._openId = this.menu.connect('open-state-changed', (_menu, isOpen) => {
                if (isOpen)
                    this._refresh();
            });

            // Keep the panel-bar staleness suffix ((1m) / (2m)…) ticking
            // even while the menu is closed.
            this._startAgeTick();

            // React to account edits from the prefs dialog. Writes can arrive in
            // quick bursts (label + path applied back-to-back), so coalesce them
            // before reloading and refetching.
            this._accountsChangedId = this._settings.connect('changed::accounts', () => {
                if (this._accountsReloadId)
                    GLib.source_remove(this._accountsReloadId);
                this._accountsReloadId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
                    this._accountsReloadId = 0;
                    this._reloadAccounts();
                    return GLib.SOURCE_REMOVE;
                });
            });

            // Re-render the panel tag and beacon in place when any display
            // setting changes — no refetch needed, the parsed limits are
            // kept around. The thresholds belong here too: they only decide
            // which state a percentage maps to, so moving one has to recolor
            // immediately rather than wait for the next poll.
            this._displayChangedIds = [
                'panel-label-style', 'panel-metrics',
                'beacon-metrics', 'metric-label-style',
                'caution-threshold', 'warn-threshold', 'crit-threshold',
            ].map(key => this._settings.connect(`changed::${key}`, () => {
                this._recolorMeters();
                this._applyBeacon();
                this._rebuildTagBase();
                this._setTagMarkup(this._tagBase);
                this._renderPanel();
            }));

            // Optional background polling so the panel color doesn't go stale
            // between menu opens. Restart it whenever the interval setting changes.
            this._settingsChangedId = this._settings.connect(
                'changed::refresh-seconds', () => this._startPolling());
            this._startPolling();
        }

        _clampIndex(index) {
            return Math.max(0, Math.min(this._accounts.length - 1, index));
        }

        // Panel-tag prefix for the active account: its label in multi-account
        // mode — full, first letter, or hidden per the panel-label-style
        // setting — and nothing when only one account is configured. The menu
        // switcher always shows full labels.
        _labelPrefix() {
            if (this._accounts.length < 2)
                return '';
            const style = this._settings.get_string('panel-label-style');
            if (style === 'none')
                return '';
            const label = this._accounts[this._activeIndex]?.label;
            if (style === 'short')
                return label ? [...label][0].toUpperCase() : `${this._activeIndex + 1}`;
            return label || `Account ${this._activeIndex + 1}`;
        }

        // Write markup to the panel tag. Everything that touches the tag
        // goes through here so plain-text and markup writes never mix.
        _setTagMarkup(markup) {
            this._tag.clutter_text.set_markup(markup);
        }

        // Recompute the panel tag markup from the label prefix and the last
        // parsed limits, when they're still valid for the active account.
        // Only the panel-metrics selection contributes numbers; the style
        // setting picks between "10/50", "s10 w50", and
        // "Session 10%  Weekly 50%". Each metric is tinted with its own
        // state color (untinted below the caution threshold) — the beacon
        // icon alone carries the worst-of-selection color.
        _rebuildTagBase() {
            const prefix = escapeMarkup(this._labelPrefix());
            let nums = '';
            if (this._lastOk && this._lastLimits) {
                const shown = resolveSelection(
                    this._settings.get_strv('panel-metrics'), this._lastLimits);
                const limits = this._lastLimits.filter(l => shown.includes(l.key));
                const style = this._settings.get_string('metric-label-style');
                const seg = (limit, text) => {
                    const color = this._stateFor(limit.pct).color;
                    const escaped = escapeMarkup(text);
                    return color
                        ? `<span foreground="${color}">${escaped}</span>`
                        : escaped;
                };
                if (style === 'letters')
                    nums = limits.map(l => seg(l, `${l.letter}${l.pct}`)).join(' ');
                else if (style === 'full')
                    nums = limits.map(l => seg(l, `${l.short} ${l.pct}%`)).join('  ');
                else
                    nums = limits.map(l => seg(l, `${l.pct}`)).join('/');
            }
            // Double space: breathing room between account label and numbers.
            this._tagBase = [prefix, nums].filter(Boolean).join('  ');
        }

        // The limit keys allowed to tint the beacon: an explicit selection,
        // or — with the default '*' — whatever the panel tag shows, so the
        // color is always explained by a visible number.
        _beaconKeys() {
            const sel = this._settings.get_strv('beacon-metrics');
            if (sel.includes('*')) {
                return resolveSelection(
                    this._settings.get_strv('panel-metrics'), this._lastLimits);
            }
            return resolveSelection(sel, this._lastLimits);
        }

        // Re-point the beacon at the worst limit among the selected ones.
        // An empty selection leaves the beacon in the untinted OK state.
        _applyBeacon() {
            if (!this._lastOk || !this._lastLimits)
                return;
            const keys = this._beaconKeys();
            const pcts = this._lastLimits
                .filter(l => keys.includes(l.key)).map(l => l.pct);
            this._setBeacon(pcts.length
                ? this._stateFor(Math.max(...pcts))
                : STATE_OK);
        }

        // The known-limits settings cache: every limit key this install has
        // ever seen (across accounts), so the prefs dialog can offer
        // per-limit toggles without fetching.
        _cachedLimitInfos() {
            const infos = [];
            for (const entry of this._settings.get_strv('known-limits')) {
                try {
                    const info = JSON.parse(entry);
                    if (info?.key && info?.name)
                        infos.push(info);
                } catch (_e) {
                    // Skip malformed cache entries.
                }
            }
            return infos;
        }

        _cacheLimits(limits) {
            const byKey = new Map(this._cachedLimitInfos().map(i => [i.key, i]));
            let changed = false;
            for (const { key, name, letter } of limits) {
                const cur = byKey.get(key);
                if (!cur || cur.name !== name || cur.letter !== letter) {
                    byKey.set(key, { key, name, letter });
                    changed = true;
                }
            }
            if (changed) {
                this._settings.set_strv('known-limits',
                    [...byKey.values()].map(i => JSON.stringify(i)));
            }
        }

        // Make the meter rows match the given limit list (one row per key,
        // in order), rebuilding only when the key set actually changed.
        _syncMeterRows(infos) {
            const keys = infos.map(i => i.key).join('\n');
            if (keys === this._meterKeys) {
                infos.forEach(i => this._meters.get(i.key).setTitle(i.name));
                return;
            }
            this._meterKeys = keys;
            this._metersSection.removeAll();
            this._meters.clear();
            for (const info of infos) {
                const meter = new UsageMeter(info.name);
                this._meters.set(info.key, meter);
                this._metersSection.addMenuItem(meter.item);
            }
        }

        // (Re)populate the switcher rows. With fewer than two accounts the
        // section is left empty so the menu starts directly at the meters.
        _rebuildAccountMenu() {
            this._accountSection.removeAll();
            this._accountItems = [];
            if (this._accounts.length < 2)
                return;
            this._accounts.forEach((account, i) => {
                const item = new PopupMenu.PopupMenuItem(account.label || `Account ${i + 1}`);
                // Switch account in place and keep the menu open so you can watch
                // the bars update and flip back. Overriding activate() bypasses the
                // default "activate closes the menu" behavior.
                item.activate = () => this._setAccount(i);
                this._accountItems.push(item);
                this._accountSection.addMenuItem(item);
            });
            this._accountSection.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            this._syncAccountOrnaments();
        }

        // Accounts were edited in prefs: reload the list, re-clamp the active
        // index, rebuild the switcher rows, and refetch. Whatever is on screen
        // may belong to a removed or re-ordered account, so mark it stale.
        _reloadAccounts() {
            this._accounts = loadAccounts(this._settings);
            this._activeIndex = this._clampIndex(
                this._settings.get_int('active-account-index'));
            this._shownAccount = null;
            this._lastLimits = null;
            this._rebuildAccountMenu();
            this._tagBase = escapeMarkup(this._labelPrefix());
            this._setTagMarkup(this._tagBase);
            this._refresh();
        }

        // (Re)start the background poll timer from the current setting. A value of
        // 0 means "no polling" — usage is then only fetched on menu open.
        _startPolling() {
            this._stopPolling();
            const secs = this._settings.get_int('refresh-seconds');
            if (secs <= 0)
                return;
            // Refresh once now so the color is current without waiting a full tick.
            this._refresh();
            this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, secs, () => {
                this._refresh();
                return GLib.SOURCE_CONTINUE;
            });
        }

        _stopPolling() {
            if (this._timerId) {
                GLib.source_remove(this._timerId);
                this._timerId = 0;
            }
        }

        // Retry after a rate-limit (429), backing off a little each time and giving
        // up after a few tries so we don't hammer the endpoint.
        _scheduleRetry() {
            if (this._retryId)
                return;
            if (this._retryCount >= 5) {
                this._updatedItem.label.text = 'Rate limited — try again shortly';
                return;
            }
            this._retryCount++;
            const delay = Math.min(4 + this._retryCount * 3, 20);
            this._retryId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, delay, () => {
                this._retryId = 0;
                this._refresh(true);
                return GLib.SOURCE_REMOVE;
            });
        }

        _stopRetry() {
            if (this._retryId) {
                GLib.source_remove(this._retryId);
                this._retryId = 0;
            }
        }

        // Freshness of the last successful update. Returns null if never updated,
        // {live: true} when <1 min old, else {live: false, text: "1m"/"1h5m"}.
        _ageParts() {
            if (!this._lastUpdate)
                return null;
            const secs = Math.max(0,
                GLib.DateTime.new_now_local().difference(this._lastUpdate) / 1e6);
            if (secs < 60)
                return { live: true };
            if (secs < 3600)
                return { live: false, text: `${Math.floor(secs / 60)}m` };
            return {
                live: false,
                text: `${Math.floor(secs / 3600)}h${Math.floor((secs % 3600) / 60)}m`
            };
        }

        // Panel-bar tag: account + percentages, e.g. "W 5/40" — plus an age
        // suffix once the data is stale, e.g. "W 5/40 (1m)".
        _renderPanel() {
            // While an error is showing, or right after a switch before this
            // account's data has loaded, leave whatever's on the tag alone.
            if (!this._lastOk || this._shownAccount !== this._activeIndex)
                return;
            const age = this._ageParts();
            if (age && !age.live)
                this._setTagMarkup(`${this._tagBase} (${age.text})`);
            else
                this._setTagMarkup(this._tagBase);
        }

        // Freshness line inside the menu, e.g. "Updated 14:30" / "Updated 14:30 (1m)".
        _renderAge() {
            const age = this._ageParts();
            if (!age) {
                this._updatedItem.label.text = 'Never updated';
                return;
            }
            const time = this._lastUpdate.format('%H:%M');
            this._updatedItem.label.text = age.live
                ? `Updated ${time}`
                : `Updated ${time} (${age.text})`;
        }

        _startAgeTick() {
            this._stopAgeTick();
            // Re-render periodically so (1m) → (2m)… appears and advances on its own,
            // on both the panel tag and the menu line.
            this._ageTickId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {
                if (this._lastOk) {
                    this._renderPanel();
                    this._renderAge();
                }
                return GLib.SOURCE_CONTINUE;
            });
        }

        _stopAgeTick() {
            if (this._ageTickId) {
                GLib.source_remove(this._ageTickId);
                this._ageTickId = 0;
            }
        }

        _setAccount(index) {
            if (index === this._activeIndex || !this._accounts[index])
                return;
            this._activeIndex = index;
            this._settings.set_int('active-account-index', index);
            // The stored limits belong to the previous account.
            this._lastLimits = null;
            this._tagBase = escapeMarkup(this._labelPrefix());
            this._setTagMarkup(this._tagBase);
            this._syncAccountOrnaments();
            this._refresh();
        }

        _syncAccountOrnaments() {
            this._accountItems.forEach((item, i) => {
                item.setOrnament(i === this._activeIndex
                    ? PopupMenu.Ornament.DOT
                    : PopupMenu.Ornament.NONE);
            });
        }

        _openPrefs() {
            try {
                Gio.DBus.session.call(
                    'org.gnome.Shell.Extensions',
                    '/org/gnome/Shell/Extensions',
                    'org.gnome.Shell.Extensions',
                    'OpenExtensionPrefs',
                    new GLib.Variant('(ssa{sv})', [this._uuid, '', {}]),
                    null, Gio.DBusCallFlags.NONE, -1, null, null);
            } catch (e) {
                logError(e, 'pharos: open prefs');
            }
        }

        // Reset caption under a bar: absolute time plus the relative countdown,
        // e.g. "resets 14:30 · in 2h 30m".
        _resetText(iso, mode) {
            const abs = formatReset(iso);
            const rel = formatRelative(iso, mode);
            return rel ? `resets ${abs} · ${rel}` : `resets ${abs}`;
        }

        // Beacon state for a utilization percentage: clear water → light on
        // the horizon → full beam → on the rocks.
        _stateFor(pct) {
            if (pct >= this._settings.get_int('crit-threshold'))
                return STATE_CRITICAL;
            if (pct >= this._settings.get_int('warn-threshold'))
                return STATE_WARNING;
            if (pct >= this._settings.get_int('caution-threshold'))
                return STATE_CAUTION;
            return STATE_OK;
        }

        // Point the beacon at a state: swap the state icon (when the assets
        // are present) and tint it — or clear the tint for OK. The tag is
        // NOT tinted here: its metrics carry their own per-limit colors.
        _setBeacon(state) {
            if (this._gicons[state.icon])
                this._icon.gicon = this._gicons[state.icon];
            this._icon.set_style(state.color ? `color: ${state.color};` : null);
        }

        // Menu bar color for one usage window's own percentage.
        _barColor(pct) {
            return this._stateFor(pct).color ?? NEUTRAL_BAR;
        }

        // Repaint every meter row from the limits already parsed. Split out
        // of _update so a threshold change recolors the open menu without
        // waiting for the next fetch.
        _recolorMeters() {
            for (const limit of this._lastLimits ?? []) {
                const meter = this._meters.get(limit.key);
                if (!meter)
                    continue;
                const color = this._barColor(limit.pct);
                meter.setUsage(limit.pct, color);
                meter.setLimiting(limit.isActive, color);
            }
        }

        _setError(detail) {
            this._lastOk = false;
            this._lastLimits = null;
            // The beacon can't see: exclamation badge + critical tint.
            this._setBeacon(STATE_CRITICAL);
            this._setTagMarkup(escapeMarkup(this._labelPrefix()));
            const meters = [...this._meters.values()];
            meters.forEach(m => {
                m.clear();
                m.setCaption('');
            });
            // The error detail goes on the first meter row — or straight on
            // the status line when no rows exist yet (fresh install).
            if (meters.length) {
                meters[0].setCaption(detail);
                this._updatedItem.label.text = 'Update failed';
            } else {
                this._updatedItem.label.text = detail;
            }
            this._extraItem.visible = false;
        }

        // Fetch and render usage for the active account. Never rejects — all
        // failures end up rendered (or silently dropped when superseded).
        async _refresh(isRetry = false) {
            // Any genuine refresh (menu open, poll tick, account switch) resets the
            // rate-limit backoff; only the retry timer itself passes isRetry.
            if (!isRetry) {
                this._stopRetry();
                this._retryCount = 0;
            }
            this._updatedItem.label.text = 'Updating…';

            // Only one fetch in flight: newer refreshes win.
            this._cancellable?.cancel();
            const cancellable = this._cancellable = new Gio.Cancellable();

            try {
                const data = await this._client.fetchUsage(
                    this._accounts[this._activeIndex], cancellable);
                if (cancellable.is_cancelled())
                    return;
                this._update(data);
            } catch (e) {
                if (cancellable.is_cancelled() ||
                    e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    return;
                if (e instanceof UsageError && e.kind === 'rate-limit') {
                    // The usage endpoint rate-limits quickly (e.g. when a poll
                    // and an account switch land close together). Don't flash a
                    // red error over good data — keep what's shown and retry.
                    this._updatedItem.label.text = 'Rate limited — retrying…';
                    if (this._shownAccount !== this._activeIndex) {
                        // Nothing valid on screen for the account just switched
                        // to; show a neutral loading state instead of stale data.
                        for (const meter of this._meters.values()) {
                            meter.clear('…');
                            meter.setCaption('');
                        }
                    }
                    this._scheduleRetry();
                    return;
                }
                if (!(e instanceof UsageError))
                    logError(e, 'pharos: refresh');
                this._setError(e instanceof UsageError ? e.message : `Error: ${e.message}`);
            }
        }

        _update(data) {
            // Success: clear any rate-limit backoff and record whose data is shown.
            this._stopRetry();
            this._retryCount = 0;
            this._shownAccount = this._activeIndex;
            this._lastOk = true;
            this._lastUpdate = GLib.DateTime.new_now_local();

            // Every limit the account reports — session, weekly, and any
            // model-scoped windows — becomes a meter row. The beacon shows
            // the worst limit among the user's beacon selection: the
            // lighthouse doesn't care which ship is closest to the rocks,
            // but the keeper chooses which ships to watch.
            const limits = parseLimits(data);
            this._lastLimits = limits;
            this._cacheLimits(limits);
            this._syncMeterRows(limits);

            for (const limit of limits) {
                const meter = this._meters.get(limit.key);
                meter.setCaption(this._resetText(limit.resetsAt, limit.mode));
            }
            this._recolorMeters();

            this._applyBeacon();
            this._rebuildTagBase();
            this._renderPanel();

            const extra = data?.extra_usage;
            if (extra?.is_enabled && (extra.used_credits ?? 0) > 0) {
                const cur = extra.currency ?? '';
                this._extraItem.label.text = `Extra usage:  ${extra.used_credits} ${cur}`.trim();
                this._extraItem.visible = true;
            } else {
                this._extraItem.visible = false;
            }

            this._renderAge();
        }

        destroy() {
            this._stopPolling();
            this._stopRetry();
            this._stopAgeTick();
            if (this._accountsReloadId) {
                GLib.source_remove(this._accountsReloadId);
                this._accountsReloadId = 0;
            }
            if (this._accountsChangedId) {
                this._settings.disconnect(this._accountsChangedId);
                this._accountsChangedId = 0;
            }
            if (this._displayChangedIds) {
                for (const id of this._displayChangedIds)
                    this._settings.disconnect(id);
                this._displayChangedIds = null;
            }
            if (this._settingsChangedId) {
                this._settings.disconnect(this._settingsChangedId);
                this._settingsChangedId = 0;
            }
            if (this._openId) {
                this.menu.disconnect(this._openId);
                this._openId = 0;
            }
            if (this._cancellable) {
                this._cancellable.cancel();
                this._cancellable = null;
            }
            if (this._client) {
                this._client.destroy();
                this._client = null;
            }
            super.destroy();
        }
    });
