// Rule-based filtering. No AI, no external calls. Fully deterministic.

const SHORT_TOKEN = /^[a-z]{1,4}$/i; // match short tokens (vp, seo, cmo) on word boundaries only

function makeMatcher(keyword) {
    const k = keyword.trim().toLowerCase();
    if (SHORT_TOKEN.test(k)) {
        const re = new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        return (text) => re.test(text);
    }
    return (text) => text.includes(k);
}

export function buildTitleFilter(includeKeywords, excludeKeywords) {
    const includers = (includeKeywords || []).map(makeMatcher);
    const excluders = (excludeKeywords || []).map(makeMatcher);
    return function titlePasses(rawTitle) {
        const title = ` ${String(rawTitle || '').toLowerCase().trim()} `;
        if (!title.trim()) return false;
        if (excluders.some((f) => f(title))) return false;
        return includers.some((f) => f(title));
    };
}

// Returns "yes" | "no" | "unknown"
export function classifyRemote(locationText, extraText = '') {
    const t = `${locationText || ''} ${extraText || ''}`.toLowerCase();
    if (!t.trim()) return 'unknown';
    const saysRemote = /\bremote\b|\bwork from home\b|\bwfh\b|\banywhere\b|\bdistributed\b/.test(t);
    const saysOnsite = /\b(on-?site|in office|in-office|in person|in-person|hybrid)\b/.test(t);
    if (saysRemote && !saysOnsite) return 'yes';
    if (saysRemote && saysOnsite) return 'yes'; // "remote or hybrid" style -> still remote-eligible
    if (saysOnsite) return 'no';
    return 'unknown';
}

export function remotePasses(remoteStatus, { remoteOnly, keepIfRemoteUnknown }) {
    if (!remoteOnly) return true;
    if (remoteStatus === 'yes') return true;
    if (remoteStatus === 'unknown') return !!keepIfRemoteUnknown;
    return false;
}
