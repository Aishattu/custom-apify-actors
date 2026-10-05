"""
YC Marketing Jobs -- Apify actor (pure standard library, no SDK).

Scrapes workatastartup.com for mid-level marketing roles (manager / lead /
specialist / growth / PMM level -- NOT VP / C-level / President) and pushes one
item per job to the actor's default dataset. Wire that dataset into Clay via the
"Import from Apify Actor" source.

Recency: workatastartup does not publish a per-job "posted date" anywhere in its
public data, so an exact "posted in the last N days" filter is not possible. The
actor filters on `companyLastActiveAt` when the site provides it; rows without a
date are kept unless `strictRecency` is set.
"""

import html as html_mod
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

# --- Apify plumbing (env vars are injected into every actor run) --------------

def _env(*names, default=""):
    for n in names:
        v = os.environ.get(n)
        if v:
            return v
    return default


API = _env("APIFY_API_BASE_URL", default="https://api.apify.com").rstrip("/")
TOKEN = _env("APIFY_TOKEN")
DATASET_ID = _env("ACTOR_DEFAULT_DATASET_ID", "APIFY_DEFAULT_DATASET_ID")
KV_STORE_ID = _env("ACTOR_DEFAULT_KEY_VALUE_STORE_ID", "APIFY_DEFAULT_KEY_VALUE_STORE_ID")
INPUT_KEY = _env("ACTOR_INPUT_KEY", "APIFY_INPUT_KEY", default="INPUT")


def _api(method, path, body=None):
    url = f"{API}{path}"
    url += ("&" if "?" in url else "?") + f"token={TOKEN}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if body is not None:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=120) as r:
        raw = r.read()
        return json.loads(raw) if raw and r.headers.get("Content-Type", "").startswith("application/json") else raw


def get_input() -> dict:
    # Local run: Apify writes INPUT.json into the default key-value store on disk
    local = f"storage/key_value_stores/default/{INPUT_KEY}.json"
    if os.path.exists(local):
        with open(local, encoding="utf-8") as f:
            return json.load(f) or {}
    if KV_STORE_ID and TOKEN:
        try:
            return _api("GET", f"/v2/key-value-stores/{KV_STORE_ID}/records/{INPUT_KEY}") or {}
        except urllib.error.HTTPError as e:
            if e.code != 404:
                raise
    return {}


def push_data(items: list):
    if not items:
        return
    if DATASET_ID and TOKEN:
        _api("POST", f"/v2/datasets/{DATASET_ID}/items", items)
    else:  # local dev without Apify env -- dump to disk
        os.makedirs("storage/datasets/default", exist_ok=True)
        for i, it in enumerate(items):
            with open(f"storage/datasets/default/{i:09d}.json", "w", encoding="utf-8") as f:
                json.dump(it, f, ensure_ascii=False, indent=2)


def log(msg):
    print(f"{datetime.now(timezone.utc).isoformat()} {msg}", flush=True)


# --- scraper ---------------------------------------------------------------

BASE = "https://www.workatastartup.com"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9",
}

LISTING_PATHS = ["/jobs/l/marketing"]

INCLUDE = [
    "head of marketing",
    "marketing manager", "manager, marketing", "manager - marketing",
    "marketing lead", "lead, marketing", "marketing team lead",
    "marketing specialist", "marketing strategist",
    "marketing associate", "marketing coordinator", "marketing generalist",
    "demand generation", "demand gen", "demandgen",
    "growth manager", "growth marketing", "growth marketer", "growth lead",
    "paid media", "paid ads", "paid acquisition", "paid social", "paid search",
    "performance marketing", "performance marketer",
    "content marketing", "content marketer", "content lead",
    "product marketing manager", "product marketing lead", "pmm",
    "lifecycle marketing", "email marketing", "crm marketing",
    "brand marketing manager", "brand marketing lead", "brand manager",
    "field marketing", "events marketing", "community marketing",
    "marketing operations", "marketing ops", "revenue marketing",
    "seo manager", "seo lead", "seo specialist", "seo strategist",
    "social media manager", "social media lead",
    "digital marketing manager", "digital marketing lead", "digital marketer",
    "ai marketing", "marketing ai", "ai marketer",
    "founding marketer", "founding marketing", "first marketing hire",
    "marketing", "marketer",  # broad catch, still gated by the exclude list
]

EXCLUDE_BASE = [
    "president", "vice president", " vp ", "vp,", "vp of", "vp-", "svp", "evp",
    "chief", "cmo", "c-level", "c level",
    "intern", "internship",
]


def title_matches(title: str, exclude: list) -> bool:
    t = f" {title.lower().strip()} "
    if any(x in t for x in exclude):
        return False
    return any(x in t for x in INCLUDE)


def fetch(url: str, tries: int = 3) -> str:
    last = None
    for n in range(tries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=25) as r:
                return r.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as e:
            if e.code in (404, 410):
                raise
            last = e
            time.sleep(2 * (n + 1))
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (n + 1))
    raise last


def extract_props(html: str) -> dict:
    blobs = re.findall(r"\{&quot;[^<]{200,}\}", html)
    if not blobs:
        return {}
    try:
        return json.loads(html_mod.unescape(max(blobs, key=len))).get("props", {})
    except Exception:  # noqa: BLE001
        return {}


def strip_html(h: str) -> str:
    if not h:
        return ""
    text = re.sub(r"<br\s*/?>", "\n", h)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", html_mod.unescape(text)).strip()


def parse_ts(val):
    if not val:
        return None
    if isinstance(val, (int, float)):
        return datetime.fromtimestamp(val, tz=timezone.utc)
    for fmt in ("%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%d"):
        try:
            dt = datetime.strptime(val, fmt)
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except (ValueError, TypeError):
            continue
    return None


