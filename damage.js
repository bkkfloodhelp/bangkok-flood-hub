(function () {
"use strict";

// damage.html enhancements. The page is complete without this file: checkboxes still tick,
// and the browser's own Print works. This only adds:
// - remembering ticks on this device (localStorage; a per-viewer convenience — if storage is
//   blocked or full, ticking works exactly the same, it just isn't remembered);
// - the "Clear all ticks" button (with a confirmation);
// - the "Print / save as PDF" button.

const KEY = "damage-checklist";

let saved = {};
try {
  const parsed = JSON.parse(localStorage.getItem(KEY) || "{}");
  if (parsed && typeof parsed === "object") saved = parsed;
} catch (e) { /* storage unavailable or corrupt: start empty */ }

document.querySelectorAll('input[type="checkbox"][data-save]').forEach(box => {
  if (saved[box.id] === true) box.checked = true;
  box.addEventListener("change", () => {
    if (box.checked) saved[box.id] = true;
    else delete saved[box.id];
    try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) { /* not remembered, still works */ }
  });
});

// "Clear all ticks": asks first, then unticks every box and forgets them on this device.
const clear = document.getElementById("clear-ticks");
if (clear) clear.addEventListener("click", () => {
  const question = document.documentElement.lang === "en" ? "Clear all ticks?" : "ล้างเครื่องหมายทั้งหมดใช่ไหม";
  if (!window.confirm(question)) return;
  document.querySelectorAll('input[type="checkbox"][data-save]').forEach(box => { box.checked = false; });
  saved = {};
  try { localStorage.removeItem(KEY); } catch (e) { /* nothing was stored */ }
});

const print = document.getElementById("print");
if (print) print.addEventListener("click", () => window.print());

document.documentElement.dataset.enhanced = "damage"; // lets the tests know setup has run
})();
