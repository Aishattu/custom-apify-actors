import * as cheerio from 'cheerio';
import { fetchText, decodeEntities } from '../util.js';

// jobs.mkt1.co server-renders every job as <a class="job-card"> with rich data-* attributes.
// Categories we never want regardless of title:
const BLOCKED_CATEGORIES = new Set([
    'content',
    'social & community',
    'comms & pr',
    'product marketing',
]);
// Seniority bands outside the target range (manager -> director + CMO):
const BLOCKED_SENIORITY = new Set(['vp', 'early career']);

// MKT1 tags "Remote" explicitly, so we can read remote status from its taxonomy.
const SPECIFIC_METROS = ['san francisco bay area', 'new york city'];
function mkt1Remote(locations) {
    const lower = locations.map((l) => l.toLowerCase());
    if (lower.some((l) => l.includes('remote'))) return 'yes';
    if (lower.some((l) => SPECIFIC_METROS.includes(l))) return 'no';
    return 'unknown'; // "Other US", "Europe", "Canada", etc. or nothing
}

export async function scrapeMkt1(source, { proxyUrl } = {}) {
    const startUrl = source.startUrl || 'https://jobs.mkt1.co/';
    const html = await fetchText(startUrl, { proxyUrl });
    const $ = cheerio.load(html);
    const rows = [];

    $('a.job-card').each((_, el) => {
        const $el = $(el);
        const category = ($el.attr('data-category') || '').toLowerCase().trim();
        const seniority = ($el.attr('data-seniority') || '').trim();
        const locations = decodeEntities($el.attr('data-locations') || '')
            .split('|')
            .map((s) => s.trim())
            .filter(Boolean);
        const isNew = ($el.attr('data-new') || '') === 'true';
        const title = decodeEntities($el.find('.job-title').first().text()).trim();
        const company = decodeEntities($el.find('.company-name').first().text()).trim();
        const href = $el.attr('href') || '';

        if (!title || !href) return;
        if (BLOCKED_CATEGORIES.has(category)) return;
        if (BLOCKED_SENIORITY.has(seniority.toLowerCase())) return;

        rows.push({
            title,
            company,
            location: locations.join(', '),
            employment_type: '',
            salary: '',
            funding_stage: decodeEntities($el.attr('data-stage') || '').trim(),
            description_snippet: category ? `MKT1 category: ${category}` : '',
            posted_hint: isNew ? 'new this week (MKT1)' : '',
            url: href,
            apply_url: href,
            remote: mkt1Remote(locations),
        });
    });

    return rows;
}
