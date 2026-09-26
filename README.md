# Bangkok Flood Help · ข้อมูลช่วยเหลือน้ำท่วม กรุงเทพฯ

A small, fast, bilingual (Thai/English) information page for the September 2026 Bangkok floods. It lists emergency hotlines, temporary shelters, roads to avoid, and safety tips. It is built to load quickly on phones with a weak signal.

> **Unofficial, volunteer-run.** This site is not affiliated with the Bangkok Metropolitan Administration (BMA/กทม.), DDPM (ปภ.) or any government agency. Information is compiled by hand from public news reports and may be delayed or out of date. **In an emergency call 1669 (medical) or 1555 (BMA) directly.**
>
> **เว็บไซต์นี้จัดทำโดยอาสาสมัคร ไม่ใช่เว็บไซต์ทางการ** ข้อมูลรวบรวมจากข่าวสาธารณะและอาจล่าช้า เหตุฉุกเฉินโทร 1669 หรือ 1555 ทันที

## Where the data comes from

All content lives in [`data/flood.json`](data/flood.json). Volunteers enter it **by hand** from public sources; nothing is scraped automatically. Each shelter and road entry records its own `updated` time and `source`. The page shows how old each item is, and it warns visitors when road information is more than 6 hours old.

The current sources are listed in the `sources` section of `flood.json` and in the page footer:

- Thai PBS World (shelters)
- Khaosod English (roads, shelter capacity, status)
- The Nation (hotlines)

**Privacy:** the site has no analytics, no trackers, no cookies and no ads, and it makes **no requests to any other website**. The IBM Plex Sans Thai font is hosted here too. Things saved on the device, and never sent anywhere: the language choice and the damage page's ticked boxes (in `localStorage`), and the service worker's offline copy of the site.

## Updating the information

See **[UPDATING.md](UPDATING.md)**. It is a step-by-step guide for volunteers editing `flood.json` directly on github.com, with no programming needed.

Every change is checked automatically. If `flood.json` has a mistake (a broken phone number, a bad date, a missing comma), the check fails, **the live site is not changed**, and the error is shown in the Actions tab.

## How it works

```
index.html                 page markup and safety tips; data sections are filled in at deploy time
damage.html                "บันทึกความเสียหาย / Damage record": how to collect flood-damage evidence, checklists, BMA assistance amounts
style.css                  styles (light + dark mode)
render.js                  turns flood.json into the page's HTML (used at deploy time and in the browser)
lang.js                    Thai/English toggle and language marking, shared by both pages
app.js                     enhances the hub: "X hours ago", stale warning, district filter
damage.js                  damage page: remembers ticked boxes on this device (localStorage), print button
data/flood.json            ← all content that changes; the only file volunteers edit
scripts/validate.mjs       checks flood.json (required fields, phone numbers, timestamps)
scripts/embed-fallback.mjs builds index.html (pre-renders the data, embeds a fallback copy) and damage.html (assistance table)
sw.js                      service worker: offline support after the first visit
fonts/                     IBM Plex Sans Thai (Thai + Latin, weights 400/600/700, ~65 KB) and its licence, OFL.txt
scripts/sw-disable.js      emergency replacement for sw.js that removes the service worker
scripts/test-sw.mjs        end-to-end test of offline mode and both off-switches (headless Chrome)
scripts/test-a11y.mjs      contrast, keyboard, 360px layout and tel: link checks, with screenshots
scripts/test-nojs.mjs      checks every phone number works with JavaScript disabled
scripts/lib/               shared Chrome and test-server helpers for the scripts above
scripts/make-og-image.mjs  regenerates og-image.png, the LINE/Facebook link preview picture
scripts/lib/samples.mjs    sample tools / live-roads links the tests use until flood.json has real ones
og-image.png               1200×630 preview picture (generated; don't edit by hand)
icon.svg                   favicon: water drop in the site's blue (lighter in dark mode)
icons.svg                  section icons (phone, shelter, road, safety, camera, warning), copied into each page at build time
img/evidence-*.svg         the three line drawings on damage.html (water line, room then close-ups, appliance label)
favicon-32.png, apple-touch-icon.png  PNG icons made from icon.svg by scripts/make-icons.mjs
.github/workflows/deploy.yml  check → embed fallback → publish to GitHub Pages
.github/workflows/tests.yml   runs both browser tests when code changes (does not block deploys)
```

