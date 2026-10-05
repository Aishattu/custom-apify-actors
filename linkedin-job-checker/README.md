# LinkedIn Job Checker

Give it a list of LinkedIn job URLs. For each one it tells you whether the job is **still open** and whether it's **Remote, Hybrid or On-site**. No LinkedIn login needed.

Useful for cleaning a job list before acting on it: drop the postings that have closed, and keep only the work setups you want.

## Input

| Field | What it does |
|---|---|
| `jobUrls` | The LinkedIn job URLs to check. |
| `useProxy` | Send requests through Apify Proxy to avoid rate limits. |
| `delayBetweenRequests` | Milliseconds to wait between jobs, to stay polite to LinkedIn. |

## Output (one item per job)

`jobUrl, jobId, isActive, workplaceType, title, company, description, checkedAt`

If a URL can't be read, the item has an `error` field instead of a guess.

## How it decides

- **Still open?** LinkedIn's public job page only shows an apply button while a job is accepting applications, so `isActive` is true only when that button is there.
- **Remote, Hybrid or On-site?** It checks four places in order and stops at the first clear answer: LinkedIn's own workplace label, the job criteria, the location field (only when it literally says "Remote" or "Hybrid"), and finally the job description.
