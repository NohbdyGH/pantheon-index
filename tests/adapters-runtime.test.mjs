import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { validateAdapter, buildSearchUrl, itemsToRecords, crawlDeclarative } from "../crawler/lib/adapters-runtime.mjs";
import { createFetcher } from "../crawler/lib/fetch.mjs";
import { fakeFetch } from "./helpers/fake-fetch.mjs";
import { validateRecord } from "../crawler/lib/record.mjs";

const chub = JSON.parse(fs.readFileSync("crawler/adapters/chub.json", "utf8"));
const fl = JSON.parse(fs.readFileSync("crawler/adapters/fictionlab.json", "utf8"));
const chubFx = JSON.parse(fs.readFileSync("fixtures/chub-search.json", "utf8"));
const flFx = JSON.parse(fs.readFileSync("fixtures/fictionlab-search.json", "utf8"));

test("validateAdapter accepts the shipped descriptors", () => { assert.equal(validateAdapter(chub).ok, true); assert.equal(validateAdapter(fl).ok, true); });
test("validateAdapter rejects unknown transport / missing map keys", () => {
  assert.equal(validateAdapter({ ...chub, transport: "magic" }).ok, false);
  assert.ok(validateAdapter({ ...chub, search: { ...chub.search, map: { n: "name" } } }).errors.some(e => e.includes("map.nid")));
});
test("buildSearchUrl maps only declared controls, applies fixed and sorts", () => {
  const u = new URL(buildSearchUrl(chub, { q: "elf", sort: "popular", page: 2, bogus: "x" }));
  assert.equal(u.searchParams.get("search"), "elf"); assert.equal(u.searchParams.get("sort"), "download_count");
  assert.equal(u.searchParams.get("page"), "2"); assert.equal(u.searchParams.get("namespace"), "characters"); assert.equal(u.searchParams.has("bogus"), false);
});
test("buildSearchUrl: a token range goes to Chub as min_tokens and max_tokens; without one the fixed minimum stays", () => {
  const u = new URL(buildSearchUrl(chub, { tokMin: 500, tokMax: 2000 }));
  assert.equal(u.searchParams.get("min_tokens"), "500"); assert.equal(u.searchParams.get("max_tokens"), "2000");
  const plain = new URL(buildSearchUrl(chub, { q: "elf" }));
  assert.equal(plain.searchParams.get("min_tokens"), "50"); assert.equal(plain.searchParams.has("max_tokens"), false);
});
test("itemsToRecords: chub nodes → records; blank name skipped; nsfw from nsfw_image", () => {
  const { records, skipped } = itemsToRecords(chub, chubFx.data.nodes, { ts: 1756700000 });
  assert.equal(records.length, 2); assert.equal(skipped, 1);
  const a = records[0];
  assert.equal(a.id, "chub:character:101"); assert.deepEqual(a.t, ["fantasy", "elf"]); assert.equal(a.p.u, "https://avatars.charhub.io/avatars/cash/alice/chara_card_v2.png"); assert.equal(a.p.f, "ccv2png"); assert.equal(a.p.tr, "plain"); assert.equal(a.tok, 812);
  assert.equal(records[1].nsfw, true); assert.equal(records[1].b, "A blacksmith."); assert.equal(records[1].c, "https://avatars.charhub.io/avatars/someone/bob/chara_card_v2.png");
  records.forEach(r => assert.equal(validateRecord(r).ok, true, JSON.stringify(validateRecord(r))));
});
test("itemsToRecords: fictionlab → scenario records with super transport", () => {
  const { records } = itemsToRecords(fl, flFx.hits, { ts: 1 });
  assert.equal(records[0].k, "scenario"); assert.equal(records[0].p.tr, "super"); assert.equal(records[0].p.f, "fl"); assert.equal(records[1].nsfw, true);
  assert.equal(records[0].n, "The Flooded Library", "displayName, which is what the API actually returns");
  assert.equal(records[0].c, "https://fictionlab.ai/image-cdn/abc123.webp");
  assert.deepEqual(records[0].t, ["mystery", "slow burn"], "genres are the tags");
});
test("crawlDeclarative pages until empty, runs every pass, dedupes by id", async () => {
  const page2 = { data: { nodes: [chubFx.data.nodes[0]] } }, empty = { data: { nodes: [] } };
  const impl = fakeFetch([
    { match: /page=1/, body: chubFx }, { match: /page=2/, body: page2 }, { match: /page=3/, body: empty },
  ]);
  const f = createFetcher({ fetchImpl: impl, minIntervalMs: 0 });
  const { records, errors, pagesFetched } = await crawlDeclarative(chub, f, { ts: 1, maxPages: 10 });
  // Derived from the adapter: chub gains passes over time, and the count is not what this test is about.
  assert.equal(errors.length, 0); assert.equal(records.length, 2); assert.equal(pagesFetched, 3 * chub.crawl.passes.length);
});
test("crawlDeclarative isolates a failing pass and reports it", async () => {
  const impl = fakeFetch([{ match: /sort=download_count/, body: chubFx }, { match: /sort=created_at/, status: 500, body: "boom" }]);
  const f = createFetcher({ fetchImpl: impl, minIntervalMs: 0, retries: 0 });
  const { records, errors } = await crawlDeclarative(chub, f, { ts: 1, maxPages: 1 });
  assert.equal(records.length, 2); assert.equal(errors.length, chub.crawl.passes.length - 1, "every pass but the one that matched is reported"); assert.match(errors[0].message, /HTTP 500/);
});
test("imageBase: a bare filename becomes a CDN URL, an absolute one is left alone — FictionLab returns both", () => {
  const a = { id: "fl", kinds: ["scenario"], transport: "super", caps: { s: "live", i: true, o: true }, imageBase: "https://fictionlab.ai/image-cdn/",
    search: { items: "hits", map: { nid: "id", n: "displayName|title", b: "description", t: "genres", c: "mainImage|avatarURL", nsfw: "sensitiveContent", o: "https://fictionlab.ai/scenario/{id}", pu: "https://fictionlab.ai/api/scenario/fetch/{id}?version=2" } },
    detail: { transport: "super", format: "fl" } };
  const hits = [
    { id: "s1", displayName: "The Flooded Library", description: "Water to the shelves.", genres: ["mystery"], sensitiveContent: false, mainImage: "abc123.webp" },
    { id: "s2", title: "Second", description: "d", genres: [], sensitiveContent: true, mainImage: "https://cdn.example/full.png" },
    { id: "s3", displayName: "Third", description: "d", genres: [], avatarURL: "/rel/av.png" },
  ];
  const { records } = itemsToRecords(a, hits, { ts: 5 });
  assert.equal(records.length, 3);
  assert.equal(records[0].n, "The Flooded Library");
  assert.equal(records[0].c, "https://fictionlab.ai/image-cdn/abc123.webp", "a filename gets the CDN prefix");
  assert.equal(records[1].c, "https://cdn.example/full.png", "an absolute URL is untouched");
  assert.equal(records[1].nsfw, true, "sensitiveContent is the nsfw flag");
  assert.equal(records[2].c, "https://fictionlab.ai/image-cdn/rel/av.png", "a leading slash does not double up");
  assert.equal(records[0].o, "https://fictionlab.ai/scenario/s1");
  assert.equal(records[0].p.u, "https://fictionlab.ai/api/scenario/fetch/s1?version=2");
  assert.equal(records[0].k, "scenario");
});

