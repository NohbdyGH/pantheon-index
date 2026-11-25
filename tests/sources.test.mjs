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