- **No framework, no build tools, no npm packages.** The scripts only need Node.js 20 or later (CI uses 22).
- **Works without JavaScript:** at deploy time, `scripts/embed-fallback.mjs` uses `render.js` to write the status, every hotline, every shelter, the roads and the sources into `index.html`, in Thai and English. Every phone number is a plain `tel:` link, so the page is useful even if scripts are blocked, fail to load, or the phone is very old. Without JavaScript nobody can switch language, so Thai and English are shown together. The build **fails (and nothing is deployed)** if any hotline or shelter number is missing from the page.
- **JavaScript enhances the page** instead of building it. It adds "updated X hours ago", the stale-roads warning, the district filter and the language toggle. If the live `data/flood.json` is newer than the built page, `app.js` re-renders the data sections with the same `render.js`.
- **Fallback:** `index.html` also contains a copy of the data. If loading `data/flood.json` fails, the page keeps what it has and shows a "may be out of date" notice.
- **Committed `index.html`:** the committed copy may lag behind `flood.json`, because only the deploy rebuilds it. Run `node scripts/embed-fallback.mjs` to refresh it for local preview.
- **Offline:** after the first visit, `sw.js` keeps a copy of the page and data on the phone. It always tries the network first and falls back to the saved copy if there is no signal or the network takes more than 4 seconds. Saved copies show the same "may be out of date" notice. Visitors who have signal always get the newest data, so there is no cache version to bump when `flood.json` changes.
- **Deploy:** on every push to `main`, GitHub Actions runs `validate.mjs`. If that passes, it embeds the fallback and publishes. Pull requests are checked but not published.

## Emergency: turn off the service worker

If the service worker ever causes problems (for example, people keep seeing an old page), turn it off. Use **either** of these:

1. **Quickest, no code:** in `data/flood.json`, add `"serviceWorker": false,` on the line after the first `{`, then commit. Once visitors load the page with signal, it removes the worker and its saved copies.
2. **Stronger (works even if app.js is broken):** open `scripts/sw-disable.js` on github.com, copy all of it, then edit `sw.js`, replace its whole content with what you copied, and commit. Each visitor's browser picks up the new `sw.js` on its next visit: it deletes this site's saved copies, unregisters itself and reloads the page from the network.

To turn it back on, remove the flag, or restore `sw.js` from its **History**. Either off-switch only touches this site's own caches (names starting `flood-hub-`), never other sites on the same `github.io` address.

## Setup (one time)

1. Push this folder to a GitHub repository, using `main` as the default branch.
2. Go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. Push any commit, or run the workflow from the **Actions** tab. The site appears at <https://bkkfloodhelp.github.io/bangkok-flood-hub/>.
4. If the URL ever changes (e.g. a custom domain), update `og:url` in `index.html`.
5. Optional but recommended: in **Settings → Branches**, protect `main` so changes go through a pull request. The check then runs before anything is merged.

## Automatic draft updates (optional, off by default)

`.github/workflows/draft-update.yml` can prepare data updates for volunteers. Every 3 hours it reads the news sources in [`scripts/draft-sources.json`](scripts/draft-sources.json), asks Claude (model `claude-sonnet-5`) for proposed changes, and opens a **draft pull request**. **It never publishes anything.** The site only changes when a person reviews the pull request and merges it.

**Every draft pull request must be reviewed by a person before merging.** Open each source link in the table, check that the change matches it, fix or delete anything wrong (especially Thai/English names the draft marks as "rendered"), then click **Ready for review**, approve and merge. If in doubt, close the pull request; nothing is lost.

What it may change: only `status`, `roadsNote`, `roads` and `shelters`. **Hotlines and assistance amounts are never changed.** The script enforces this and gives up if anything else would change. Every proposed change must quote its source word for word, and must have a publication time from the article itself. The script checks both, and drops changes that fail, listing them in the pull request.

**Schedule:** at 07:17, 10:17, 13:17, 16:17, 19:17, 22:17, 01:17 and 04:17 Bangkok time (UTC `17 */3 * * *`). GitHub can start scheduled runs late. It skips a run while an earlier draft pull request is still open, and opens no pull request when nothing changed.