test("crawlDeclarative stops at the deadline instead of being killed mid-run", async () => {
  const impl = fakeFetch([{ match: /page=/, body: chubFx }]);
  const f = createFetcher({ fetchImpl: impl, minIntervalMs: 0 });
  const late = await crawlDeclarative(chub, f, { ts: 1, maxPages: 500, deadline: Date.now() - 1 });
  assert.equal(late.pagesFetched, 0, "nothing is fetched once the deadline has passed");
  assert.equal(late.errors.length, 0, "a spent deadline is not an error");
  const ok = await crawlDeclarative(chub, f, { ts: 1, maxPages: 1, deadline: Date.now() + 60000 });
  assert.equal(ok.pagesFetched, chub.crawl.passes.length, "a deadline in the future changes nothing");
});

test("a gallery block is optional, and a broken one is refused before it can ship", () => {
  const base = JSON.parse(JSON.stringify(chub));
  delete base.gallery;
  assert.equal(validateAdapter(base).ok, true, "no gallery is fine: most sources publish one picture per item");
  const withGallery = { ...base, gallery: { url: "https://api.chub.ai/api/gallery/project/{nid}?limit=48", transport: "plain", items: "nodes", map: { u: "primary_image_path", nsfw: "nsfw_image" } } };
  assert.equal(validateAdapter(withGallery).ok, true, JSON.stringify(validateAdapter(withGallery).errors));
  const bad = e => validateAdapter({ ...base, gallery: e }).errors;
  assert.ok(bad({ url: "http://x/{nid}", items: "nodes", map: { u: "u" } }).includes("gallery.url"), "https only");
  assert.ok(bad({ url: "https://x/all", items: "nodes", map: { u: "u" } }).includes("gallery.url.nid"), "a gallery url that ignores the item is not a gallery for it");
  assert.ok(bad({ url: "https://x/{nid}", map: { u: "u" } }).includes("gallery.items"));
  assert.ok(bad({ url: "https://x/{nid}", items: "nodes", map: {} }).includes("gallery.map.u"), "with no picture field there is nothing to read");
});

