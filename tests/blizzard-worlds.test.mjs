import test from "node:test"; import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { execFileSync } from "node:child_process";
import { crawl, meta } from "../crawler/adapters/blizzard-worlds.mjs";
const world = { format: "blizzardui-setup", setupVersion: 1, title: "Harrow", premise: "A lighthouse on a cold coast that has burned every night for ninety years, and must not go dark while the tide is out.", tracker: { npcs: [{ name: "Mira", role: "keeper", age: 70 }] }, lorebook: [{ title: "Harrow Light", keys: ["light"], content: "Lit for ninety years." }], meta: { name: "Harrow", pitch: "A lighthouse that must never go dark.", tags: ["horror", "coast", "slow"], creator: "Nohbdy" }, recommended: { tone: "dread" }, cover: "https://user.uploads.dev/file/poster.png" };
test("each world file becomes a scenario record with its world digest and a payload file named by its content", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bw-")); const out = fs.mkdtempSync(path.join(os.tmpdir(), "bwo-"));
  fs.writeFileSync(path.join(dir, "Harrow Light.json"), JSON.stringify(world)); fs.writeFileSync(path.join(dir, "broken.json"), "{");
  const r = await crawl(null, { ts: 1765000000, dir, outDir: out });
  assert.equal(r.records.length, 1); assert.equal(r.errors.length, 1);
  const rec = r.records[0]; assert.equal(rec.id, "blizzard-worlds:scenario:harrow-light"); assert.equal(rec.n, "Harrow"); assert.deepEqual(rec.t, ["horror", "coast", "slow"]);
  assert.equal(rec.cr, "Nohbdy"); assert.equal(rec.wd.people, 1); assert.deepEqual(rec.wd.rs, ["blizzardui"]);
  assert.match(rec.p.u, /^https:\/\/cdn\.jsdelivr\.net\/gh\/NohbdyGH\/pantheon-index@main\/index\/blizzard-worlds\/payloads\/harrow-light-[0-9a-f]{12}\.json$/);
  const body = JSON.parse(fs.readFileSync(path.join(out, rec.p.u.split("/index/")[1]), "utf8")); assert.equal(body.kind, "scenario"); assert.equal(body.payload.blizzardui.meta.name, "Harrow");
  assert.equal(meta.id, "blizzard-worlds");
});
test("no folder means no records and no error", async () => { const r = await crawl(null, { ts: 1, dir: "/nonexistent-dir-xyz" }); assert.deepEqual(r, { records: [], errors: [] }); });
// The comparison needs Pantheon beside this repo (its nested checkout). On the crawl's runner only this repo exists, so the
// test skips there; Pantheon's own tests hold the same pin from its side.
const pantheonBeside = fs.existsSync(path.join(path.resolve(".."), "src/shared/world.mjs"));
test("the crawler's copies of the world readers are Pantheon's own, byte for byte apart from one import path", { skip: pantheonBeside ? false : "Pantheon is not checked out beside the index" }, () => {
  const root = path.resolve("..");
  assert.equal(fs.readFileSync("crawler/lib/world.mjs", "utf8"), fs.readFileSync(path.join(root, "src/shared/world.mjs"), "utf8"));
  assert.equal(fs.readFileSync("crawler/lib/blizzard-setup.mjs", "utf8"), fs.readFileSync(path.join(root, "src/plugin/blizzard-setup.mjs"), "utf8").replace('from "../shared/world.mjs"', 'from "./world.mjs"'));
});
// The manifest is the crawler's alone (2026-11-24: a hand-pushed stale manifest rolled the live index back two weeks).
test("the manifest is byte for byte the one the crawler last wrote", () => {
  let shallow = "true"; try { shallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"], { encoding: "utf8" }).trim(); } catch { return; }
  if (shallow === "true") return;
  const last = execFileSync("git", ["log", "-1", "--author=pantheon-crawler", "--format=%H", "--", "index/manifest.json"], { encoding: "utf8" }).trim(); if (!last) return;
  const crawler = execFileSync("git", ["show", last + ":index/manifest.json"], { encoding: "utf8" });
  assert.equal(fs.readFileSync("index/manifest.json", "utf8"), crawler, "index/manifest.json differs from the crawler's last commit of it: only the crawl writes the manifest");
});
