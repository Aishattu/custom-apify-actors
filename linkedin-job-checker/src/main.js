import { Actor } from 'apify';

await Actor.init();

const input = await Actor.getInput();
const {
    jobUrls = [],
    delayBetweenRequests = 2000,
} = input ?? {};

if (!jobUrls.length) {
    console.log('No jobUrls provided in input.');
    await Actor.exit();
}

function extractJobId(url) {
    // Handles both /jobs/view/1234567890 and /jobs/view/job-title-slug-1234567890
    const m = url.match(/(\d{9,})(?:[^0-9]|$)/);
    return m ? m[1] : null;
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function fetchJob(jobId) {
    const url = `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${jobId}`;
    const res = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://www.linkedin.com/',
        },
        signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
}

for (const jobUrl of jobUrls) {
    const jobId = extractJobId(jobUrl);
    if (!jobId) {
        console.log(`Could not extract job ID from: ${jobUrl}`);
        await Actor.pushData({ jobUrl, error: 'Could not extract job ID' });
        continue;
    }

    console.log(`Checking job ${jobId}...`);

    try {
        const body = await fetchJob(jobId);

        // Job is active only if LinkedIn includes the apply button in the guest API response.
        // Closed jobs have the apply-button removed from the HTML by LinkedIn.
        const isActive = body.includes('apply-button');

        // Extract title and company
        const titleMatch = body.match(/<h2[^>]*class="[^"]*top-card-layout__title[^"]*"[^>]*>([\s\S]*?)<\/h2>/i);
        const companyMatch = body.match(/<a[^>]*class="[^"]*topcard__org-name-link[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
        const decodeHtml = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'");
        const title = titleMatch ? decodeHtml(titleMatch[1].replace(/<[^>]+>/g, '').trim()) : '';
        const company = companyMatch ? decodeHtml(companyMatch[1].replace(/<[^>]+>/g, '').trim()) : '';

        // --- Extract full job description first (used both as output and for workplace fallback) ---
        let rawDesc = '';
        const markupMatch = body.match(/<div[^>]*class="[^"]*show-more-less-html__markup[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/section>/i);
        if (markupMatch) {
            rawDesc = markupMatch[1];
        } else {
            const startIdx = body.search(/<div[^>]*class="[^"]*description__text[^"]*"/i);
            if (startIdx >= 0) {
                rawDesc = body.slice(startIdx, startIdx + 20000);
                rawDesc = rawDesc.replace(/^<div[^>]*>/, '').replace(/<\/div>\s*$/, '');
            }
        }
        let cleanDesc = rawDesc
            .replace(/<button[^>]*>[\s\S]*?<\/button>/gi, '')
            .replace(/Show\s+(?:more|less)/gi, '');
        const sidebarIdx = cleanDesc.search(/Seniority\s+level|Employment\s+type|Job\s+function|Industries/i);
        if (sidebarIdx > 0) cleanDesc = cleanDesc.slice(0, sidebarIdx);

        const description = cleanDesc
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>/gi, '\n')
            .replace(/<li[^>]*>/gi, '\n• ')
            .replace(/<\/li>/gi, '')
            .replace(/<\/?(ul|ol)[^>]*>/gi, '\n')
            .replace(/<\/?(h[1-6])[^>]*>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
            .replace(/[ \t]+/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/[\s\n•]+$/, '')
            .trim();

        // --- Workplace type detection (structured data first, then description as fallback) ---
        let workplaceType = 'Not specified';

        // Method 1: LinkedIn CSS class markers — most reliable, only set when LinkedIn explicitly tags the job
        if (body.includes('workplace-type--remote') || body.includes('location-type--remote')) {
            workplaceType = 'Remote';
        } else if (body.includes('workplace-type--hybrid') || body.includes('location-type--hybrid')) {
            workplaceType = 'Hybrid';
        } else if (body.includes('workplace-type--on-site') || body.includes('location-type--on-site')) {
            workplaceType = 'On-site';

        // Method 2: criteria list section (structured, job-specific)
        } else {
            const criteriaSection = body.match(/<ul[^>]*class="[^"]*description__job-criteria-list[^"]*"[^>]*>([\s\S]*?)<\/ul>/i);
            if (criteriaSection) {
                const criteria = criteriaSection[1];
                if (/\bRemote\b/i.test(criteria)) workplaceType = 'Remote';
                else if (/\bHybrid\b/i.test(criteria)) workplaceType = 'Hybrid';
                else if (/\bOn-?site\b/i.test(criteria)) workplaceType = 'On-site';
            }
        }

        // Method 3: location field (only if it IS the workplace type, e.g. location = "Remote")
        // Uses topcard__flavor--bullet specifically — plain topcard__flavor also matches the
        // company name span, which comes first in the HTML and would shadow the real location.
        if (workplaceType === 'Not specified') {
            const locMatch = body.match(/<span[^>]*class="[^"]*(?:topcard__flavor--bullet|job-search-card__location)[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
            if (locMatch) {
                const loc = locMatch[1].replace(/<[^>]+>/g, '').trim();
                if (/^\s*Remote\s*$/i.test(loc)) workplaceType = 'Remote';
                else if (/^\s*Hybrid\s*$/i.test(loc)) workplaceType = 'Hybrid';
            }
        }

        // Method 4: read the scraped job description text (job-specific, not sidebar/related jobs)
        if (workplaceType === 'Not specified' && description) {
            if (/\bremote\b/i.test(description)) workplaceType = 'Remote';
            else if (/\bhybrid\b/i.test(description)) workplaceType = 'Hybrid';
            else if (/\bon[- ]?site\b/i.test(description)) workplaceType = 'On-site';
        }

        const result = { jobUrl, jobId, isActive, workplaceType, title, company, description, checkedAt: new Date().toISOString() };
        console.log(`  → isActive: ${isActive} | type: ${workplaceType} | "${title}" @ ${company}`);
        await Actor.pushData(result);

    } catch (err) {
        console.error(`Error checking job ${jobId}: ${err.message}`);
        await Actor.pushData({ jobUrl, jobId, error: err.message });
    }

    if (delayBetweenRequests > 0) await sleep(delayBetweenRequests);
}

await Actor.exit();
