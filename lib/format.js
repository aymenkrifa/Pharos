// Time formatting helpers for reset timestamps. GLib-only.

import GLib from 'gi://GLib';

// "12:39" local time, or "Jun 12 05:00" if not today.
export function formatReset(iso) {
    if (!iso)
        return '—';
    const dt = GLib.DateTime.new_from_iso8601(iso, null);
    if (!dt)
        return '—';
    const local = dt.to_local();
    const now = GLib.DateTime.new_now_local();
    const sameDay = local.get_year() === now.get_year() &&
        local.get_day_of_year() === now.get_day_of_year();
    return local.format(sameDay ? '%H:%M' : '%b %e %H:%M');
}

// Time-until-reset as a relative string. The granularity differs per window:
//   'five'  (5-hour): hours+minutes, or just minutes under an hour.
//   'seven' (7-day):  days+hours, then hours+minutes under a day, then just
//                     minutes under an hour.
// Returns '' if there's no valid timestamp.
export function formatRelative(iso, mode) {
    if (!iso)
        return '';
    const dt = GLib.DateTime.new_from_iso8601(iso, null);
    if (!dt)
        return '';
    // difference() is (this - other) in microseconds; reset - now = remaining.
    let secs = dt.difference(GLib.DateTime.new_now_local()) / 1e6;
    if (secs < 0)
        secs = 0;
    const mins = Math.floor(secs / 60);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);

    if (mode === 'seven') {
        if (days >= 1)
            return `in ${days}d ${hours % 24}h`;
        if (hours >= 1)
            return `in ${hours}h ${mins % 60}m`;
        return `in ${mins}m`;
    }
    // 'five'
    if (hours >= 1)
        return `in ${hours}h ${mins % 60}m`;
    return `in ${mins}m`;
}
