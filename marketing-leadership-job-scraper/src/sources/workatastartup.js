import { fetchText, decodeEntities, sleep, daysAgoIso } from '../util.js';

const BASE = 'https://www.workatastartup.com';

// The listing page embeds an Inertia.js JSON blob as an HTML-escaped string.
// Grab the largest {&quot;...} chunk, decode entities, JSON.parse, read .props.jobs.
function extractProps(html) {
    const blobs = html.match(/\{&quot;[^<]{200,}\}/g);
    if (!blobs || !blobs.length) return {};
    blobs.sort((a, b) => b.length - a.length);
    for (const blob of blobs) {
        try {
            return JSON.parse(decodeEntities(blob)).props || {};
        } catch {
            // try next-longest blob
        }
    }
    return {};
}

export async function scrapeWorkAtAStartup(source, { proxyUrl } = {}) {
    const maxPages = source.maxPages || 3;
    const startUrl = source.startUrl || `${BASE}/jobs/l/marketing`;
    const seen = new Map();

    for (let page = 1; page <= maxPages; page++) {
        const url = page > 1
            ? `${startUrl}${startUrl.includes('?') ? '&' : '?'}page=${page}`
            : startUrl;

        let jobs;
        try {
            const html = await fetchText(url, { proxyUrl });
            jobs = extractProps(html).jobs || [];
        } catch (err) {
            if (page === 1) throw err;
            break;
        }
        if (!jobs.length) break;

        for (const j of jobs) {
            if (!j || seen.has(j.id)) continue;
            seen.set(j.id, {
                title: j.title || '',
                company: j.companyName || '',
                location: j.location || '',
                employment_type: j.jobType || '',
                salary: j.salary || '',
                funding_stage: j.companyBatch || '',
                description_snippet: j.companyOneLiner || '',
                posted_hint: j.companyLastActiveAt
                    ? `company active ${daysAgoIso(j.companyLastActiveAt)}`
                    : '',
                url: `${BASE}/jobs/${j.id}`,
                apply_url: j.applyUrl || `${BASE}/jobs/${j.id}`,
            });
        }
        if (jobs.length < 20) break;
        await sleep(1000);
    }

    return [...seen.values()];
}
