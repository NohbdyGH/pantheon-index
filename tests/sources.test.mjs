import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const sources = JSON.parse(fs.readFileSync("crawler/sources.json", "utf8"));
const targets = JSON.parse(fs.readFileSync("crawler/targets.json", "utf8"));
const STATUS = ["candidate", "probed", "adapted", "live", "blocked", "dead"];

test("sources: unique ids, valid statuses, hosts lowercase, live ones have an existing adapter file", () => {
  const ids = new Set();
  for (const s of sources) {
    assert.match(s.id, /^[a-z0-9-]+$/); assert.equal(ids.has(s.id), false, "dup " + s.id); ids.add(s.id);
    assert.ok(STATUS.includes(s.status), s.id); assert.ok(Array.isArray(s.kinds) && s.kinds.length, s.id);
    for (const h of s.hosts) assert.equal(h, h.toLowerCase());
    if (s.status === "live") { assert.ok(s.adapter, s.id + " needs adapter"); assert.ok(fs.existsSync("crawler/adapters/" + s.adapter), s.adapter); }
    if (s.probe !== null && s.probe !== undefined) assert.match(s.probe, /^https:\/\//);
  }
  assert.ok(sources.length >= 35);
});
test("targets: https url containing {id} when receiver is expected later; kinds valid", () => {
  for (const t of targets) { assert.match(t.url, /^https:\/\/perchance\.org\//); assert.equal(typeof t.receiver, "boolean"); assert.ok(t.kinds.every(k => ["character", "lorebook", "scenario"].includes(k))); }
  const FORMATS = ["aicc-hash", "airpg-upload", "furai-upload", "mno-upload"];
  for (const t of targets) {
    if (t.receiver) assert.ok(t.url.includes("{id}"), t.id + ": a receiver target must carry {id} in its URL");
    else assert.ok(FORMATS.includes(t.format), t.id + ": a target with no receiver must declare a format Pantheon emits, got " + t.format);
  }
  assert.ok(targets.some(t => t.id === "blizzardui" && t.format === "airpg-upload"), "BlizzardUI reads #data=uup1: natively");
});
// The sources round (2026-10-15): a live source carries the terms someone read, and a site that says no is not crawled.
test("every live source carries the terms someone read, with a date and a verdict; a forbidding one is paused", () => {
  for (const s of sources.filter(x => x.status === "live")) {
    assert.ok(s.terms && typeof s.terms === "object", s.id + " has no terms record");
    assert.match(s.terms.read, /^\d{4}-\d{2}-\d{2}$/, s.id);
    assert.ok(["allows", "silent", "forbids", "none"].includes(s.terms.verdict), s.id);
    if (s.terms.verdict !== "none") assert.match(s.terms.url, /^https:\/\//, s.id);
    // A site whose terms forbid it is paused, unless Cash decided otherwise and the register says so (2026-10-20).
    if (s.terms.verdict === "forbids" && !s.terms.override) assert.equal(s.crawl, "paused", s.id + " forbids crawling, so it is paused");
    if (s.terms.override) { assert.equal(s.terms.override.by, "Cash", s.id); assert.match(s.terms.override.date, /^\d{4}-\d{2}-\d{2}$/, s.id); assert.ok(s.terms.override.said, s.id); }
  }
  for (const id of ["pygmalion", "lorebary", "aetherroom"]) assert.ok(sources.find(s => s.id === id), id + " is in the register");
  for (const id of ["aidungeon", "pygmalion", "altworld", "lorebary", "jannyai", "moescape", "datacat"]) assert.equal(sources.find(s => s.id === id).status, "blocked", id);
  for (const id of ["minitavern", "kobold", "aetherroom"]) assert.equal(sources.find(s => s.id === id).status, "dead", id);
  assert.equal(sources.find(s => s.id === "character-tavern").terms.override.by, "Cash", "read on Cash's decision, 2026-10-20");
});

// The live sources round (2026-11-25): search only, never crawled, the terms that were read.
test("charavault and nosfertm are built live-search-only sources, held blocked until a live check answers (2026-11-25), with the terms recorded", () => {
  const by = id => sources.find(s => s.id === id);
  for (const id of ["charavault-cards", "charavault-lorebooks", "nosfertm"]) {
    const s = by(id); assert.ok(s, id); assert.equal(s.status, "blocked", id + ": not offered until it answers a visitor without a bot check"); assert.match(s.evidence, /2026-11-25/); assert.equal(s.crawl, false, id + " is never crawled");
    assert.equal(s.terms.read, "2026-11-25"); assert.equal(s.terms.verdict, "allows");
    const a = JSON.parse(fs.readFileSync("crawler/adapters/" + s.adapter, "utf8")); assert.equal(a.id, id); assert.equal(a.caps.s, "live");
    for (const h of a.hosts) assert.ok(s.hosts.includes(h), `${id}: ${h} is in the register`);
    assert.equal(s.probe, null, id + " is not probed by the nightly sweep");
  }
  assert.match(by("charavault-cards").terms.note, /Reasonable scraping and API usage is permitted/);
  assert.match(by("charavault-cards").terms.note, /robots\.txt disallows \/api\//);
  assert.match(by("charavault-lorebooks").terms.note, /charavault-cards/);
  assert.match(by("nosfertm").terms.note, /MIT/); assert.match(by("nosfertm").terms.note, /CC BY-SA 4\.0/); assert.match(by("nosfertm").terms.note, /credit/);
});

// 2026-11-25: JannyAI is built and held; Wyvern's terms forbid automated access, so it is recorded and not built.
test("jannyai is a built live-search-only source held blocked, and wyvern is blocked with no adapter because its terms forbid it", () => {
  const by = id => sources.find(s => s.id === id);
  assert.equal(sources.filter(s => s.id === "jannyai").length, 1); assert.equal(sources.filter(s => s.id === "wyvern").length, 1);
  const j = by("jannyai");
  assert.equal(j.status, "blocked"); assert.equal(j.crawl, false); assert.equal(j.probe, null); assert.match(j.evidence, /2026-11-25/); assert.match(j.evidence, /real visitor's page/);
  assert.equal(j.terms.read, "2026-11-25"); assert.match(j.terms.url, /^https:\/\//);
  const a = JSON.parse(fs.readFileSync("crawler/adapters/" + j.adapter, "utf8")); assert.equal(a.id, "jannyai"); assert.equal(a.caps.s, "live"); assert.equal(a.transport, "plain");
  for (const h of a.hosts) assert.ok(j.hosts.includes(h), h + " is in the register");
  const w = by("wyvern");
  assert.equal(w.status, "blocked"); assert.equal(w.adapter, undefined, "no adapter is built for a site that forbids it"); assert.equal(w.probe, null); assert.equal(w.crawl, false);
  assert.equal(w.terms.verdict, "forbids"); assert.match(w.terms.url, /^https:\/\//); assert.match(w.terms.note, /Automated Access is prohibited/);
  assert.equal(fs.existsSync("crawler/adapters/wyvern.json"), false);
});
// Proven hand-offs only (2026-11-25, the owner's call): each target says, per kind, the date someone saw the item arrive
// in the destination. A kind without a date is never offered. "world" is a scenario that carries a world, checked
// separately from plain scenarios; nothing has been checked with a world yet, so no target carries one.
// The dates were seeded only from what each note already recorded.
const WORKS = { "ai-character-chat": { "character": "2026-09-02" }, "blizzardui": { "character": "2026-09-09", "lorebook": "2026-09-09", "scenario": "2026-09-09", "world": "2026-09-09" }, "aether": { "character": "2026-09-09", "lorebook": "2026-09-09", "scenario": "2026-09-09", "world": "2026-09-09" }, "last-horizon": {}, "ai-rpg": { "scenario": "2026-09-02", "world": "2026-09-02" }, "as-rpg": { "scenario": "2026-11-02", "world": "2026-11-02" }, "ai-girlfriend-chat": { "character": "2026-09-05" }, "aschat": { "character": "2026-09-05" }, "fur-ai": {}, "scenario-petrafiedacc": { "character": "2026-09-05" }, "sonder": { "character": "2026-10-21" }, "mnoengine": { "scenario": "2026-11-02", "world": "2026-11-26" }, "vellum": {}};
test("targets: every one carries works, dated per kind, each date already in its note; a world follows its importer's scenario route (2026-11-26); verified agrees", () => {
  assert.deepEqual(targets.map(t => t.id).sort(), Object.keys(WORKS).sort(), "every target is in the table");
  for (const t of targets) {
    assert.ok(t.works && typeof t.works === "object" && !Array.isArray(t.works), t.id + " has works");
    assert.deepEqual(t.works, WORKS[t.id], t.id);
    for (const [k, d] of Object.entries(t.works)) {
      assert.ok(["character", "lorebook", "scenario", "world"].includes(k), t.id + ": " + k);
      assert.match(d, /^\d{4}-\d{2}-\d{2}$/, t.id + ": " + k);
      assert.ok(t.note.includes(d), t.id + ": the date " + d + " is in the note");
      if (k !== "world") assert.ok(t.kinds.includes(k), t.id + ": " + k + " is one of its kinds");
    }
    if (t.works.world) assert.ok(t.works.world === t.works.scenario || t.id === "mnoengine", t.id + ": a world goes by the scenario route, except the MNO engine, which opens the file itself");
    if (t.id === "blizzardui") assert.ok(!(t.accepts || []).includes("mno-world"), "the raw MNO file waits for BlizzardUI 2.45");
    assert.equal(t.verified, Object.keys(t.works).length > 0, t.id + ": verified stays true exactly when some kind is proven");
  }
});
