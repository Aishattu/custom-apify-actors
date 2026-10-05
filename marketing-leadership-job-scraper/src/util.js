import { gotScraping } from 'got-scraping';

const BROWSER_HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
};

export async function fetchText(url, { tries = 3, proxyUrl } = {}) {
    let lastErr;
    for (let n = 0; n < tries; n++) {
        try {
            const res = await gotScraping({
                url,
                headers: BROWSER_HEADERS,
                proxyUrl,
                timeout: { request: 30000 },
                retry: { limit: 0 },
                http2: true,
            });
            if (res.statusCode >= 200 && res.statusCode < 300) return res.body;
            lastErr = new Error(`HTTP ${res.statusCode} for ${url}`);
            if (res.statusCode === 404 || res.statusCode === 410) throw lastErr;
        } catch (err) {
            lastErr = err;
        }
        await sleep(1500 * (n + 1));
    }
    throw lastErr;
}

export function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

export function decodeEntities(s) {
    if (!s) return '';
    return String(s)
        .replace(/&quot;/g, '"')
        .replace(/&#34;/g, '"')
        .replace(/&#0*39;/g, "'")
        .replace(/&#x27;/gi, "'")
        .replace(/&apos;/g, "'")
        .replace(/&#x2F;/gi, '/')
        .replace(/&#47;/g, '/')
        .replace(/&gt;/g, '>')
        .replace(/&lt;/g, '<')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&');
}

export function stripHtml(h) {
    if (!h) return '';
    return decodeEntities(
        String(h)
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<[^>]+>/g, ' '),
    )
        .replace(/\s+/g, ' ')
        .trim();
}

export function daysAgoIso(value) {
    if (!value) return '';
    let dt;
    if (typeof value === 'number') dt = new Date(value * (value < 1e12 ? 1000 : 1));
    else dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return '';
    return dt.toISOString().slice(0, 10);
}