### Turn it on

All of these are under the repository's **Settings**.

1. **Claude API key.** Use its own workspace, so it can have a spend limit (step 2).
   - In the [Claude Console](https://platform.claude.com/settings/workspaces), go to **Settings → Workspaces → Create workspace** (e.g. "bkk-flood-drafts").
   - Create an API key in that workspace.
   - In GitHub: **Secrets and variables → Actions → Secrets → New repository secret**, name `ANTHROPIC_API_KEY`.
2. **Monthly spend limit.** In the Claude Console, open that workspace's **Spend limits** tab, set a monthly cap (for example US$50), and add an alert at, say, 50%. When the cap is reached, API calls fail, the workflow run fails, and nothing is published. Spend limits can't be set on the Default Workspace, which is why the key gets its own workspace.
3. **TMD weather warnings (optional).** Register for free at [data.tmd.go.th](https://data.tmd.go.th) to get a user ID and a key.
   - Add the key as the secret `TMD_API_KEY`.
   - Add the user ID as the variable `TMD_API_UID` (**Variables** tab).
   - Without them, the TMD source is skipped, and each pull request says so.
4. **Allow pull requests:** **Actions → General → Workflow permissions →** tick **Allow GitHub Actions to create and approve pull requests**. The `bkkfloodhelp` organisation's Actions settings must allow it too.
5. **Switch it on:** **Secrets and variables → Actions → Variables → New repository variable**, name `AUTO_DRAFT`, value `on`.
6. **Try it:** **Actions → Draft data update (needs human review) → Run workflow**.

### Turn it off

- **Stop the runs:** set `AUTO_DRAFT` to `off` (or delete it). Each run then stops immediately without doing anything.
- **Stop scheduling it entirely:** **Actions → Draft data update (needs human review) → ⋯ → Disable workflow**. **Enable workflow** turns it back on.

### Require a review before anything reaches `main` (branch protection)

To make sure no change (from a draft or anyone else) is published without a second pair of eyes:

1. Go to **Settings → Rules → Rulesets → New ruleset → New branch ruleset**.
2. Set it up:
   - name: "main needs review"
   - Enforcement: **Active**
   - Target branches: **Include default branch**
3. Tick these rules:
   - **Restrict deletions**
   - **Block force pushes**
   - **Require a pull request before merging**, with **Required approvals: 1**
4. Optionally, under **Require status checks to pass**, add **Check flood.json / ตรวจสอบข้อมูล**.

> [!IMPORTANT]
> **This changes how volunteers update data.** With the rule on, nobody can commit straight to `main` any more, including the "Commit directly to the main branch" step in [UPDATING.md](UPDATING.md). Every edit becomes a pull request that someone else must approve. That's safer, but urgent fixes wait for a second person.
>
> If that's too slow during an emergency, add trusted maintainers to the ruleset's **Bypass list**. They can then still commit directly, while drafts and other contributors need approval.
>
> **You can't approve your own pull request.** Draft pull requests are authored by whoever owns the token that opened them (see below). If that's you, another maintainer must approve.

### Checks on draft pull requests, and `DRAFT_PR_TOKEN`

Before opening a pull request, the workflow runs the validator, the build (road count, phone links) and the no-JavaScript test on the draft, and opens nothing if they fail.

GitHub doesn't start the repository's usual checks on pull requests opened with the workflow's built-in token. To have them run too (and to satisfy a "require status checks" rule), add a **fine-grained personal access token** limited to this one repository:

1. On GitHub: your avatar → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Set up the token:
   - **Resource owner:** `bkkfloodhelp`. The organisation may need to approve the token under its **Settings → Personal access tokens**.
   - **Expiration:** 90 days or less.
   - **Repository access:** **Only select repositories →** `bangkok-flood-hub`.
   - **Permissions → Repository permissions:** **Contents: Read and write**, **Pull requests: Read and write**. Metadata: read-only is added automatically. Nothing else.
3. Save it as the repository secret `DRAFT_PR_TOKEN`.

Pull requests will then be authored by the token's owner. Ideally that's a separate bot account, so any maintainer (including you) can approve the drafts. Renew the token before it expires. An expired token makes draft runs fail when pushing the branch (nothing is published). Renew it, or delete the secret to go back to the built-in token.

### Cost

This is an **estimate, not yet measured**. Each run sends about 14 pages of article text to `claude-sonnet-5` ($2 / $10 per million input / output tokens). That's roughly US$0.10–0.25 a run, or $1–2 a day at 8 runs. Check the real figure on the workspace's usage page after the first runs. The spend limit from step 2 caps it regardless.

- **Different model:** set `DRAFT_MODEL` in the workflow's `env`.
- **Test without calling the API:** `node scripts/draft-update.mjs --mock-response <file> --dry-run`.

### Sources

Edit `scripts/draft-sources.json`. `{NAME}` in a URL is filled in from a secret or variable of that name. It is never shown in pull requests or logs, and a source whose secret is missing is skipped and flagged. Sources that can't be fetched are listed in each pull request. Currently, Khaosod and Khaosod English block automated requests (HTTP 403). TMD's website sends an incomplete security certificate, so TMD is read through its open-data feed (step 3).

## Old address

The site used to be at `https://phantawat.github.io/bangkok-flood-hub/`. That address is now served by the separate repository [Phantawat/bangkok-flood-hub](https://github.com/Phantawat/bangkok-flood-hub). Its pages send visitors to the matching page here, and its `sw.js` removes the old offline copy from phones that saved it. That repository is made by `node scripts/make-redirect-site.mjs <folder>` and tested by `node scripts/test-redirect.mjs`. Don't put site content there.

## Local preview

```sh
python3 -m http.server 8000     # then open http://localhost:8000
node scripts/validate.mjs       # check the data
```

**Service worker test** (run after changing `sw.js`, `app.js` or `scripts/sw-disable.js`):

```sh
node scripts/test-sw.mjs        # needs Node 22+ and Chrome; set CHROME_PATH if Chrome isn't found
```

It runs the site in headless Chrome on a temporary copy, so your files are not changed. It checks that the worker installs, that the page loads offline with the "may be out of date" notice, and that **both** emergency off-switches remove the worker and its caches. It takes about 20 seconds.

**Accessibility and layout test** (run after any change to the page, styles or scripts):

```sh
node scripts/test-a11y.mjs      # needs Node 22+ and Chrome
node scripts/test-nojs.mjs      # page with JavaScript disabled: every hotline and shelter tel: link present
```

It measures the page as rendered at 360px wide, in light and dark mode, in Thai and English. It also runs a "warnings" state with the "may be out of date" notice and the stale-roads warning switched on. It checks:
- every piece of visible text for colour contrast (WCAG AA: 4.5:1, or 3:1 for large text)
- that every button and link can be reached with the Tab key and shows a clear focus outline
- that the page never scrolls sideways
- that tap targets are at least 24×24px
- that every `tel:` link dials exactly the number it shows

Because it measures the page rather than a fixed list, new features are checked automatically. Screenshots of all 8 combinations are saved in `test-output/` (not committed) so you can look at them.

**On GitHub:** all three browser tests run automatically when code changes (see the **Actions** tab, "Site tests"), and the screenshots are attached to each run. They don't run for data-only or docs-only changes. A failure there does **not** stop a deploy, so urgent data updates are never blocked. Treat a red "Site tests" run as something to fix before the next code change.

**Link preview picture:** `og-image.png` shows the page title and the urgent hotlines, taken from `data/flood.json`. If you change those, regenerate the picture and commit it:

```sh
node scripts/make-og-image.mjs  # needs Node 22+ and Chrome
```

Facebook and LINE keep old previews for a long time. After changing the picture, paste the site URL into the [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/) and click **Scrape Again**.

The page must be served over HTTP. When opened as a `file://`, the browser blocks loading `flood.json` and the page shows the fallback notice.

## Adding a new file to the site

The deploy step only publishes the files listed in `.github/workflows/deploy.yml` under **Collect site files**. If you add a new file the page needs (an image, a font, a service worker), add it there too.

## Licence and contact

Content is compiled from the public sources listed above. Please report mistakes by opening an issue.
