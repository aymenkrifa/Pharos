// Limit model: turns the usage endpoint's response into a uniform, ordered
// list of limits, and resolves the user's metric selections against it.
//
// Imported by BOTH the shell process and the prefs dialog — plain data in,
// plain data out; no Shell/St/GLib imports.
//
// One parsed limit:
//   key      stable settings identifier ('session', 'weekly_all', 'weekly:Fable')
//   name     row title ('Session', 'Weekly', 'Weekly · Fable')
//   short    compact tag name for the full number style ('Session', 'Weekly', 'Fable')
//   letter   hint for the letter number style ('s', 'w', 'F')
//   pct      utilization percent, rounded
//   resetsAt ISO timestamp or null
//   mode     granularity for formatRelative ('five' for session-length windows)

function fromEntry(entry) {
    const kind = entry?.kind;
    if (typeof kind !== 'string' || !kind)
        return null;
    const base = {
        pct: Math.round(entry?.percent ?? 0),
        resetsAt: entry?.resets_at ?? null,
        mode: entry?.group === 'session' ? 'five' : 'seven',
    };
    if (kind === 'session') {
        return { key: 'session', name: 'Session', short: 'Session',
            letter: 's', order: 0, ...base };
    }
    if (kind === 'weekly_all') {
        return { key: 'weekly_all', name: 'Weekly', short: 'Weekly',
            letter: 'w', order: 1, ...base };
    }
    const model = entry?.scope?.model?.display_name;
    if (kind === 'weekly_scoped' && model) {
        return {
            key: `weekly:${model}`, name: `Weekly · ${model}`, short: model,
            letter: [...model][0].toUpperCase(), order: 2, ...base,
        };
    }
    // Unknown kinds still get a row rather than silently vanishing.
    const pretty = kind.charAt(0).toUpperCase() + kind.slice(1).replace(/_/g, ' ');
    return {
        key: kind,
        name: pretty,
        short: pretty,
        letter: kind.charAt(0),
        order: 3,
        ...base,
    };
}

// Parse a usage response into ordered limits. Prefers the generalized
// `limits` array (which includes model-scoped windows the legacy blocks
// miss); falls back to the fixed five_hour/seven_day pair on older shapes,
// under the SAME keys so stored selections keep working.
export function parseLimits(data) {
    const entries = Array.isArray(data?.limits) ? data.limits : [];
    const limits = entries.map(fromEntry).filter(Boolean);
    if (limits.length) {
        limits.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
        return limits;
    }
    if (data?.five_hour) {
        limits.push({
            key: 'session', name: 'Session', short: 'Session', letter: 's',
            order: 0, mode: 'five',
            pct: Math.round(data.five_hour.utilization ?? 0),
            resetsAt: data.five_hour.resets_at ?? null,
        });
    }
    if (data?.seven_day) {
        limits.push({
            key: 'weekly_all', name: 'Weekly', short: 'Weekly', letter: 'w',
            order: 1, mode: 'seven',
            pct: Math.round(data.seven_day.utilization ?? 0),
            resetsAt: data.seven_day.resets_at ?? null,
        });
    }
    return limits;
}

// Resolve a stored strv selection against the current limits: '*' selects
// every limit; otherwise the stored keys that exist, in limit order. An
// explicit empty list stays empty — "none" is a valid choice.
export function resolveSelection(selected, limits) {
    if (selected.includes('*'))
        return limits.map(l => l.key);
    return limits.filter(l => selected.includes(l.key)).map(l => l.key);
}
