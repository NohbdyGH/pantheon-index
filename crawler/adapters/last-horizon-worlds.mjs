// Last Horizon's own worlds (Last Horizon spec, vault lock R4, "the shapes Pantheon reads"): the game ships each world it lists as
// a plain file in the assets repo, named in manifest-2.json. The crawl keeps the `sealed:false` entries whose part starts "world-"
// (never ready-*, the worlds index, or anything sealed), fetches each at its own commit, checks bytes and sha256, and takes the
// file's `pantheon` record whole. A file with none is an adult world and is skipped. Each kept payload is written next to the index
// under a name that carries its content hash, as blizzard-worlds does. If the manifest cannot be read the crawl returns no records
// and one error, so the merge keeps the shards from the last good night. Nothing here ever throws.
import fs from "node:fs/promises"; import path from "node:path"; import { createHash } from "node:crypto";
import { makeRecord, RecordError } from "../lib/record.mjs";
import { worldOf, worldCard } from "../lib/world.mjs";
import { BASE } from "../lib/manifest.mjs";

const REPO = "PEEPEEBOY69/nohbdy-assets";
export const MANIFEST_URL = `https://cdn.jsdelivr.net/gh/${REPO}@main/last-horizon/manifest-2.json`;
export const MANIFEST_FALLBACK = `https://raw.githubusercontent.com/${REPO}/main/last-horizon/manifest-2.json`;
export const meta = {
  id: "last-horizon-worlds", label: "Last Horizon worlds", kinds: ["scenario"], status: "live", transport: "crawler",
  caps: { s: "index", i: true, o: true },
};
const ORIGIN = "https://perchance.org/last-horizon?pan=";
const COMMIT = /^[0-9a-f]{40}$/, SHA = /^[0-9a-f]{64}$/, NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/, WID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const sha256 = b => createHash("sha256").update(b).digest("hex");
const msg = e => String((e && e.message) || e);
const plain = v => Boolean(v) && typeof v === "object" && !Array.isArray(v);

async function readManifest(fetcher) {
  const why = [];
  for (const url of [MANIFEST_URL, MANIFEST_FALLBACK]) {
    try {
      const res = await fetcher.json(url); const m = res.body;
      if (!plain(m) || !Array.isArray(m.files)) { why.push(url + ": no files[]"); continue; }
      return { files: m.files };
    } catch (e) { why.push(msg(e)); }
  }
  return { error: "manifest unreadable: " + why.join("; ") };
}

// The bytes of one entry, read at its own commit from jsDelivr and then raw GitHub; the first copy that matches bytes and sha256 wins.
async function fetchVerified(fetcher, e) {
  const urls = [`https://cdn.jsdelivr.net/gh/${REPO}@${e.commit}/last-horizon/${e.name}`, `https://raw.githubusercontent.com/${REPO}/${e.commit}/last-horizon/${e.name}`];
  const why = [];
  for (const url of urls) {
    try {
      const res = await fetcher.bytes(url); const b = res.body;
      if (b.length !== e.bytes) { why.push(`bytes mismatch (${b.length}, manifest ${e.bytes}) at ${url}`); continue; }
      if (sha256(b) !== e.sha256) { why.push(`sha256 mismatch at ${url}`); continue; }
      return { bytes: b };
    } catch (err) { why.push(msg(err)); }
  }
  return { error: why.join("; ") };
}

export async function crawl(fetcher, { ts, log = () => {}, outDir = null } = {}) {
  const errors = []; const records = []; const seen = new Set();
  const man = await readManifest(fetcher);
  if (man.error) { errors.push({ message: man.error }); log(`${meta.id}: ${man.error}`); return { records, errors }; }
  const wanted = man.files.filter(e => plain(e) && e.sealed === false && typeof e.part === "string" && e.part.startsWith("world-"));
  for (const e of wanted) {
    const label = e.part;
    if (typeof e.name !== "string" || !NAME.test(e.name) || !COMMIT.test(String(e.commit)) || !Number.isInteger(e.bytes) || e.bytes < 0 || !SHA.test(String(e.sha256))) { errors.push({ message: label + ": bad manifest entry" }); continue; }
    const got = await fetchVerified(fetcher, e);
    if (got.error) { errors.push({ message: label + ": " + got.error }); continue; }
    let file; try { file = JSON.parse(Buffer.from(got.bytes).toString("utf8")); } catch { errors.push({ message: label + ": not JSON" }); continue; }
    if (!plain(file) || typeof file.world !== "string" || !WID.test(file.world)) { errors.push({ message: label + ": no world id" }); continue; }
    if (file.pantheon === undefined || file.pantheon === null) { log(`${meta.id}: ${label} has no pantheon (adult), skipped`); continue; }
    const pan = file.pantheon; const id = file.world;
    const p = plain(pan) ? pan.payload : null;
    if (!plain(pan) || pan.k !== "scenario") { errors.push({ message: label + ": pantheon is not a scenario record" }); continue; }
    // An adult world is listed flagged 18+ (owner, 2026-11-26); Safe mode hides it until the visitor picks 18+.
    if (typeof pan.nsfw !== "boolean") { errors.push({ message: label + ": pantheon nsfw is not a boolean" }); continue; }
    if (!plain(p)) { errors.push({ message: label + ": pantheon has no payload" }); continue; }
    if (!plain(p.from) || p.from.app !== "last-horizon" || p.from.id !== id) { errors.push({ message: label + ": payload.from.id is not the world id " + id }); continue; }
    if (!worldOf(p)) { errors.push({ message: label + ": the world block reads to nothing" }); continue; }
    if (seen.has(id)) { errors.push({ message: label + ": duplicate world id " + id }); continue; }
    const body = JSON.stringify({ kind: "scenario", payload: p, v: 1 }); const hash = sha256(body).slice(0, 12);
    const rel = meta.id + "/payloads/" + id + "-" + hash + ".json"; const recId = `${meta.id}:scenario:${id}`;
    let rec;
    try {
      rec = makeRecord({ src: meta.id, k: "scenario", nid: id, n: pan.n, b: pan.b, t: pan.t, c: pan.c ?? null, nsfw: pan.nsfw, o: ORIGIN + recId, p: { tr: "index", u: BASE.primary + rel, f: "hubjson" }, caps: meta.caps, ts, cr: "Nohbdy" });
    } catch (err) { if (err instanceof RecordError) { errors.push({ message: label + ": " + err.message }); continue; } throw err; }
    try {
      if (outDir) { await fs.mkdir(path.join(outDir, meta.id, "payloads"), { recursive: true }); await fs.writeFile(path.join(outDir, rel), body); }
    } catch (err) { errors.push({ message: label + ": could not write payload: " + msg(err) }); continue; }
    const wd = worldCard(p); if (wd) rec.wd = wd;
    seen.add(id); records.push(rec);
  }
  log(`${meta.id}: ${records.length} worlds from ${wanted.length} world entries`);
  return { records, errors };
}
