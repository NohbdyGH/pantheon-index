import test from "node:test"; import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { createHash } from "node:crypto";
import { crawl, meta, MANIFEST_URL } from "../crawler/adapters/last-horizon-worlds.mjs";
import { createFetcher } from "../crawler/lib/fetch.mjs";
import { fakeFetch } from "./helpers/fake-fetch.mjs";

const DIR = "fixtures/last-horizon-worlds";
const C1 = "a".repeat(40), C2 = "b".repeat(40);
const bytesOf = n => fs.readFileSync(path.join(DIR, n + ".json"));
const sha = b => createHash("sha256").update(b).digest("hex");
const entry = (part, as, commit, over = {}) => { const b = bytesOf(part); return { part, name: part + "." + sha(b).slice(0, 8) + ".json", as, sealed: false, commit, bytes: b.length, sha256: sha(b), ...over }; };
const fileRoute = (e, commit = e.commit) => ({ match: `https://cdn.jsdelivr.net/gh/PEEPEEBOY69/nohbdy-assets@${commit}/last-horizon/${e.name}`, kind: "bytes", body: new Uint8Array(bytesOf(e.part)) });
const rig = (files, routes = []) => {
  const impl = fakeFetch([{ match: MANIFEST_URL, body: { format: 2, release: "1.0", files } }, ...routes]);
  return { impl, fetcher: createFetcher({ fetchImpl: impl, minIntervalMs: 0, retries: 0, backoffMs: 0 }) };
};

test("a valid world becomes a scenario record whose payload file is named by its content hash", async () => {
  const good = entry("world-alacria", "world", C1); const out = fs.mkdtempSync(path.join(os.tmpdir(), "lhw-"));
  const { fetcher } = rig([good], [fileRoute(good)]);
  const r = await crawl(fetcher, { ts: 1765000000, outDir: out });
  assert.deepEqual(r.errors, []); assert.equal(r.records.length, 1);
  const rec = r.records[0];
  assert.equal(rec.id, "last-horizon-worlds:scenario:alacria"); assert.equal(rec.src, "last-horizon-worlds"); assert.equal(rec.k, "scenario");
  assert.equal(rec.n, "Alacria"); assert.equal(rec.b, "A premise for alacria."); assert.deepEqual(rec.t, ["isekai", "high fantasy"]); assert.equal(rec.c, null); assert.equal(rec.nsfw, false);
  assert.equal(rec.cr, "Nohbdy"); assert.equal(rec.wd.people, 1); assert.equal(rec.wd.lore, 1); assert.equal(rec.wd.staged, true);
  assert.equal(rec.o, "https://perchance.org/last-horizon?pan=" + rec.id);
  assert.equal(rec.p.tr, "index"); assert.equal(rec.p.f, "hubjson");
  assert.match(rec.p.u, /^https:\/\/cdn\.jsdelivr\.net\/gh\/NohbdyGH\/pantheon-index@main\/index\/last-horizon-worlds\/payloads\/alacria-[0-9a-f]{12}\.json$/);
  const body = JSON.parse(fs.readFileSync(path.join(out, rec.p.u.split("/index/")[1]), "utf8"));
  assert.deepEqual(Object.keys(body).sort(), ["kind", "payload", "v"]); assert.equal(body.kind, "scenario"); assert.equal(body.v, 1);
  assert.equal(body.payload.from.id, "alacria"); assert.equal(body.payload.world.cast[0].name, "Mira");
  assert.deepEqual(meta, { id: "last-horizon-worlds", label: "Last Horizon worlds", kinds: ["scenario"], status: "live", transport: "crawler", caps: { s: "index", i: true, o: true } });
});

test("adult worlds with no pantheon, ready-* entries, the worlds index and sealed entries are skipped without error", async () => {
  const good = entry("world-alacria", "world", C1), adult = entry("world-adult-one", "world", C2);
  const ready = entry("ready-alacria", "world", C1), sealed = entry("world-sealedone", "world", C1, { sealed: true });
  const index = { part: "worlds-index", name: "worlds-index.deadbeef.json", as: "data", sealed: false, commit: C1, bytes: 2, sha256: "0".repeat(64) };
  const { impl, fetcher } = rig([ready, index, sealed, adult, good], [fileRoute(good), fileRoute(adult), fileRoute(ready), fileRoute(sealed)]);
  const r = await crawl(fetcher, { ts: 1 });
  assert.deepEqual(r.errors, []); assert.deepEqual(r.records.map(x => x.id), ["last-horizon-worlds:scenario:alacria"]);
  const urls = impl.calls.map(c => c.url); assert.equal(urls.some(u => /ready-|worlds-index|sealedone/.test(u)), false, "never fetched");
  assert.ok(urls.some(u => u.includes("world-adult-one")), "the adult file is read, then skipped");
});

