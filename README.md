# Custom Apify Actors

Job posts are one of the strongest buying signals in B2B. A company hiring a Head of Growth is about to spend on growth. A company hiring a fractional CMO is changing how it does marketing. These four custom Apify actors turn scattered job boards into clean, qualified, deduplicated datasets that feed straight into Clay for enrichment and outreach.

Three actors **collect** the signals. The fourth **qualifies** them.

```
 job boards                          collect                        qualify                    act
 ─────────────                       ───────                        ───────                    ───
 workatastartup.com (YC) ──▶  YC Marketing Jobs ──────────┐
 workatastartup + mkt1   ──▶  Marketing Leadership Jobs ──┼──▶  LinkedIn Job Checker  ──▶  Clay: enrich,
 gofractional.com        ──▶  GoFractional Jobs ──────────┘     (still open? remote?)      score, reach out
```

| Actor | Source | What it delivers | Built with |
|---|---|---|---|
| [YC Marketing Jobs](yc-marketing-jobs) | workatastartup.com (Y Combinator) | Mid-level marketing roles at YC startups, plus salary, skills and **founder names and LinkedIn** | Python, standard library only |
| [Marketing Leadership Job Scraper](marketing-leadership-job-scraper) | workatastartup.com + jobs.mkt1.co | Manager-to-CMO marketing roles, remote, deduplicated across every run, on a daily schedule | JavaScript, Apify SDK |
| [GoFractional Jobs Scraper](gofractional-jobs-scraper) | gofractional.com | Fractional and contract roles with rates, hours and the **original ATS apply link** | JavaScript, Crawlee + Playwright |
| [LinkedIn Job Checker](linkedin-job-checker) | LinkedIn job URLs | Whether each job is **still open**, and whether it's Remote, Hybrid or On-site | JavaScript, Apify SDK |

## What each one does, and why it's built that way

### YC Marketing Jobs
- **Goes straight to the decision maker.** For YC startups the founders are the buyers, so the actor can pull each founder's name and LinkedIn along with the role. That's the contact for outreach, not just a job title.
- **Zero dependencies.** Written in pure Python standard library, talking to the Apify API directly instead of through the SDK. Nothing to install, nothing to break when a package updates.
- **Reads the site's own data, not its layout.** It parses the structured JSON the page ships with, instead of scraping HTML that changes whenever the design does.
- **Honest about what the source can't tell you.** The site doesn't publish posting dates, so instead of faking a "posted in the last N days" filter, it filters on company activity when available and says so.

### Marketing Leadership Job Scraper
- **Built to run unattended.** It runs on a daily schedule and remembers every job it has seen in a persistent store, so Clay only ever receives new postings.
- **Two outputs for two jobs.** New jobs go to the run's dataset (what Clay picks up) and to a permanent archive of everything ever found.
- **Fails loudly instead of failing silently.** If a board returns zero jobs, the run is marked failed, which is the early warning that a site changed its layout. Filtering everything out is treated as normal, not as an error.
- **Add a job board without touching the core.** Each source is its own module, so a new board is a new file.
- **No AI cost.** Deterministic keyword and seniority rules, configurable from the input, with no code changes needed.

### GoFractional Jobs Scraper
- **Handles a site behind bot protection.** It renders pages in a real headless browser, with residential proxies and low concurrency to stay under rate limits.
- **Reads the app's data layer.** It pulls jobs from the site's Next.js page data rather than its HTML, which keeps it accurate when the design changes.
- **Finds where the job really lives.** Each record includes the original apply link (Greenhouse, Lever, Ashby, Workday or the company site), which is the hiring company's own system, not just the job board page.
- **Incremental mode for schedules.** Turn it on and each run outputs only jobs it hasn't seen before.
- **Never fabricates.** If a posting has no full description, the record is flagged `summary-only` instead of padded out.
- **Debug modes built in.** It can dump the raw page data to diagnose a site change in minutes.

### LinkedIn Job Checker
- **Qualifies the list before anyone acts on it.** Closed jobs are dead signals. This checks each posting is still accepting applications before it reaches outreach.
- **No login, no account risk.** It reads LinkedIn's public job pages only, so no LinkedIn account is ever at risk of a ban.
- **Layered detection for remote, hybrid or on-site.** It checks LinkedIn's own workplace label first, then the job criteria, then the location, then the description, stopping at the first clear answer.
- **Per-job error handling.** A bad URL produces an error record for that job, not a crashed run.

## The engineering principles behind them

- **Clean, consistent output** that drops straight into a Clay table.
- **Built for schedules,** with deduplication on the scheduled scrapers so repeated runs don't flood the pipeline.
- **Resilient to site changes,** by reading structured page data instead of brittle HTML.
- **Observable,** with failures that are loud and specific rather than empty datasets.
- **Honest data.** Missing fields are flagged, never guessed.

Each folder is a standalone Apify actor with its own `.actor/actor.json`, input schema and README.
