# Apify Actors

Custom Apify actors that turn job boards into clean, structured datasets, ready to pull into Clay. Each one handles a site that doesn't offer a usable export: it finds the listings, filters them down to the roles that matter, removes duplicates, and outputs one tidy record per job.

| Actor | Source | What it pulls | Built with |
|---|---|---|---|
| [YC Marketing Jobs](yc-marketing-jobs) | workatastartup.com (Y Combinator) | Mid-level marketing roles, with optional salary, skills and founder details | Python |
| [Marketing Leadership Job Scraper](marketing-leadership-job-scraper) | workatastartup.com + jobs.mkt1.co | Manager-to-director and CMO marketing roles, remote only, deduped across runs | JavaScript |
| [GoFractional Jobs Scraper](gofractional-jobs-scraper) | gofractional.com | Fractional and contract roles with rates, hours and the original apply link | JavaScript, headless Chrome |

## What they have in common

- **Clean output for Clay.** One record per job, with consistent fields, so the dataset drops straight into a Clay table.
- **Filtering built in.** Keyword include and exclude lists, seniority rules and remote filters, all set from the actor input, with no code changes needed.
- **Only new jobs on scheduled runs.** The Marketing Leadership and GoFractional actors remember what they've already seen and output only new postings, so a daily schedule doesn't flood Clay with repeats.
- **Honest about gaps.** Missing data is flagged, never made up. For example, if a posting has no description, the record says so.
- **Early warning when a site changes.** In the Marketing Leadership actor, if a source suddenly returns nothing at all, the run fails loudly instead of quietly producing an empty dataset.

## Running one

Each folder is a standalone Apify actor with its own `.actor/actor.json` and input schema. See each actor's README for its inputs and output fields.