test("a sha256 mismatch is an error and yields no record, after the raw fallback also fails", async () => {
  const bad = entry("world-tampered", "world", C1, { sha256: "f".repeat(64) }); const good = entry("world-alacria", "world", C1);
  const { impl, fetcher } = rig([bad, good], [fileRoute(good), fileRoute(bad)]);
  const r = await crawl(fetcher, { ts: 1 });
  assert.deepEqual(r.records.map(x => x.id), ["last-horizon-worlds:scenario:alacria"]);
  assert.equal(r.errors.length, 1); assert.match(r.errors[0].message, /world-tampered/); assert.match(r.errors[0].message, /sha256/);
  assert.ok(impl.calls.some(c => c.url.startsWith("https://raw.githubusercontent.com/PEEPEEBOY69/nohbdy-assets/" + C1 + "/last-horizon/world-tampered")), "raw fallback tried at the same commit");
});

test("a bytes mismatch is rejected too", async () => {
  const bad = entry("world-alacria", "world", C1, { bytes: 5 }); const { fetcher } = rig([bad], [fileRoute(bad)]);
  const r = await crawl(fetcher, { ts: 1 }); assert.equal(r.records.length, 0); assert.match(r.errors[0].message, /bytes/);
});

test("when jsDelivr fails the same commit is read from raw.githubusercontent.com", async () => {
  const good = entry("world-alacria", "world", C1);
  const { impl, fetcher } = rig([good], [{ match: "https://raw.githubusercontent.com/PEEPEEBOY69/nohbdy-assets/" + C1 + "/last-horizon/" + good.name, kind: "bytes", body: new Uint8Array(bytesOf("world-alacria")) }]);
  const r = await crawl(fetcher, { ts: 1 }); assert.deepEqual(r.errors, []); assert.equal(r.records.length, 1); assert.equal(impl.calls.length, 3);
});

test("a pantheon whose from.id is not the file's world is an error", async () => {
  const e = entry("world-wrongfrom", "world", C1); const { fetcher } = rig([e], [fileRoute(e)]);
  const r = await crawl(fetcher, { ts: 1 }); assert.equal(r.records.length, 0); assert.match(r.errors[0].message, /from\.id/);
});

test("a nsfw pantheon, or one whose world block reads to nothing, is an error", async () => {
  const mk = (id, mut) => { const f = JSON.parse(bytesOf("world-alacria")); f.world = id; f.pantheon.payload.from.id = id; mut(f.pantheon); const b = Buffer.from(JSON.stringify(f)); return { e: { part: "world-" + id, name: "world-" + id + ".00000000.json", as: "world", sealed: false, commit: C1, bytes: b.length, sha256: sha(b) }, b }; };
  const nsfw = mk("hot", p => { p.nsfw = true; }), empty = mk("hollow", p => { p.payload.world = { v: 1 }; });
  const route = x => ({ match: "https://cdn.jsdelivr.net/gh/PEEPEEBOY69/nohbdy-assets@" + C1 + "/last-horizon/" + x.e.name, kind: "bytes", body: new Uint8Array(x.b) });
  const { fetcher } = rig([nsfw.e, empty.e], [route(nsfw), route(empty)]);
  const r = await crawl(fetcher, { ts: 1 }); assert.equal(r.records.length, 0); assert.equal(r.errors.length, 2);
});

test("an unreachable manifest is an error and no records, so the merge keeps last night's shards", async () => {
  for (const routes of [[{ match: MANIFEST_URL, status: 404, body: "nope", kind: "text" }, { match: "https://raw.githubusercontent.com/", status: 404, body: "nope", kind: "text" }], [{ match: /./, throws: new Error("offline") }], [{ match: /./, body: { format: 2 } }], [{ match: /./, body: "<html>", kind: "text" }]]) {
    const fetcher = createFetcher({ fetchImpl: fakeFetch(routes), minIntervalMs: 0, retries: 0, backoffMs: 0 });
    const r = await crawl(fetcher, { ts: 1 }); assert.deepEqual(r.records, []); assert.equal(r.errors.length, 1); assert.match(r.errors[0].message, /manifest/);
  }
});

test("a thrown network error on one world file is an error, never a crash, and the others still land", async () => {
  const a = entry("world-alacria", "world", C1), b = entry("world-tampered", "world", C2);
  const { fetcher } = rig([b, a], [{ match: /@b+\//, throws: new Error("reset") }, fileRoute(a)]);
  const r = await crawl(fetcher, { ts: 1 }); assert.equal(r.records.length, 1); assert.equal(r.errors.length, 1);
});

test("entries with a bad commit or file name are refused before any fetch", async () => {
  const a = entry("world-alacria", "world", "main"), b = entry("world-alacria", "world", C1, { name: "../x.json" });
  const { impl, fetcher } = rig([a, b]); const r = await crawl(fetcher, { ts: 1 });
  assert.equal(r.records.length, 0); assert.equal(r.errors.length, 2); assert.equal(impl.calls.length, 1, "only the manifest");
});
