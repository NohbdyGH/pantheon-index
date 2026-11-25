// The owner's own worlds (Pantheon spec 2026-11-24, part 2.5): BlizzardUI world files kept in this repo under
// crawler/first-party/blizzard-worlds/, read by the crawl like any other source. Each becomes a scenario record whose
// payload (the world read the way Pantheon reads it, the whole file riding along) is written next to the index under a name
// that carries its content hash, so a changed world is a new file and no cache serves an old one. Nobody edits the
// manifest by hand: these records reach the live index the way every source's do, through a crawl that re-pins it.
import fs from "node:fs/promises"; import path from "node:path"; import { createHash } from "node:crypto";
import { makeRecord, RecordError } from "../lib/record.mjs";
import { scenarioFromBlizzardSetup } from "../lib/blizzard-setup.mjs";
import { worldCard } from "../lib/world.mjs";
import { BASE } from "../lib/manifest.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
export const WORLDS_DIR = path.join(HERE, "..", "first-party", "blizzard-worlds");
export const meta = {
  id: "blizzard-worlds", label: "BlizzardUI worlds", kinds: ["scenario"], status: "live", transport: "crawler",
  caps: { s: "index", i: true, o: true }, originBase: "https://perchance.org/blizzardui",
};
const slugOf = name => String(name).toLowerCase().replace(/\.json$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
export async function crawl(fetcher, { ts, log = () => {}, outDir = null, dir = WORLDS_DIR } = {}) {
  const errors = []; const records = []; let files = [];
  try { files = (await fs.readdir(dir)).filter(f => f.endsWith(".json")).sort(); } catch (e) { if (e.code !== "ENOENT") errors.push({ message: String(e.message || e) }); return { records, errors }; }
  for (const f of files) {
    let raw; try { raw = JSON.parse(await fs.readFile(path.join(dir, f), "utf8")); } catch (e) { errors.push({ message: f + ": not JSON" }); continue; }
    const s = scenarioFromBlizzardSetup(raw); if (!s) { errors.push({ message: f + ": not a BlizzardUI world file" }); continue; }
    const body = JSON.stringify({ kind: "scenario", payload: s, v: 1 }); const sha = createHash("sha256").update(body).digest("hex").slice(0, 12);
    const slug = slugOf(f); const rel = meta.id + "/payloads/" + slug + "-" + sha + ".json";
    if (outDir) { await fs.mkdir(path.join(outDir, meta.id, "payloads"), { recursive: true }); await fs.writeFile(path.join(outDir, rel), body); }
    const wd = worldCard(s);
    try {
      const rec = makeRecord({ src: meta.id, k: "scenario", nid: slug, n: s.title, b: s.blurb, t: s.tags, c: s.cover, nsfw: false, o: meta.originBase, p: { tr: "index", u: BASE.primary + rel, f: "hubjson" }, caps: meta.caps, ts, cr: raw.meta && raw.meta.creator ? String(raw.meta.creator) : "Nohbdy" });
      if (wd) rec.wd = wd;
      records.push(rec);
    } catch (e) { if (e instanceof RecordError) errors.push({ message: f + ": " + e.message }); else throw e; }
  }
  log(`${meta.id}: ${records.length} worlds from ${files.length} files`);
  return { records, errors };
}