// The live sources round (2026-11-25): POST, headers, paging, pinned hosts.
const cv = JSON.parse(fs.readFileSync("crawler/adapters/charavault-cards.json", "utf8"));
const cvl = JSON.parse(fs.readFileSync("crawler/adapters/charavault-lorebooks.json", "utf8"));
const nos = JSON.parse(fs.readFileSync("crawler/adapters/nosfertm.json", "utf8"));
const bad = (a, tail) => { const v = validateAdapter(a); assert.equal(v.ok, false, tail); assert.ok(v.errors.some(e => e.startsWith(tail)), `${tail} in ${v.errors}`); };
test("validateAdapter accepts the three live-only descriptors", () => { for (const a of [cv, cvl, nos]) { const v = validateAdapter(a); assert.equal(v.ok, true, v.errors.join()); } });
test("validateAdapter: https only, search url on a pinned host, hosts lower case", () => {
  bad({ ...cv, search: { ...cv.search, url: "http://charavault.net/api/cards" } }, "search.url");
  bad({ ...cv, search: { ...cv.search, url: "https://other.example/api/cards" } }, "hosts.search");
  bad({ ...cv, hosts: ["CharaVault.net"] }, "hosts");
  bad({ ...cv, hosts: ["https://charavault.net"] }, "hosts");
});
test("validateAdapter: map and image links stay on the pinned hosts", () => {
  bad({ ...cv, search: { ...cv.search, map: { ...cv.search.map, pu: "https://evil.example/{file}" } } }, "map.pu.host");
  bad({ ...cv, search: { ...cv.search, map: { ...cv.search.map, c: "{thumb}" } } }, "map.c.host");
  bad({ ...cv, imageBase: "https://evil.example/" }, "imageBase.host");
});
test("validateAdapter: POST and headers need pinned hosts; method, headers and body are checked", () => {
  const { hosts, ...noHosts } = nos; bad(noHosts, "hosts.required");
  bad({ ...nos, search: { ...nos.search, method: "PUT" } }, "search.method");
  bad({ ...nos, search: { ...nos.search, headers: { "X Bad": "v" } } }, "search.headers");
  bad({ ...nos, search: { ...nos.search, headers: { Cookie: "a=b" } } }, "search.headers");
  bad({ ...nos, search: { ...nos.search, headers: { apikey: "a\r\nb: c" } } }, "search.headers");
  bad({ ...nos, search: { ...nos.search, headers: { apikey: "x".repeat(600) } } }, "search.headers");
  bad({ ...nos, search: { ...nos.search, bodyFixed: [] } }, "search.bodyFixed");
  bad({ ...nos, search: { ...nos.search, bodyFields: { q: 5 } } }, "search.bodyFields");
  bad({ ...nos, crawl: { passes: [{}], pages: 1 } }, "crawl.post");
});
test("validateAdapter: paging, stripHtml, flattenCategories, size caps", () => {
  bad({ ...cv, search: { ...cv.search, paging: { mode: "cursor", size: 24 } } }, "search.paging");
  bad({ ...cv, search: { ...cv.search, paging: { mode: "offset", size: 500 } } }, "search.paging");
  bad({ ...cv, search: { ...cv.search, stripHtml: "b" } }, "search.stripHtml");
  bad({ ...cv, search: { ...cv.search, flattenCategories: "yes" } }, "search.flattenCategories");
  bad({ ...cv, search: { ...cv.search, maxQuery: 5000 } }, "search.maxQuery");
});
test("itemsToRecords carries the creator and keeps a link off the pinned hosts out", () => {
  const { records } = itemsToRecords(nos, [{ id: "a", name: "A", author: "Cr", imageUrl: "https://evil.example/x.png", is_nsfw: false, download_path: "d/e f.gz", categories: { rating: "sfw", g: ["Elf"] } }], { ts: 1 });
  assert.equal(records[0].cr, "Cr"); assert.equal(records[0].c, null); assert.deepEqual(records[0].t, ["elf"]); assert.equal(records[0].p.u, "https://raw.githubusercontent.com/nosfertm/perchance-character-database/main/d/e%20f.gz");
  assert.equal(validateRecord(records[0]).ok, true);
});
test("a live-only POST adapter is never crawled", async () => {
  const f = createFetcher({ fetchImpl: fakeFetch([]), minIntervalMs: 0 });
  const r = await crawlDeclarative(nos, f, { ts: 1, maxPages: 1 });
  assert.equal(r.pagesFetched, 0); assert.equal(r.records.length, 0); assert.match(r.errors[0].message, /live/);
});

