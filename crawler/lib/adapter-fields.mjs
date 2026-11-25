// What a declarative adapter does to one row of a source's answer before it becomes a record. The crawler and the
// plugin both call readRow, so a result looks the same wherever it was read (the shared-equality test keeps the two
// copies identical). No evaluation, no network: data in, data out.
import { get, mapFields } from "./pathlang.mjs";
import { isNsfwTags } from "./normalise.mjs";

const NAMED = { quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", amp: "&" };
// HTML to plain text: scripts and styles go, block tags become line breaks, any other tag a space, entities are decoded.
export function stripHtmlToText(html) {
  let s = String(html == null ? "" : html);
  s = s.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, " ");
  s = s.replace(/<\s*\/?\s*(p|div|br|li|ul|ol|h[1-6]|tr|blockquote|pre|hr)\b[^>]*>/gi, "\n");
  s = s.replace(/<[^>]*>/g, " ");
  s = s.replace(/&#(\d{1,7});/g, (m, n) => { const c = Number(n); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : " "; });
  s = s.replace(/&(quot|apos|lt|gt|nbsp|amp);/g, (m, k) => NAMED[k]);
  return s.split("\n").map(l => l.replace(/[ \t ]+/g, " ").trim()).filter(Boolean).join("\n");
}

// A categories object ({group: [tags]}) as a flat list of tags. The rating is a safety signal and never a topic, the
// features_ groups describe what a card carries rather than what it is about, and only text counts: strings and arrays
// of strings. At most 40.
export function flattenCategoryTags(obj) {
  const out = [];
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return out;
  for (const [key, val] of Object.entries(obj)) {
    const k = key.toLowerCase();
    if (k === "rating" || k.startsWith("features_")) continue;
    const list = Array.isArray(val) ? val : [val];
    for (const v of list) {
      if (typeof v !== "string") continue;
      const t = v.trim();
      if (t && !out.includes(t)) out.push(t);
      if (out.length >= 40) return out;
    }
  }
  return out;
}

// Tag ids as display names, through a table the adapter pins ({"1": "Male"}). An id the table does not know is skipped,
// never shown raw; a name the source already sends as text is not an id and is skipped too.
export function tagIdsToNames(table, ids) {
  const out = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    if (typeof id !== "number" && typeof id !== "string") continue;
    const k = String(id).trim();
    const name = Object.prototype.hasOwnProperty.call(table, k) ? table[k] : undefined;
    if (typeof name === "string" && name && !out.includes(name)) out.push(name);
  }
  return out;
}

// Does a raw value say adult? true, 1, and the words a source uses for it; an array counts when it holds one.
const ADULT_WORDS = ["true", "nsfw", "explicit", "adult", "erotic"];
export function valueSignalsNsfw(v) {
  if (Array.isArray(v)) return v.some(x => typeof x === "string" && ADULT_WORDS.includes(x.trim().toLowerCase()));
  if (v === true || v === 1) return true;
  return typeof v === "string" && ADULT_WORDS.includes(v.trim().toLowerCase());
}

// Is this URL on one of the hosts the adapter pins? An adapter with no hosts pins nothing.
export function hostPinned(a, url) {
  if (!Array.isArray(a.hosts) || !a.hosts.length) return true;
  try { return a.hosts.map(h => String(h).toLowerCase()).includes(new URL(String(url)).hostname.toLowerCase()); } catch { return false; }
}

// One row of the answer, read the way the adapter says. Returns the mapped fields plus what the record needs decided:
// tags, the adult flag, the cover and the payload link (a link off the pinned hosts is dropped, a bad origin makes
// makeRecord refuse the row).
export function readRow(a, raw) {
  const s = a.search || {};
  let m = mapFields(s.map, raw);
  if (s.flattenCategories && m.t && typeof m.t === "object" && !Array.isArray(m.t)) m = { ...m, t: flattenCategoryTags(m.t) };
  if (a.tagNames && typeof a.tagNames === "object" && Array.isArray(m.t)) m = { ...m, t: tagIdsToNames(a.tagNames, m.t) };
  for (const f of Array.isArray(s.stripHtml) ? s.stripHtml : []) if (typeof m[f] === "string") m = { ...m, [f]: stripHtmlToText(m[f]) };
  const tags = Array.isArray(m.t) ? m.t : typeof m.t === "string" ? m.t.split(",") : [];
  let nsfw = m.nsfw === true || m.nsfw === "true" || m.nsfw === 1 || isNsfwTags(tags) || valueSignalsNsfw(m.nsfw);
  if (!nsfw && typeof s.nsfwIncludes === "string" && s.nsfwIncludes) nsfw = valueSignalsNsfw(get(raw, s.nsfwIncludes));
  // Some APIs return a bare filename for the cover and expect their own CDN prefix; an adapter declares that with
  // imageBase, and an absolute URL is left alone.
  const cover = m.c ? String(m.c) : null;
  let c = cover && a.imageBase && !/^https?:\/\//i.test(cover) ? a.imageBase + cover.replace(/^\/+/, "") : cover;
  let pu = m.pu ? String(m.pu) : null;
  let o = m.o;
  if (!hostPinned(a, c)) c = null;
  if (!hostPinned(a, pu)) pu = null;
  if (typeof o === "string" && !hostPinned(a, o)) o = null;
  return { m, tags, nsfw, c: c || null, pu, o, cr: typeof m.cr === "string" ? m.cr : null };
}
