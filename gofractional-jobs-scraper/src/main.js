import { Actor } from 'apify';
import { PlaywrightCrawler, log } from 'crawlee';

await Actor.init();

const input = (await Actor.getInput()) ?? {};
const {
    startUrls = [{ url: 'https://www.gofractional.com/jobs/fractional-cmo' }],
    maxItems = 0,
    scrapeDetails = true,
    followPagination = true,
    onlyNewSinceLastRun = false,
    maxAgeDays = 0,
    maxConcurrency = 2,
    debug = false,
    dumpOnly = false,
    proxyConfiguration: proxyInput = { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
} = input;

const proxyConfiguration = await Actor.createProxyConfiguration(proxyInput);

const BASE = 'https://www.gofractional.com';
let pushed = 0;
const seenJobs = new Set();
const seenPages = new Set();
const limitReached = () => maxItems > 0 && pushed >= maxItems;

// Cross-run dedupe: a named store that survives between runs of this actor.
const HISTORY_STORE = 'gofractional-seen-jobs';
const HISTORY_KEY = 'ids';
const historyStore = onlyNewSinceLastRun ? await Actor.openKeyValueStore(HISTORY_STORE) : null;
const previouslySeen = new Set(
    historyStore ? ((await historyStore.getValue(HISTORY_KEY)) ?? []) : [],
);
const newlySeen = [];
log.info(
    onlyNewSinceLastRun
        ? `Incremental mode: ${previouslySeen.size} job id(s) already seen in past runs — those will be skipped.`
        : 'Full mode: returning every matching job (no cross-run dedupe).',
);

const ageCutoff = maxAgeDays > 0 ? Date.now() - maxAgeDays * 86400000 : null;
const tooOld = (job) => {
    if (!ageCutoff) return false;
    const t = Date.parse(job.publishedAt || job.datePosted || job.createdAt || '');
    return Number.isFinite(t) && t < ageCutoff;
};

// ---------- helpers ----------

const decodeEntities = (s) =>
    (s || '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;|&apos;|&rsquo;|&#8217;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&#x27;/g, "'")
        .replace(/&mdash;|&#8212;/g, '-')
        .replace(/&hellip;|&#8230;/g, '...')
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));

const toAbs = (u) => {
    if (!u || typeof u !== 'string') return undefined;
    if (u.startsWith('http')) return u;
    return `${BASE}${u.startsWith('/') ? '' : '/'}${u}`;
};

async function extractNextData(page) {
    return page.evaluate(() => {
        try {
            if (window.__NEXT_DATA__) return window.__NEXT_DATA__;
        } catch (e) { /* noop */ }
        const el = document.getElementById('__NEXT_DATA__');
        if (el) {
            try { return JSON.parse(el.textContent); } catch (e) { /* noop */ }
        }
        return null;
    });
}

async function isCloudflareWall(page) {
    const title = (await page.title().catch(() => '')) || '';
    if (/just a moment|attention required|checking your browser/i.test(title)) return true;
    const body = await page.evaluate(() => document.body?.innerText?.slice(0, 400) || '').catch(() => '');
    return /review the security of your connection|enable javascript and cookies to continue|verifying you are human/i.test(body);
}

// Job object from pageProps.data.publicJobs.jobs[]
function jobFromApi(j, sourceUrl) {
    const c = j.company || {};
    const skills = Array.isArray(j.publicJobPostSkills)
        ? j.publicJobPostSkills.map((s) => s?.skill?.name).filter(Boolean)
        : undefined;
    return {
        id: j.id,
        slug: j.slug,
        title: j.title,
        summary: j.summary,
        companyName: j.isCompanyAnonymous ? (j.sourceCompanyName ?? null) : (c.name ?? j.sourceCompanyName ?? null),
        companyDomain: c.domain ?? null,
        companyWebsite: c.domain ? `https://${c.domain}` : null,
        companyAnonymous: !!j.isCompanyAnonymous,
        vertical: j.vertical?.name ?? null,
        seniority: j.seniority ?? null,
        location: j.location ?? null,
        city: j.city ?? null,
        state: j.state ?? null,
        country: j.country ?? null,
        locationType: j.locationType ?? null,
        remote: j.remote ?? null,
        minHourlyRate: j.minHourlyRate ?? null,
        maxHourlyRate: j.maxHourlyRate ?? null,
        ratesAreEstimated: j.ratesAreEstimated ?? null,
        minWeeklyHours: j.minWeeklyHours ?? null,
        maxWeeklyHours: j.maxWeeklyHours ?? null,
        minNumMonths: j.minNumMonths ?? null,
        contractDuration: j.contractDuration ?? null,
        convertibleToFullTime: j.convertibleToFullTime ?? null,
        skills: skills && skills.length ? skills : null,
        isInternal: j.isInternal ?? null,
        createdAt: j.createdAt ?? null,
        publishedAt: j.publishedAt ?? null,
        expiresAt: j.expiresAt ?? null,
        description: null,
        applyUrl: null,
        url: j.slug ? `${BASE}/job/${j.slug}` : sourceUrl,
        scrapedAt: new Date().toISOString(),
    };
}

function findFirst(node, pred, depth = 0) {
    if (!node || typeof node !== 'object' || depth > 6) return undefined;
    if (Array.isArray(node)) {
        for (const v of node) {
            const r = findFirst(v, pred, depth + 1);
            if (r !== undefined) return r;
        }
        return undefined;
    }
    if (pred(node)) return node;
    for (const v of Object.values(node)) {
        const r = findFirst(v, pred, depth + 1);
        if (r !== undefined) return r;
    }
    return undefined;
}

// Extra fields available only on the /job/<slug> detail payload.
function detailFromApi(j, sourceUrl) {
    if (!j || !Object.keys(j).length) return {};
    const base = jobFromApi(j, sourceUrl);
    const jd = typeof j.jobDescription === 'string' ? decodeEntities(j.jobDescription).trim() : '';
    return {
        ...base,
        description: jd || base.summary || null,
        descriptionFormat: jd ? 'markdown' : (base.summary ? 'summary-only' : null),
        companyDescription: j.companyDescription ? decodeEntities(j.companyDescription).trim() : null,
        applyUrl: j.originalSourceUrl || j.sourceUrl || null,
        sourcePlatform: j.sourcePlatform || null,
        originalTitle: j.originalTitle || null,
        startDate: j.startDate || null,
        compensationType: j.compensationType || null,
        isInterim: j.isInterim ?? null,
        isFractional: j.isFractional ?? null,
        datePosted: j.datePosted || base.publishedAt || null,
        metaTitle: j.metaTitle || null,
        metaDescription: j.metaDescription || null,
    };
}

function nextPageUrl(currentUrl, currentPage) {
    try {
        const u = new URL(currentUrl);
        u.searchParams.set('page', String((currentPage || 1) + 1));
        return u.toString();
    } catch (e) {
        return undefined;
    }
}

// ---------- crawler ----------

const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    maxConcurrency,
    maxRequestRetries: 5,
    navigationTimeoutSecs: 75,
    requestHandlerTimeoutSecs: 110,
    launchContext: { launchOptions: { headless: true } },
    browserPoolOptions: { useFingerprints: true, retireBrowserAfterPageCount: 5 },
    sessionPoolOptions: { maxPoolSize: 50, sessionOptions: { maxUsageCount: 6 } },

    async requestHandler({ request, page, session, crawler: c }) {
        const { label, page: pageNum = 1 } = request.userData;
        if (limitReached()) {
            await c.autoscaledPool?.abort().catch(() => {});
            return;
        }
        log.info(`${label} p${pageNum} → ${request.url}`);

        await page.waitForLoadState('domcontentloaded').catch(() => {});
        for (let i = 0; i < 4 && (await isCloudflareWall(page)); i++) {
            log.warning(`Cloudflare interstitial… (${i + 1}/4)`);
            await page.waitForTimeout(5000);
        }
        if (await isCloudflareWall(page)) {
            session?.retire();
            throw new Error('Blocked by Cloudflare — retrying with fresh session/proxy.');
        }

        await page.waitForFunction(
            () => window.__NEXT_DATA__?.props?.pageProps && Object.keys(window.__NEXT_DATA__.props.pageProps).length > 0,
            { timeout: 15000 },
        ).catch(() => {});
        const nextData = await extractNextData(page);
        const pageProps = nextData?.props?.pageProps ?? nextData?.props ?? {};

        if (!dumpOnly && Object.keys(pageProps).length === 0) {
            session?.retire();
            throw new Error('Empty Next.js payload (partial/challenged response) — retrying.');
        }

        if (label === 'DETAIL') {
            const base = request.userData.listJob || {};
            const j = pageProps.job || pageProps.data?.job || {};
            // The job payload occasionally hydrates a beat late — give it one clean retry.
            if (!j.jobDescription && !request.userData.detailRetried && request.retryCount < 3) {
                request.userData.detailRetried = true;
                throw new Error('Detail payload missing jobDescription — retrying once.');
            }
            const rec = { ...base, ...detailFromApi(j, request.url) };
            if (debug) rec._pagePropsKeys = Object.keys(pageProps);
            if (!limitReached()) {
                await Actor.pushData(rec);
                pushed += 1;
                if (limitReached()) await c.autoscaledPool?.abort().catch(() => {});
            }
            return;
        }

        if (dumpOnly) {
            const anchors = await page.evaluate(() =>
                [...document.querySelectorAll('a[href]')]
                    .map((a) => ({ href: a.getAttribute('href'), text: (a.innerText || '').trim().slice(0, 60) }))
                    .filter((a) => a.href && !/^(#|mailto:|tel:)/.test(a.href)),
            ).catch(() => []);
            await Actor.pushData({
                _dump: true,
                url: request.url,
                finalUrl: page.url(),
                bodyText: await page.evaluate(() => (document.body?.innerText || '').slice(0, 2000)).catch(() => null),
                pagePropsKeys: Object.keys(pageProps),
                jobSlugs: (pageProps?.data?.publicJobs?.jobs || []).map((j) => j.slug),
                anchors,
                pageProps,
            });
            return;
        }

        // LIST
        const publicJobs = pageProps?.data?.publicJobs ?? findFirst(pageProps, (o) => Array.isArray(o.jobs) && 'hasMore' in o);
        const jobs = Array.isArray(publicJobs?.jobs) ? publicJobs.jobs : [];
        const curPage = pageProps?.currentPage ?? pageNum;
        log.info(`Parsed ${jobs.length} job(s); total=${publicJobs?.total}, hasMore=${publicJobs?.hasMore}, page=${curPage}`);

        if (jobs.length === 0 && debug) {
            await Actor.pushData({ _debug: true, url: request.url, pagePropsKeys: Object.keys(pageProps), pageProps });
        }

        let skippedSeen = 0;
        let skippedOld = 0;
        for (const j of jobs) {
            if (limitReached()) break;
            const rec = jobFromApi(j, request.url);
            const key = rec.id || rec.slug || `${rec.title}@${rec.companyName}`;
            if (seenJobs.has(key)) continue;
            seenJobs.add(key);

            if (tooOld(rec)) { skippedOld += 1; continue; }
            if (onlyNewSinceLastRun) {
                if (previouslySeen.has(key)) { skippedSeen += 1; continue; }
                newlySeen.push(key);
            }

            if (scrapeDetails && rec.url && rec.url !== request.url) {
                await c.addRequests([{ url: rec.url, label: 'DETAIL', userData: { label: 'DETAIL', listJob: rec } }]);
            } else {
                await Actor.pushData(rec);
                pushed += 1;
            }
        }
        if (skippedSeen || skippedOld) {
            log.info(`Skipped ${skippedSeen} already-seen and ${skippedOld} older-than-${maxAgeDays}d job(s) on this page.`);
        }

        if (followPagination && publicJobs?.hasMore && !limitReached()) {
            const np = nextPageUrl(request.url, curPage);
            if (np && !seenPages.has(np)) {
                seenPages.add(np);
                await c.addRequests([{ url: np, label: 'LIST', userData: { label: 'LIST', page: curPage + 1 } }]);
            }
        }
    },

    async failedRequestHandler({ request }, err) {
        log.error(`Gave up: ${request.url} — ${err.message}`);
        await Actor.pushData({ _error: true, url: request.url, label: request.userData?.label, message: err.message });
    },
});

await crawler.run(
    startUrls.map((s) => {
        const url = typeof s === 'string' ? s : s.url;
        seenPages.add(url);
        return { url, label: 'LIST', userData: { label: 'LIST', page: 1 } };
    }),
);

if (onlyNewSinceLastRun && historyStore && !dumpOnly) {
    // Keep the newest ~8000 ids so the store stays small.
    const merged = [...previouslySeen, ...newlySeen];
    const trimmed = merged.slice(Math.max(0, merged.length - 8000));
    await historyStore.setValue(HISTORY_KEY, trimmed);
    log.info(`History updated: +${newlySeen.length} new id(s), ${trimmed.length} tracked total.`);
}

log.info(`Done. Pushed ${pushed} record(s).`);
await Actor.exit();
