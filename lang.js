/* Thai/English toggle shared by every page (index.html, damage.html).
   Both languages are always in the HTML (data-th / data-en); switching just sets <html lang>,
   which CSS uses to show one of them. The inline script in <head> applies the saved language
   before first paint; this file wires up the ไทย / EN buttons and keeps language marking right.

   Exposes window.FloodLang = { lang, setLang(l), onChange(fn), markThai() }. */
(function () {
"use strict";

const root = document.documentElement;
const THAI = /[฀-๿]/;
const listeners = [];
let lang = root.lang === "en" ? "en" : "th";

// Every piece of text should be marked with its real language (for screen readers).
// English is always marked lang="en" in the HTML; Thai sits under <html lang="th">. When the page
// is switched to English, mark any Thai that is still visible (e.g. the "ไทย" button, a source
// written in Thai) as lang="th"; switching back removes those marks.
function markThai() {
  document.querySelectorAll("[data-auto-lang]").forEach(el => { el.removeAttribute("lang"); el.removeAttribute("data-auto-lang"); });
  if (lang !== "en") return;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const found = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!THAI.test(n.nodeValue) || el.closest("[data-th], script, style")) continue; // data-th is hidden in English
    const marked = el.closest("[lang]");
    if (marked && marked !== root && marked.lang === "th") continue;
    found.push(n);
  }
  found.forEach(n => {
    const el = n.parentElement;
    if (el.childNodes.length === 1) { el.lang = "th"; el.dataset.autoLang = ""; return; }
    const span = document.createElement("span"); // Thai mixed with other content: wrap just this text
    span.lang = "th"; span.dataset.autoLang = "";
    el.replaceChild(span, n);
    span.appendChild(n);
  });
}

function setLang(l) {
  lang = l;
  root.lang = l; // CSS shows the matching data-th / data-en text
  try { localStorage.setItem("lang", l); } catch (e) {}
  document.querySelectorAll(".lang button").forEach(b => b.setAttribute("aria-pressed", b.dataset.set === l));
  listeners.forEach(fn => fn(l));
  markThai();
}

document.querySelectorAll(".lang button").forEach(b => b.addEventListener("click", () => setLang(b.dataset.set)));
document.querySelectorAll(".lang button").forEach(b => b.setAttribute("aria-pressed", b.dataset.set === lang));

window.FloodLang = {
  get lang() { return lang; },
  setLang: setLang,
  onChange: fn => { listeners.push(fn); },
  markThai: markThai,
};
markThai();
})();
