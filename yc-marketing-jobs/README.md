# YC Marketing Jobs

Scrapes Y Combinator's job board, [workatastartup.com](https://www.workatastartup.com), for mid-level marketing roles: manager, lead, specialist, growth and product marketing. VP, C-level, President and intern roles are left out. One item per job goes to the actor's dataset, ready to import into Clay with "Import from Apify Actor".

Written in Python with only the standard library, so there are no dependencies to install.

## Input

| Field | What it does |
|---|---|
| `maxPages` | How many pages of the marketing listing to scan. The board rarely has more than one. |
| `fetchDetail` | Also open each job page for the full description, salary and equity, minimum experience, skills, and the founders' names and LinkedIn. |
| `includeDirector` | Keep Director titles. Off by default, since they're usually too senior for this search. |
| `activeWithinDays` | Keep jobs whose company was active in the last N days. |
| `strictRecency` | Also drop jobs with no company-activity date. Off by default, so they're kept. |
| `limit` | Optional cap on how many jobs are saved. |

## A note on recency

workatastartup doesn't publish a "posted on" date for each job, so an exact "posted in the last N days" filter isn't possible. The actor filters on the company's last-active date when the site provides it, and keeps jobs without a date unless `strictRecency` is on. It says so rather than guessing.
