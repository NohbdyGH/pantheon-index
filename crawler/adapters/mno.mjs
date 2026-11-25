// MNO RPG Engine community catalog (Perchance /mnoengine): user-published worlds as pointer records. The catalog's server
// only answers its own page, so Node cannot crawl it; the input is a snapshot exported in a browser (crawler/snapshots/mno/
// rec-*.json, arrays of full records). This adapter makes no network calls: it re-reads each snapshot record through
// makeRecord, validates the pointer fields strictly, and hands the crawl the result. Only metadata is held (title, blurb,
// tags, cover URL, author name, links); the world itself stays at p.u and is fetched by the hub on demand.
import fs from "node:fs/promises"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { makeRecord, RecordError } from "../lib/record.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SNAPSHOT_DIR = path.join(HERE, "..", "snapshots", "mno");
export const meta = {
  id: "mno", label: "MNO RPG Engine", kinds: ["scenario"], status: "live", transport: "crawler",
  caps: { s: "index", i: true, o: true }, originBase: "https://perchance.org/mnoengine",
};
const PAYLOAD = /^https:\/\/user\.uploads\.dev\/file\/[0-9a-f]{32}\.gz$/;
const COVER = /^https:\/\/user\.uploads\.dev\/[^\s]+$/;
const ORIGIN = meta.originBase + "#explore/";
const ID = /^mno:scenario:([^\s:]+)$/;
const label = (r, i, f) => `${f}[${i}] ${r && typeof r.id === "string" ? r.id : "?"}`;

function convert(r) {
  if (!r || typeof r !== "object" || Array.isArray(r)) throw new RecordError("shape", "not an object");
  const m = typeof r.id === "string" ? ID.exec(r.id) : null; if (!m) throw new RecordError("id", `bad id ${r.id}`);
  if (!r.p || typeof r.p.u !== "string" || !PAYLOAD.test(r.p.u)) throw new RecordError("url", `payload url not a user.uploads.dev .gz: ${r.p && r.p.u}`);
  if (r.c !== null && r.c !== undefined && !(typeof r.c === "string" && COVER.test(r.c))) throw new RecordError("url", `cover not https user.uploads.dev: ${r.c}`);
  if (typeof r.o !== "string" || !r.o.startsWith(ORIGIN) || r.o.length <= ORIGIN.length) throw new RecordError("url", `origin not ${ORIGIN}…: ${r.o}`);
  return { rec: makeRecord({ src: meta.id, k: "scenario", nid: m[1], n: r.n, b: r.b, t: r.t, c: r.c ?? null, nsfw: r.nsfw === true, o: r.o, p: { tr: "plain", u: r.p.u, f: "mno" }, caps: meta.caps, tok: null, ts: Number.isFinite(r.ts) && r.ts > 0 ? r.ts : undefined, cr: r.cr }), valid: Number.isFinite(r.ts) && r.ts > 0 };
}

export async function crawl(fetcher, { ts, log = () => {}, dir = SNAPSHOT_DIR } = {}) {
  const errors = []; const byId = new Map(); let files = [], seen = 0;
  try { files = (await fs.readdir(dir)).filter(f => /^rec-\d{3}\.json$/.test(f)).sort(); } catch (e) { if (e.code !== "ENOENT") errors.push({ message: String(e.message || e) }); return { records: [], errors }; }
  for (const f of files) {
    let arr; try { arr = JSON.parse(await fs.readFile(path.join(dir, f), "utf8")); } catch { errors.push({ message: f + ": not JSON" }); continue; }
    if (!Array.isArray(arr)) { errors.push({ message: f + ": not an array of records" }); continue; }
    for (let i = 0; i < arr.length; i++) {
      seen++;
      try {
        const { rec, valid } = convert(arr[i]); if (!valid) rec.ts = Math.round(ts);
        const old = byId.get(rec.id); if (!old || rec.ts > old.ts) byId.set(rec.id, rec);
      } catch (e) { if (e instanceof RecordError) errors.push({ message: label(arr[i], i, f) + ": " + e.message }); else throw e; }
    }
  }
  const records = [...byId.values()];
  log(`${meta.id}: ${records.length} worlds from ${seen} snapshot records in ${files.length} files, ${errors.length} rejected`);
  return { records, errors };
}
