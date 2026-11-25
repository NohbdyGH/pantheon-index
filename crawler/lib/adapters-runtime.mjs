import { get } from "./pathlang.mjs";
import { makeRecord, RecordError, KINDS, FORMATS } from "./record.mjs";
import { readRow } from "./adapter-fields.mjs";

const REQUIRED_MAP = ["nid", "n", "o"];

// The fields the live-only sources use (POST, fixed headers, paging, pinned hosts, field clean-up). An adapter that
// declares none of them is checked exactly as before. Hosts are the whole allowlist: the search url, every link a row
// can map (cover, payload, origin) and the image base must sit on one of them.
const HOST = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
const HEADER_NAME = /^[A-Za-z][A-Za-z0-9-]{0,39}$/;
const FORBIDDEN_HEADERS = ["cookie", "host", "origin", "referer", "content-length", "transfer-encoding", "connection", "user-agent"];
function hostOf(u) { try { return new URL(u).hostname; } catch { return null; } }
// The host a map value or base will request: its literal prefix. A value that starts with a field gives no host.
function prefixHost(expr) { const m = /^https?:\/\/([^/{?#]+)/.exec(String(expr)); return m ? m[1].toLowerCase() : null; }
function checkLiveFields(a, s, errors) {
  const hasHosts = Array.isArray(a.hosts);
  if (a.hosts !== undefined && (!hasHosts || !a.hosts.length || !a.hosts.every(h => typeof h === "string" && HOST.test(h)))) errors.push("hosts");
  const method = s.method === undefined ? "GET" : s.method;
  if (!["GET", "POST"].includes(method)) errors.push("search.method");
  const hasHeaders = s.headers !== undefined;
  if (hasHeaders) {
    const h = s.headers; const names = h && typeof h === "object" && !Array.isArray(h) ? Object.keys(h) : null;
    if (!names || names.length > 10 || !names.every(n => HEADER_NAME.test(n) && !FORBIDDEN_HEADERS.includes(n.toLowerCase()) && typeof h[n] === "string" && h[n].length <= 500 && !/[\r\n]/.test(h[n]))) errors.push("search.headers");
  }
  if ((method === "POST" || hasHeaders) && !hasHosts) errors.push("hosts.required");
  if (s.bodyFixed !== undefined && !(s.bodyFixed && typeof s.bodyFixed === "object" && !Array.isArray(s.bodyFixed))) errors.push("search.bodyFixed");
  if (s.bodyFields !== undefined && !(s.bodyFields && typeof s.bodyFields === "object" && !Array.isArray(s.bodyFields) && Object.values(s.bodyFields).every(v => typeof v === "string" && v))) errors.push("search.bodyFields");
  if (method === "POST" && a.crawl) errors.push("crawl.post");
  if (s.paging !== undefined) {
    const p = s.paging;
    if (!p || typeof p !== "object" || !["page", "offset"].includes(p.mode) || !Number.isInteger(p.size) || p.size < 1 || p.size > 100 || (p.start !== undefined && !(Number.isInteger(p.start) && p.start >= 0))) errors.push("search.paging");
  }
  if (s.stripHtml !== undefined && !(Array.isArray(s.stripHtml) && s.stripHtml.every(f => ["n", "b"].includes(f)))) errors.push("search.stripHtml");
  for (const k of ["flattenCategories", "nsfwFalseOnly"]) if (s[k] !== undefined && typeof s[k] !== "boolean") errors.push("search." + k);
  if (s.nsfwIncludes !== undefined && (typeof s.nsfwIncludes !== "string" || !s.nsfwIncludes)) errors.push("search.nsfwIncludes");
  if (s.maxQuery !== undefined && !(Number.isInteger(s.maxQuery) && s.maxQuery >= 1 && s.maxQuery <= 200)) errors.push("search.maxQuery");
  if (hasHosts && a.hosts.length) {
    const pinned = a.hosts.map(h => String(h).toLowerCase());
    const sh = hostOf(s.url); if (!sh || !pinned.includes(sh)) errors.push("hosts.search");
    for (const [k, expr] of Object.entries(s.map && typeof s.map === "object" ? s.map : {})) {
      if (!["c", "pu", "o"].includes(k) || typeof expr !== "string") continue;
      if (/^https?:\/\//.test(expr)) { const ph = prefixHost(expr); if (!ph || !pinned.includes(ph)) errors.push(`map.${k}.host`); }
      else if (expr.includes("{")) errors.push(`map.${k}.host`);
    }
    if (a.imageBase !== undefined) { const ph = prefixHost(a.imageBase); if (!ph || !pinned.includes(ph)) errors.push("imageBase.host"); }
  }
}
export function validateAdapter(a) {
  const errors = [];
  if (!a || typeof a !== "object") return { ok: false, errors: ["not an object"] };
  if (!/^[a-z0-9-]{1,40}$/.test(a.id || "")) errors.push("id");
  if (typeof a.label !== "string") errors.push("label");
  if (!Array.isArray(a.kinds) || !a.kinds.length || !a.kinds.every(k => KINDS.includes(k))) errors.push("kinds");
  if (!["live", "candidate", "probed", "adapted", "blocked", "dead"].includes(a.status)) errors.push("status");
  if (!["plain", "super", "crawler"].includes(a.transport)) errors.push("transport");
  if (!a.caps || !["live", "index"].includes(a.caps.s)) errors.push("caps");
  const s = a.search;
  if (!s || typeof s !== "object") errors.push("search");
  else {
    if (!/^https:\/\//.test(s.url || "")) errors.push("search.url");
    if (!s.params || typeof s.params !== "object") errors.push("search.params");
    if (!Array.isArray(s.controls)) errors.push("search.controls");
    if (typeof s.items !== "string") errors.push("search.items");
    if (!s.map || typeof s.map !== "object") errors.push("search.map");
    else for (const k of REQUIRED_MAP) if (typeof s.map[k] !== "string") errors.push(`map.${k}`);
  }
  if (a.detail && a.detail.format && !FORMATS.includes(a.detail.format)) errors.push("detail.format");
  // A gallery is optional -- most sources publish one picture per item -- but a broken one would
  // ship a URL that fetches nothing, so it is checked here rather than discovered in a browser.
  if (a.gallery) {
    if (!/^https:\/\//.test(a.gallery.url || "")) errors.push("gallery.url");
    if (String(a.gallery.url || "").indexOf("{nid}") === -1) errors.push("gallery.url.nid");
    if (typeof a.gallery.items !== "string") errors.push("gallery.items");
    if (!a.gallery.map || typeof a.gallery.map.u !== "string") errors.push("gallery.map.u");
  }
  if (a.crawl && (!Array.isArray(a.crawl.passes) || !Number.isFinite(a.crawl.pages))) errors.push("crawl");
  if (s && typeof s === "object") checkLiveFields(a, s, errors);
  return { ok: errors.length === 0, errors };
}

export function buildSearchUrl(a, params = {}) {
  const u = new URL(a.search.url);
  for (const [k, v] of Object.entries(a.search.fixed || {})) u.searchParams.set(k, String(v));
  for (const control of a.search.controls) {
    if (!(control in params) || params[control] === undefined || params[control] === "") continue;
    const target = a.search.params[control]; if (!target) continue;
    let v = params[control];
    if (control === "sort" && a.search.sorts && a.search.sorts[v] !== undefined) v = a.search.sorts[v];
    if (Array.isArray(v)) v = v.join(",");
    u.searchParams.set(target, String(v));
  }
  return u.toString();
}

// A declarative adapter can map the source's own date into `ts` (seconds, milliseconds or an ISO
// string — all three appear across these APIs). Without one every record from a nightly crawl shares
// the crawl's timestamp, and "just added" is the same list as everything else.
export function sourceDate(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return Math.floor(v > 1e11 ? v / 1000 : v);
  const n = Number(v);
  if (Number.isFinite(n) && n > 1e8) return Math.floor(n > 1e11 ? n / 1000 : n);
  const parsed = Date.parse(String(v));
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}
export function itemsToRecords(a, items, { ts }) {
  const records = []; let skipped = 0;
  for (const raw of Array.isArray(items) ? items : []) {
    const { m, tags, nsfw, c, pu, o, cr } = readRow(a, raw);
    try {
      records.push(makeRecord({
        ts: sourceDate(m.ts) || ts,
        src: a.id, k: a.kinds[0], nid: m.nid, n: m.n, b: m.b, t: tags, c, nsfw, o, cr,
        p: pu && a.detail ? { tr: a.detail.transport || a.transport, u: pu, f: a.detail.format } : null,
        caps: { s: a.caps.s, i: Boolean(pu && a.detail), o: true },
        tok: Number(m.tok) || null,
      }));
    } catch (e) { if (e instanceof RecordError) skipped++; else throw e; }
  }
  return { records, skipped };
}

export async function crawlDeclarative(a, fetcher, { ts, maxPages = a.crawl?.pages ?? 1, log = () => {}, deadline = Infinity }) {
  const byId = new Map(); const errors = []; let pagesFetched = 0;
  // A POST source, or one that sends fixed headers, is live search only: it is asked at a visitor's request and never walked.
  if (String(a.search?.method || "GET").toUpperCase() !== "GET" || a.search?.headers) return { records: [], errors: [{ pass: {}, message: `${a.id} is live search only and is not crawled` }], pagesFetched: 0 };
  const passes = a.crawl?.passes?.length ? a.crawl.passes : [{}];
  const start = a.crawl?.pageStart ?? 1;
  for (const pass of passes) {
    try {
      for (let page = start; page < start + maxPages; page++) {
        if (Date.now() > deadline) { log(`${a.id}: past the crawl deadline, stopping with ${byId.size} records`); break; }
        const url = buildSearchUrl({ ...a, search: { ...a.search, fixed: { ...(a.search.fixed || {}), ...(pass.first ? { first: pass.first } : {}) } } }, { ...pass, page });
        const { body } = await fetcher.json(url); pagesFetched++;
        const items = get(body, a.search.items);
        if (!Array.isArray(items) || items.length === 0) break;
        const { records } = itemsToRecords(a, items, { ts });
        for (const r of records) if (!byId.has(r.id)) byId.set(r.id, r);
        log(`${a.id}: pass ${JSON.stringify(pass)} page ${page} → ${records.length}`);
      }
    } catch (e) { errors.push({ pass, message: String(e && e.message || e) }); }
  }
  return { records: [...byId.values()], errors, pagesFetched };
}
