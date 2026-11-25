import test from "node:test"; import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { crawl, meta, SNAPSHOT_DIR } from "../crawler/adapters/mno.mjs";
import { FORMATS, validateRecord } from "../crawler/lib/record.mjs";

test("meta describes a live crawler-transport scenario source", () => {
  assert.deepEqual(meta, { id: "mno", label: "MNO RPG Engine", kinds: ["scenario"], status: "live", transport: "crawler", caps: { s: "index", i: true, o: true }, originBase: "https://perchance.org/mnoengine" });
  assert.ok(FORMATS.includes("mno"));
});
test("a synthetic snapshot: good records come out as pointer records, bad ones are errors, duplicates keep the newest", async () => {
  const r = await crawl(null, { ts: 1800000000, dir: "fixtures/mno-sample" });
  const ids = r.records.map(x => x.id).sort();
  assert.deepEqual(ids, ["mno:scenario:w1-alpha", "mno:scenario:w2-beta"]);
  const a = r.records.find(x => x.id === "mno:scenario:w1-alpha");
  assert.equal(a.n, "Test World Alpha Newer", "the newer duplicate wins"); assert.equal(a.ts, 1795999999);
  assert.deepEqual(a.t, ["fantasy", "test"]); assert.equal(a.cr, "Tester"); assert.equal(a.src, "mno"); assert.equal(a.k, "scenario");
  assert.deepEqual(a.p, { tr: "plain", u: "https://user.uploads.dev/file/" + "b".repeat(32) + ".gz", f: "mno" });
  assert.deepEqual(a.caps, { s: "index", i: true, o: true }); assert.equal(a.tok, null);
  const b = r.records.find(x => x.id === "mno:scenario:w2-beta");
  assert.equal(b.ts, 1800000000, "an invalid input ts falls back to the crawl ts"); assert.equal(b.c, null); assert.equal(b.nsfw, true);
  for (const x of r.records) assert.deepEqual(validateRecord(x), { ok: true, errors: [] });
  const msgs = r.errors.map(e => e.message).join("\n");
  for (const id of ["w3-badpu", "w4-bado", "w5-noname", "w6-badcover"]) assert.match(msgs, new RegExp(id), id + " must be reported");
  assert.match(msgs, /mno:scenario:: bad id/, "an empty native id is reported");
  assert.equal(r.errors.length, 7, "5 bad records + the malformed id + the null entry");
});
test("a bad file or a missing folder never crashes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mno-")); fs.writeFileSync(path.join(dir, "rec-000.json"), "{"); fs.writeFileSync(path.join(dir, "rec-001.json"), '{"not":"an array"}');
  const r = await crawl(null, { ts: 1, dir }); assert.equal(r.records.length, 0); assert.equal(r.errors.length, 2);
  assert.deepEqual(await crawl(null, { ts: 1, dir: "/nonexistent-dir-xyz" }), { records: [], errors: [] });
});
test("the real snapshot: 1626 records, no errors, no duplicates, nothing fetched", async () => {
  assert.ok(SNAPSHOT_DIR.endsWith(path.join("crawler", "snapshots", "mno")));
  const r = await crawl({ text() { throw new Error("network"); }, json() { throw new Error("network"); } }, { ts: 1800000000 });
  assert.deepEqual(r.errors, []); assert.equal(r.records.length, 1626); assert.equal(new Set(r.records.map(x => x.id)).size, 1626);
  for (const x of r.records) assert.equal(validateRecord(x).ok, true, x.id);
});
