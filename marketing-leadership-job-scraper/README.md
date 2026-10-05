# Marketing Leadership Job Scraper

Daily scrape of manager-to-director + CMO level marketing roles (remote-only, keeps
"unknown"), deduped, for import into Clay. Deterministic rule-based filtering. No AI,
no Anthropic API in the pipeline.

## How it works

- Each run scrapes every entry in `input.sources`, applies the title include/exclude
  keyword lists and the remote filter, dedupes against the KV store, and writes only
  NEW jobs to two places:
  - the run's **default dataset** (what Clay's Apify integration reads as "last run")
  - the named **archive dataset** `marketing-leadership-jobs` (everything ever found)
- If any source returns **zero raw jobs**, the run is marked FAILED. That is the
  early warning that a site changed its layout and a source module needs updating.
  Filtering everything out is not a failure.

## Sources (v1)

- `workatastartup` — YC Work at a Startup, marketing listing
- `mkt1` — jobs.mkt1.co

## Adding / changing filters

Edit the actor input (or a saved Task's input) in the Apify console:
`includeKeywords`, `excludeKeywords`, `remoteOnly`, `keepIfRemoteUnknown`.

## v2 TODO

- Built In (Cloudflare — needs Playwright + residential proxy)
- Go Fractional: the `gofractional-jobs-scraper` actor in this repo
  already handles that site; fold its output in or port its `__NEXT_DATA__` parse
  as a `gofractional` source type here
- Wellfound — GraphQL + auth, hard, deferred
