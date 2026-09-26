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

**Privacy:** the site has no analytics, no trackers, no cookies and no ads, and it makes **no requests to any other website**. The IBM Plex Sans Thai font is hosted here too. Two things are saved on the device: the language choice (in `localStorage`) and the service worker's offline copy of the page.

## Updating the information

See **[UPDATING.md](UPDATING.md)**. It is a step-by-step guide for volunteers editing `flood.json` directly on github.com, with no programming needed.

Every change is checked automatically. If `flood.json` has a mistake (a broken phone number, a bad date, a missing comma), the check fails, **the live site is not changed**, and the error is shown in the Actions tab.

## How it works

```
index.html                 page markup, safety tips, Open Graph tags, embedded fallback copy of the data
style.css                  styles (light + dark mode)
app.js                     renders the data, language toggle, "updated X hours ago"
data/flood.json            ← all content that changes; the only file volunteers edit
scripts/validate.mjs       checks flood.json (required fields, phone numbers, timestamps)
scripts/embed-fallback.mjs copies flood.json into index.html at deploy time
sw.js                      service worker: offline support after the first visit
fonts/                     IBM Plex Sans Thai (Thai + Latin, weights 400/600/700, ~65 KB) and its licence, OFL.txt
scripts/sw-disable.js      emergency replacement for sw.js that removes the service worker
scripts/test-sw.mjs        end-to-end test of offline mode and both off-switches (headless Chrome)
.github/workflows/deploy.yml  check → embed fallback → publish to GitHub Pages
```

- **No framework, no build tools, no npm packages.** The scripts only need Node.js 20 or later (CI uses 22).
- **Fallback:** `index.html` contains a copy of the data. The page draws that copy instantly, then loads `data/flood.json`. If the load fails, the page keeps the copy and shows a "may be out of date" notice.
- **Offline:** after the first visit, `sw.js` keeps a copy of the page and data on the phone. It always tries the network first and falls back to the saved copy if there is no signal or the network takes more than 4 seconds. Saved copies show the same "may be out of date" notice. Visitors who have signal always get the newest data, so there is no cache version to bump when `flood.json` changes.
- **Deploy:** on every push to `main`, GitHub Actions runs `validate.mjs`. If that passes, it embeds the fallback and publishes. Pull requests are checked but not published.

## Emergency: turn off the service worker

If the service worker ever causes problems (for example, people keep seeing an old page), turn it off. Use **either** of these:

1. **Quickest, no code:** in `data/flood.json`, add `"serviceWorker": false,` on the line after the first `{`, then commit. Once visitors load the page with signal, it removes the worker and its saved copies.
2. **Stronger (works even if app.js is broken):** open `scripts/sw-disable.js` on github.com, copy all of it, then edit `sw.js`, replace its whole content with what you copied, and commit. Each visitor's browser picks up the new `sw.js` on its next visit: it deletes this site's saved copies, unregisters itself and reloads the page from the network.

To turn it back on, remove the flag, or restore `sw.js` from its **History**. Either off-switch only touches this site's own caches (names starting `flood-hub-`), never other sites on `phantawat.github.io`.

## Setup (one time)

1. Push this folder to a GitHub repository, using `main` as the default branch.
2. Go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. Push any commit, or run the workflow from the **Actions** tab. The site appears at <https://phantawat.github.io/bangkok-flood-hub/>.
4. If the URL ever changes (e.g. a custom domain), update `og:url` in `index.html`.
5. Optional but recommended: in **Settings → Branches**, protect `main` so changes go through a pull request. The check then runs before anything is merged.

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

The page must be served over HTTP. When opened as a `file://`, the browser blocks loading `flood.json` and the page shows the fallback notice.

## Adding a new file to the site

The deploy step only publishes the files listed in `.github/workflows/deploy.yml` under **Collect site files**. If you add a new file the page needs (an image, a font, a service worker), add it there too.

## Licence and contact

Content is compiled from the public sources listed above. Please report mistakes by opening an issue.