// JannyAI (2026-11-25): tag table, body filter, sort list.
const jan = JSON.parse(fs.readFileSync("crawler/adapters/jannyai.json", "utf8"));
test("validateAdapter accepts the jannyai descriptor and its pinned hosts cover search, avatar and link back", () => {
  const v = validateAdapter(jan); assert.equal(v.ok, true, v.errors.join());
  for (const h of ["search.jannyai.com", "image.jannyai.com", "jannyai.com"]) assert.ok(jan.hosts.includes(h), h);
  assert.equal(jan.crawl, undefined); assert.equal(jan.detail, undefined); assert.equal(jan.probe, null); assert.equal(jan.caps.i, false);
});
test("validateAdapter: tagNames, bodyFilter and bodySortList are checked", () => {
  bad({ ...jan, tagNames: [] }, "tagNames");
  bad({ ...jan, tagNames: { a: "x" } }, "tagNames");
  bad({ ...jan, tagNames: { 1: 5 } }, "tagNames");
  bad({ ...jan, tagNames: { 1: "x".repeat(80) } }, "tagNames");
  bad({ ...jan, search: { ...jan.search, bodyFilter: { nsfwFalse: 5 } } }, "search.bodyFilter");
  bad({ ...jan, search: { ...jan.search, bodyFilter: { tokenField: "total Token; x" } } }, "search.bodyFilter");
  bad({ ...jan, search: { ...jan.search, bodyFilter: [] } }, "search.bodyFilter");
  bad({ ...jan, search: { ...jan.search, bodySortList: "yes" } }, "search.bodySortList");
  bad({ ...jan, imageBase: "https://evil.example/" }, "imageBase.host");
  bad({ ...jan, search: { ...jan.search, map: { ...jan.search.map, o: "https://evil.example/{id}" } } }, "map.o.host");
});
test("jannyai is a live-only POST adapter and is never crawled", async () => {
  const f = createFetcher({ fetchImpl: fakeFetch([]), minIntervalMs: 0 });
  const r = await crawlDeclarative(jan, f, { ts: 1, maxPages: 1 });
  assert.equal(r.pagesFetched, 0); assert.equal(r.records.length, 0);
});
