import { Actor } from 'apify';
import { buildTitleFilter, classifyRemote, remotePasses } from './filter.js';
import { scrapeWorkAtAStartup } from './sources/workatastartup.js';
import { scrapeMkt1 } from './sources/mkt1.js';

const SCRAPERS = {
    workatastartup: scrapeWorkAtAStartup,
    mkt1: scrapeMkt1,
};

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

await Actor.init();

const input = (await Actor.getInput()) || {};
const {
    sources = [],
    includeKeywords = [],
    excludeKeywords = [],
    remoteOnly = true,
    keepIfRemoteUnknown = true,
    datasetName = 'marketing-leadership-jobs',
    failIfSourceEmpty = true,
    useApifyProxy = true,
} = input;

if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error('input.sources must be a non-empty array');
}

const titlePasses = buildTitleFilter(includeKeywords, excludeKeywords);

let proxyUrl;
if (useApifyProxy) {
    try {
        const proxyConfiguration = await Actor.createProxyConfiguration();
        proxyUrl = proxyConfiguration ? await proxyConfiguration.newUrl() : undefined;
    } catch (err) {
        console.log(`Proxy unavailable, continuing without: ${err.message}`);
    }
}

const dataset = await Actor.openDataset(datasetName);
const runSummary = [];
const failures = [];
const scrapedAt = new Date().toISOString();

for (const source of sources) {
    const name = source.name || source.type;
    const scraper = SCRAPERS[source.type];
    if (!scraper) {
        failures.push(`${name}: unknown source type "${source.type}"`);
        continue;
    }

    let raw = [];
    try {
        raw = await scraper(source, { proxyUrl });
    } catch (err) {
        console.log(`[${name}] ERROR: ${err.message}`);
        failures.push(`${name}: scrape threw (${err.message})`);
        runSummary.push({ source: name, raw: 0, matched: 0, new: 0, error: err.message });
        continue;
    }

    if (raw.length === 0 && failIfSourceEmpty) {
        failures.push(`${name}: scraped 0 raw jobs (layout may have changed)`);
    }

    // --- filter ---
    const matched = [];
    for (const job of raw) {
        if (!titlePasses(job.title)) continue;
        const remote = job.remote || classifyRemote(job.location, job.employment_type);
        if (!remotePasses(remote, { remoteOnly, keepIfRemoteUnknown })) continue;
        matched.push({
            title: job.title,
            company: job.company,
            location: job.location,
            remote,
            employment_type: job.employment_type || '',
            salary: job.salary || '',
            funding_stage: job.funding_stage || '',
            source_site: name,
            url: job.url,
            apply_url: job.apply_url || job.url,
            description_snippet: (job.description_snippet || '').slice(0, 500),
            posted_hint: job.posted_hint || '',
            scraped_at: scrapedAt,
        });
    }

    // --- dedupe against this source's memory in the key-value store ---
    const storeKey = `seen-${slug(name)}`;
    const store = await Actor.openKeyValueStore(`${datasetName}-seen`);
    const memory = (await store.getValue(storeKey)) || { urls: [] };
    const seen = new Set(memory.urls);

    const fresh = matched.filter((j) => j.url && !seen.has(j.url));
    for (const j of fresh) seen.add(j.url);
    await store.setValue(storeKey, { urls: [...seen].slice(-8000) });

    if (fresh.length) {
        // Run's default dataset = just this run's new jobs (what Clay's Apify
        // integration reads from "the last run"). Named dataset = full archive.
        await Actor.pushData(fresh);
        await dataset.pushData(fresh);
    }

    console.log(`[${name}] raw=${raw.length} matched=${matched.length} new=${fresh.length}`);
    runSummary.push({ source: name, raw: raw.length, matched: matched.length, new: fresh.length });
}

await Actor.setValue('RUN_SUMMARY', { scrapedAt, runSummary, failures });

console.log('---- RUN SUMMARY ----');
console.log(JSON.stringify(runSummary, null, 2));

if (failures.length) {
    await Actor.fail(`Source problems: ${failures.join(' | ')}`);
} else {
    await Actor.exit(`OK. ${runSummary.reduce((n, s) => n + s.new, 0)} new job(s) added to "${datasetName}".`);
}
