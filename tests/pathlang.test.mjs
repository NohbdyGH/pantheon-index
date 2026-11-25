import test from "node:test";
import assert from "node:assert/strict";
import { get, template, mapFields } from "../crawler/lib/pathlang.mjs";

const o = { a: { b: { c: 1 } }, list: [{ n: "x", t: ["p", "q"] }, { n: "y" }], empty: "", nul: null, name: "Al/ice", num: 7 };

test("get: nested property", () => assert.equal(get(o, "a.b.c"), 1));
test("get: missing → undefined", () => assert.equal(get(o, "a.zz.c"), undefined));
test("get: array map []", () => assert.deepEqual(get(o, "list[]"), o.list));
test("get: array pluck []", () => assert.deepEqual(get(o, "list[].n"), ["x", "y"]));
test("get: nested pluck flattens one level", () => assert.deepEqual(get(o, "list[].t"), ["p", "q"]));
test("get: fallback | picks first non-empty", () => {
  assert.equal(get(o, "empty|nul|a.b.c"), 1);
  assert.equal(get(o, "nul|empty"), undefined);
});
test("get: non-object root is safe", () => assert.equal(get(null, "a.b"), undefined));
test("template: substitutes raw values", () => assert.equal(template("https://x/{name}/card.png", o), "https://x/Al/ice/card.png"));
test("template: numbers stringify, missing → empty", () => assert.equal(template("{num}-{nope}", o), "7-"));
test("mapFields: path values vs template values", () => {
  const out = mapFields({ id: "num", n: "name", url: "https://h/{name}", tags: "list[].n" }, o);
  assert.deepEqual(out, { id: 7, n: "Al/ice", url: "https://h/Al/ice", tags: ["x", "y"] });
});

test("template: ~u encodes one component, ~p keeps the slashes, an empty encoded field voids the template", () => {
  const r = { f: "Sir Ada (a)_1.png", p: "a b/c#d/e.gz", e: "" };
  assert.equal(template("https://h/{f~u}", r), "https://h/Sir%20Ada%20(a)_1.png");
  assert.equal(template("https://h/{p~u}", r), "https://h/a%20b%2Fc%23d%2Fe.gz");
  assert.equal(template("https://h/{p~p}", r), "https://h/a%20b/c%23d/e.gz");
  assert.equal(mapFields({ u: "https://h/{e~p}" }, r).u, undefined);
  assert.equal(mapFields({ u: "https://h/{nope~u}" }, r).u, undefined);
  assert.equal(mapFields({ u: "https://h/{e}" }, r).u, "https://h/", "a plain empty field behaves as before");
});
test("mapFields: a value that is a bare https address is a literal", () => {
  assert.deepEqual(mapFields({ o: "https://site.example/", n: "name" }, { name: "N", "https://site.example/": "no" }), { o: "https://site.example/", n: "N" });
});
