# GoFractional Jobs Scraper

Scrapes fractional / interim / contract job listings from **gofractional.com**, past its
Cloudflare challenge, into clean structured records.

## Input

| field | default | notes |
|---|---|---|
| `startUrls` | `/jobs/fractional-cmo` | Any GoFractional list/category/role page: `/jobs/fractional-cmo`, `/jobs/marketing`, `/jobs/fractional-cfo`, `/jobs/london`, `/jobs/remote`, `/jobs` … |
| `scrapeDetails` | `true` | Open each job page for full description, company description, original posting URL + source platform. Off = fast list-only pull. |
| `followPagination` | `true` | Follow `?page=2,3,…` when a list reports more results. |
| `onlyNewSinceLastRun` | `false` | **Turn ON for a scheduled run.** Remembers every job id seen in past runs (persistent store `gofractional-seen-jobs`) and outputs only jobs not seen before. First run = full list + baseline recorded; later runs = only new postings. |
| `maxAgeDays` | `0` | Skip jobs published more than N days ago. |
| `maxItems` | `0` (all) | Stop after N job records. |
| `maxConcurrency` | `2` | Parallel browser pages. Raise cautiously. |
| `proxyConfiguration` | Apify **RESIDENTIAL** | Required to clear Cloudflare. `UNBLOCKER` also works. |
| `dumpOnly` / `debug` | `false` | Diagnostics only. |

## Output (one item per job)

Core (always): `id, slug, title, summary, companyName, companyDomain, companyWebsite,
companyAnonymous, vertical, seniority, location, city, state, country, locationType, remote,
minHourlyRate, maxHourlyRate, ratesAreEstimated, minWeeklyHours, maxWeeklyHours, minNumMonths,
contractDuration, convertibleToFullTime, skills, isInternal, createdAt, publishedAt, expiresAt,
url, scrapedAt`

With `scrapeDetails`: `description` (markdown), `descriptionFormat`, `companyDescription`,
`applyUrl` (the original job posting — Greenhouse / Lever / Ashby / Workday / company site / LinkedIn),
`sourcePlatform`, `originalTitle`, `startDate`, `compensationType`, `isInterim`, `isFractional`,
`datePosted`, `metaTitle`, `metaDescription`.

`applyUrl` is the real outbound application link. `url` is the GoFractional page.
When a posting has no stored description, `description` falls back to `summary` and
`descriptionFormat` is `"summary-only"` (flagged, never fabricated).

## How it gets past Cloudflare

Headless Chrome (runs the site's JS) + Apify Residential proxy (real residential IP) +
browser fingerprinting. No Cloudflare account involved — this just satisfies the challenge
the site puts in front of its own pages. Data is read from the page's Next.js `__NEXT_DATA__`
payload, not brittle DOM selectors.