def sweep_listings(max_pages: int):
    seen = {}
    order = 0
    for path in LISTING_PATHS:
        for page in range(1, max_pages + 1):
            url = f"{BASE}{path}?page={page}" if page > 1 else f"{BASE}{path}"
            try:
                jobs = extract_props(fetch(url)).get("jobs", [])
            except Exception as e:  # noqa: BLE001
                log(f"WARN listing {path} p{page}: {e}")
                break
            if not jobs:
                break
            for j in jobs:
                if j["id"] not in seen:
                    j["_order"] = order
                    order += 1
                    seen[j["id"]] = j
            if len(jobs) < 20:
                break
            time.sleep(1)
    return list(seen.values())


def get_job_detail(job_id):
    try:
        props = extract_props(fetch(f"{BASE}/jobs/{job_id}"))
        return props.get("job", {}) or {}, props.get("company", {}) or {}
    except Exception as e:  # noqa: BLE001
        log(f"WARN detail {job_id}: {e}")
        return {}, {}


def get_company_detail(slug):
    try:
        return extract_props(fetch(f"{BASE}/companies/{slug}")).get("company", {}) or {}
    except Exception as e:  # noqa: BLE001
        log(f"WARN company {slug}: {e}")
        return {}


def founders_str(founders):
    if not founders:
        return "", "", ""
    names = " | ".join(f.get("name", "") for f in founders)
    bios = " | ".join((f.get("bio") or "") for f in founders)
    links = " | ".join((f.get("linkedin") or "") for f in founders)
    return names, bios, links


def build_rows(inp: dict):
    within = int(inp.get("activeWithinDays") or 30)
    strict = bool(inp.get("strictRecency") or False)
    max_pages = int(inp.get("maxPages") or 3)
    fetch_detail = inp.get("fetchDetail")
    fetch_detail = True if fetch_detail is None else bool(fetch_detail)
    include_director = bool(inp.get("includeDirector") or False)
    limit = inp.get("limit")

    exclude = list(EXCLUDE_BASE)
    if not include_director:
        exclude.append("director")

    now = datetime.now(timezone.utc)

    log(f"Sweeping marketing listings (max {max_pages} pages)...")
    listings = sweep_listings(max_pages)
    log(f"{len(listings)} unique jobs found")

    matched = [j for j in listings if title_matches(j.get("title", ""), exclude)]
    matched.sort(key=lambda j: j.get("_order", 1e9))
    log(f"{len(matched)} match target marketing titles")

    kept = []
    for j in matched:
        dt = parse_ts(j.get("companyLastActiveAt"))
        if dt is None:
            if not strict:
                kept.append((j, None))
        elif (now - dt).days <= within:
            kept.append((j, (now - dt).days))
    log(f"{len(kept)} within recency window")

    if limit:
        kept = kept[: int(limit)]

    rows = []
    for i, (listing, age) in enumerate(kept, 1):
        jid = listing["id"]
        title = listing.get("title", "")
        slug = listing.get("companySlug", "")
        log(f"[{i}/{len(kept)}] {title} @ {listing.get('companyName')}")

        detail, co_from_job, company = {}, {}, {}
        if fetch_detail:
            detail, co_from_job = get_job_detail(jid)
            time.sleep(0.8)
            company = get_company_detail(slug) if slug else co_from_job
            time.sleep(0.8)

        fn, fb, fl = founders_str(company.get("founders", []))
        last_active = parse_ts(listing.get("companyLastActiveAt"))

        rows.append({
            "job_title": title.strip(),
            "seniority_flag": "mid-level",
            "company_name": listing.get("companyName", ""),
            "company_batch": listing.get("companyBatch", "") or company.get("batch", ""),
            "company_website": company.get("url", "") or co_from_job.get("url", ""),
            "location": listing.get("location", "") or detail.get("location", ""),
            "job_type": listing.get("jobType", ""),
            "salary": listing.get("salary", "") or detail.get("salaryRange", ""),
            "equity": detail.get("equityRange", ""),
            "min_experience": detail.get("minExperience", ""),
            "skills": ", ".join(detail.get("skills", []) or []),
            "company_one_liner": listing.get("companyOneLiner", "") or company.get("description", ""),
            "company_size": company.get("teamSize", ""),
            "company_industry": company.get("industry", ""),
            "company_last_active": last_active.strftime("%Y-%m-%d") if last_active else "",
            "days_since_active": age if age is not None else "",
            "job_description": strip_html(detail.get("descriptionHtml", ""))[:1200],
            "founder_names": fn,
            "founder_bios": fb,
            "founder_linkedins": fl,
            "apply_url": listing.get("applyUrl", ""),
            "job_url": f"{BASE}/jobs/{jid}",
            "company_url": f"{BASE}/companies/{slug}" if slug else "",
            "scraped_at": now.strftime("%Y-%m-%d"),
        })
    return rows


def main():
    log(f"env: api={API} dataset={DATASET_ID or '(none)'} kv={KV_STORE_ID or '(none)'} "
        f"token={'set' if TOKEN else '(none)'}")
    if not DATASET_ID:
        log("env keys seen: " + ", ".join(sorted(
            k for k in os.environ if k.startswith(("ACTOR_", "APIFY_")))))
    inp = get_input()
    log(f"Input: {json.dumps(inp)}")
    rows = build_rows(inp)
    if not rows:
        log("No jobs matched. Try a higher maxPages or wider activeWithinDays.")
    push_data(rows)
    log(f"Pushed {len(rows)} marketing jobs to the dataset.")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        log(f"FATAL: {e}")
        raise
