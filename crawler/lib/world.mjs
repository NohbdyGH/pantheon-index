// Worlds (specs/2026-11-11-worlds-design.md, docs/2026-11-11-worlds-contract.md). A scenario payload may carry a
// `world` block; this is the one function that says what a block is. Pure: no DOM, no I/O, the input is never changed.
// The plugin bundles it and the tests import it. The hub's server block never reads a payload, so it does not use it.
export const WORLD_TAG = "world";
// Index sources whose worlds are the owner's own (spec 2026-11-24, part 2.5): their world block is read like the hub's.
export const FIRST_PARTY_WORLDS = ["blizzard-worlds", "last-horizon-worlds"];
// Index sources where every scenario is a world though its record has no digest (`wd`): the community worlds of the
// other engine (spec 2026-11-25). Their tile names no people or lore counts, because the index does not know them.
export const WORLD_SOURCES = ["mno"];
// Is this record a world on the Worlds page and in world searches: a scenario with a digest from the hub or a
// first-party source (searches check those themselves), or any scenario from a whole-source world source.
export const isWorldRecord = rec => Boolean(rec) && rec.k === "scenario" && (Boolean(rec.wd) || WORLD_SOURCES.includes(rec.src));
// The hub, the owner's worlds, and the world sources whose block Pantheon builds itself from the file (mno, 2026-11-25).
const trustsWorld = src => src === "hub" || FIRST_PARTY_WORLDS.includes(src) || WORLD_SOURCES.includes(src);
export const LORE_TYPES = ["place", "faction", "person", "creature", "item", "rule", "history", "other"];
const wStr = (v, n) => (typeof v === "string" ? v.trim().slice(0, n).trim() : "");
const wHttps = v => (typeof v === "string" && v.length <= 300 && /^https:\/\/\S+$/.test(v) ? v : null);
// Recommended settings (spec 2026-11-24, part 2): one set per generator, checked for shape only; each generator checks
// the values against its own list. A key is copied only when it is one of the input's own keys and passes the pattern,
// so __proto__, constructor and prototype never reach the copy.
const REC_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/; const REC_KEY = /^[A-Za-z0-9_.-]{1,40}$/; const REC_BAD = new Set(["__proto__", "constructor", "prototype"]);
const plainObj = v => Boolean(v) && typeof v === "object" && !Array.isArray(v);
export function recommendedOf(r) {
  if (!plainObj(r)) return null; const out = {}; let n = 0;
  for (const g of Object.keys(r)) {
    if (n === 4) break; if (g.length > 40 || REC_BAD.has(g) || !REC_NAME.test(g)) continue;
    const src = r[g]; if (!plainObj(src)) continue; const set = {}; let k = 0;
    for (const key of Object.keys(src)) {
      if (k === 40) break; if (REC_BAD.has(key) || !REC_KEY.test(key)) continue;
      const v = src[key]; const ok = typeof v === "string" ? v.length <= 80 : typeof v === "number" ? Number.isFinite(v) : typeof v === "boolean"; if (!ok) continue;
      set[key] = v; k++;
    }
    if (k) { out[g] = set; n++; }
  }
  return n ? out : null;
}

// A cut that lands on a boundary instead of mid-word: `cutSentence` at the last . ! ? within the limit, `cutComma` at the
// last comma (the comma itself goes); both fall back to the last space, then to a hard cut. A text within the limit is
// only trimmed, so cutting a cut text changes nothing.
const wCut = (v, n, re, comma) => {
  const t = typeof v === "string" ? v.trim() : ""; if (t.length <= n) return t;
  const head = t.slice(0, n); let i = -1; for (let k = head.length - 1; k > 0; k--) if (re.test(head[k])) { i = k; break; }
  if (i > 0) return head.slice(0, comma ? i : i + 1).trim();
  const sp = head.lastIndexOf(" "); return (sp > 0 ? head.slice(0, sp) : head).trim();
};
const cutSentence = (v, n) => wCut(v, n, /[.!?]/, false);
const cutComma = (v, n) => wCut(v, n, /,/, true);
// A start, a maximum or a stat value: a finite number, or a short string (an MNO formula begins with "=" and stays verbatim).
const wVal = v => (typeof v === "number" ? (Number.isFinite(v) ? v : undefined) : typeof v === "string" && v.trim() && v.trim().length <= 120 ? v.trim() : undefined);
const wEnum = (v, list) => (list.includes(v) ? v : undefined);
const wNum = v => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const wShort = (v, n) => { const t = wStr(v, n + 1); return t && t.length <= n ? t : undefined; };
const put = (o, k, v) => { if (v !== undefined && v !== "") o[k] = v; };
const TRIGGER_FIELDS = ["name", "age", "gender", "race", "job", "appearance", "persona", "secret", "extra"];
// One tracker of the world (npc = false) or of every person in it (npc = true), as the Worlds contract lists them.
function systemOf(s, npc) {
  const label = s && typeof s === "object" ? wStr(s.label, 60) : ""; if (!label) return null;
  const o = { label, meaning: wStr(s.meaning, 300), change: wStr(s.change, 400) };
  put(o, "kind", wEnum(s.kind, ["number", "text"])); put(o, "start", wVal(s.start)); put(o, "max", wVal(s.max));
  put(o, "show", wEnum(s.show, npc ? ["profile", "hidden"] : ["header", "hero", "both", "hidden"]));
  put(o, "key", wShort(s.key, 40)); put(o, "hint", wStr(s.hint, 300)); put(o, "icon", wShort(s.icon, 16));
  put(o, "color", typeof s.color === "string" && /^#[0-9a-fA-F]{6}$/.test(s.color) ? s.color : undefined);
  put(o, "display", wEnum(s.display, ["bar", "slider", "text"])); put(o, "followMax", s.followMax === true ? true : wEnum(s.followMax, ["rise", "max"]));
  put(o, "limitMode", wEnum(s.limitMode, ["cooldown", "budget"])); put(o, "limitTurns", wNum(s.limitTurns)); put(o, "limitAmount", wNum(s.limitAmount));
  if (npc) {
    put(o, "default", s.default === true || s.default === false ? s.default : wEnum(s.default, ["trigger"])); put(o, "triggerField", wEnum(s.triggerField, TRIGGER_FIELDS));
    const raw = Array.isArray(s.triggerWords) ? s.triggerWords : typeof s.triggerWords === "string" ? s.triggerWords.split(",") : [];
    const words = raw.map(x => wShort(x, 40)).filter(Boolean).slice(0, 20); if (words.length) o.triggerWords = words;
    put(o, "triggerAge", wShort(s.triggerAge, 20));
  }
  return o;
}
const systemsOf = (list, npc) => { const out = []; for (const s of Array.isArray(list) ? list : []) { if (out.length === 40) break; const o = systemOf(s, npc); if (o) out.push(o); } return out; };
// A person's own tracker values: a plain object of at most 60 keys, each a finite number or a string of at most 120.
function memberTrackers(t) {
  if (!plainObj(t)) return null; const out = {}; let n = 0;
  for (const k of Object.keys(t)) {
    if (n === 60) break; if (!k || k.length > 60 || REC_BAD.has(k)) continue;
    const v = wVal(t[k]); if (v === undefined) continue; out[k] = v; n++;
  }
  return n ? out : null;
}
function statsOf(st) {
  if (!plainObj(st)) return null; const defs = [];
  for (const d of Array.isArray(st.defs) ? st.defs : []) {
    if (defs.length === 20) break; const key = plainObj(d) ? wStr(d.key, 40) : ""; if (!key) continue;
    const o = { key }; put(o, "label", wStr(d.label, 300)); put(o, "hint", wStr(d.hint, 300)); put(o, "start", wVal(d.start)); put(o, "max", wVal(d.max)); put(o, "rules", wStr(d.rules, 300)); defs.push(o);
  }
  if (!defs.length) return null; const out = { defs }; put(out, "pointsPerLevel", wNum(st.pointsPerLevel)); put(out, "ccBudget", wNum(st.ccBudget)); return out;
}

// Pre-made heroes (2026-11-25): up to 24 playable characters, names unique ignoring case. Age is a whole number or null
// (a host decides what it plays); pronouns fold to the three a host speaks; a portrait is an https link only; one at most
// is recommended.
const PRONOUNS = ["he/him", "she/her", "they/them"];
function heroesOf(list, statKeys = []) {
  const out = []; const seen = new Set(); let rec = false;
  for (const m of Array.isArray(list) ? list : []) {
    if (out.length === 24) break;
    const name = m && typeof m === "object" ? wStr(m.name, 100) : ""; if (!name || seen.has(name.toLowerCase())) continue; seen.add(name.toLowerCase());
    const h = { name, age: Number.isInteger(m.age) && m.age >= 0 && m.age <= 150 ? m.age : null };
    if (typeof m.pronouns === "string" && m.pronouns.trim()) h.pronouns = PRONOUNS.includes(m.pronouns.trim().toLowerCase()) ? m.pronouns.trim().toLowerCase() : "they/them";
    put(h, "description", wStr(m.description, 160)); put(h, "look", wStr(m.look, 300)); put(h, "background", wStr(m.background, 400)); put(h, "carries", wStr(m.carries, 120));
    const pic = wHttps(m.portrait); if (pic && pic.length <= 300) h.portrait = pic;
    const tr = memberTrackers(m.trackers); if (tr) h.trackers = tr;
    if (m.stats && typeof m.stats === "object" && !Array.isArray(m.stats)) { const st = {}; for (const k of statKeys) if (typeof m.stats[k] === "number" && Number.isFinite(m.stats[k])) st[k] = m.stats[k]; if (Object.keys(st).length) h.stats = st; }
    if (m.recommended === true && !rec) { h.recommended = true; rec = true; }
    out.push(h);
  }
  return out;
}

export function worldOf(payload) {
  const w = payload && typeof payload === "object" && !Array.isArray(payload) ? payload.world : null;
  if (!w || typeof w !== "object" || Array.isArray(w)) return null;
  // An opening with no note is kept only as "staged": the scenario's own intro is then an instruction to the narrator.
  const note = w.opening && typeof w.opening === "object" ? wStr(w.opening.note, 1500) : "";
  const cast = [];
  for (const m of Array.isArray(w.cast) ? w.cast : []) {
    if (cast.length === 24) break;
    const name = m && typeof m === "object" ? wStr(m.name, 300) : "";
    if (!name) continue;
    const c = { name, age: Number.isInteger(m.age) && m.age >= 0 && m.age <= 999 ? m.age : null, role: wStr(m.role, 300), look: wStr(m.look, 300), manner: wStr(m.manner, 300), secret: wStr(m.secret, 400) };
    put(c, "ageText", wStr(m.ageText, 60)); const tr = memberTrackers(m.trackers); if (tr) c.trackers = tr;
    cast.push(c);
  }
  const systems = systemsOf(w.systems, false); const npcSystems = systemsOf(w.npcSystems, true);
  const vibe = cutSentence(w.vibe, 200);
  if (!vibe && !note && !cast.length && !systems.length && !npcSystems.length) return null;
  const st = w.style && typeof w.style === "object" ? w.style : {}; const art = cutComma(st.art, 300); const avoid = cutComma(st.avoid, 300);
  const c = w.credit && typeof w.credit === "object" ? { author: wStr(w.credit.author, 80), via: wStr(w.credit.via, 80), url: wHttps(w.credit.url) } : null;
  const out = { v: 1, vibe, opening: note ? { note, mode: w.opening.mode === "staged" ? "staged" : "plain" } : w.opening && w.opening.mode === "staged" ? { note: "", mode: "staged" } : null, cast, systems };
  if (npcSystems.length) out.npcSystems = npcSystems;
  const stats = statsOf(w.stats); if (stats) out.stats = stats;
  const heroes = heroesOf(w.heroes, stats ? stats.defs.map(d => d.key) : []); if (heroes.length) out.heroes = heroes;
  out.style = art || avoid ? { art, ...(avoid ? { avoid } : {}) } : null; out.credit = c && (c.author || c.via || c.url) ? c : null;
  const rec = recommendedOf(w.recommended); if (rec) out.recommended = rec;
  return out;
}

// What a card shows without reading the payload, and what the hub stores beside the record (`wd`).
export function worldCard(payload) {
  const w = worldOf(payload); if (!w) return null;
  const lore = payload.lore && Array.isArray(payload.lore.entries) ? payload.lore.entries.length : 0;
  const card = { vibe: w.vibe, people: w.cast.length, lore, staged: Boolean(w.opening && w.opening.mode === "staged") };
  if (w.recommended) card.rs = Object.keys(w.recommended);
  return card;
}

// The other engine writes its player as the double-brace user token. It is resolved once, at import: the possessive
// is "your", anything else "you", capitalised where a sentence or a line begins. The verb beside it agrees with "you":
// is, was, has and does always; any other verb in the third person (walks, carries, goes) only where the token is
// plainly the subject (it begins a sentence or a clause), so the token as the one something is given to keeps the
// word after it as written ("gives you orders"). One adverb may stand between the two ("you always pay").
const USER_VERBS = { "is": "are", "was": "were", "has": "have", "does": "do", "isn't": "aren't", "wasn't": "weren't", "hasn't": "haven't", "doesn't": "don't" };
const USER_ODD = { focuses: "focus", aches: "ache", caches: "cache" };
const USER_NOT_VERBS = new Set(["always", "sometimes", "perhaps", "besides", "afterwards", "towards", "backwards", "forwards", "upstairs", "downstairs", "outdoors", "indoors", "overseas", "nowadays", "unless", "whereas", "plus", "minus", "versus", "yes", "its", "hers", "ours", "yours", "theirs", "others"]);
const USER_ADVERBS = new Set(["always", "never", "often", "sometimes", "also", "still", "just", "now", "then", "soon", "already", "only", "even", "perhaps", "thus", "again", "almost"]);
const USER_RE = /\{\{\s*[Uu][Ss][Ee][Rr]\s*\}\}(?:(['’]s)|([ \t]+)([a-z'’]+)(?![\w\-'’])(?:([ \t]+)([a-z'’]+)(?![\w\-'’]))?)?/g;
const USER_START = /(^|[.!?]["')\]]*\s+|\n\s*)$/;
const USER_CLAUSE = /(?:[,;:(—][ \t]*|["“‘]|\b(?:and|but|or|nor|so|yet|when|whenever|while|if|unless|until|because|since|as|that|where|wherever|whether|though|although|once|before|after|what|whatever|how|why|which|who|then|than)[ \t]+)$/i;
// A verb in the third person as "you" takes it, or null for a word that is not one.
function userVerb(w) {
  if (USER_ODD[w]) return USER_ODD[w];
  if (!/^[a-z]{3,}s$/.test(w) || /(?:ss|us|is)$/.test(w) || USER_NOT_VERBS.has(w)) return null;
  if (/ies$/.test(w)) return w.length > 4 ? w.slice(0, -3) + "y" : w.slice(0, -1);
  if (/(?:sses|shes|ches|xes|zzes|oes)$/.test(w)) return w.slice(0, -2);
  return w.slice(0, -1);
}
export function resolveUserToken(text) {
  const s = typeof text === "string" ? text : text == null ? "" : String(text);
  return s.replace(USER_RE, (m, poss, gap1, w1, gap2, w2, at) => {
    const word = poss ? "your" : "you";
    const before = s.slice(0, at);
    const starts = at === 0 || USER_START.test(before);
    const first = starts ? word[0].toUpperCase() + word.slice(1) : word;
    if (poss || !w1) return first;
    const subject = starts || USER_CLAUSE.test(before);
    const fit = (w, any) => {
      const k = w.replace(/’/g, "'");
      const v = Object.hasOwn(USER_VERBS, k) ? USER_VERBS[k] : any ? userVerb(k) : null;
      return v == null ? null : w.includes("’") ? v.replace(/'/g, "’") : v;
    };
    const rest = w2 ? gap2 + w2 : "";
    const v1 = fit(w1, subject);
    if (v1 != null) return first + gap1 + v1 + rest;
    if (subject && w2 && (USER_ADVERBS.has(w1) || /^[a-z]{3,}ly$/.test(w1))) { const v2 = fit(w2, true); if (v2 != null) return first + gap1 + w1 + gap2 + v2; }
    return first + gap1 + w1 + rest;
  });
}

// A lore entry's type survives the shared lore reader (which is pinned to the index repo's copy and does not know it) by
// following its entry: the reader drops an entry with no words and no keys, so the same test pairs the rest.
export function typeLore(out, from) {
  const raw = Array.isArray(from) ? from : from && typeof from === "object" ? Object.values(from) : [];
  const keys = e => [e.keys, e.key, e.triggers].find(Array.isArray) || [];
  const kept = raw.filter(e => e && typeof e === "object" && (String(e.content == null ? "" : e.content) !== "" || keys(e).map(String).filter(Boolean).length));
  out.forEach((e, i) => { const t = kept[i] && kept[i].type; if (LORE_TYPES.includes(t)) e.type = t; });
  return out;
}

// What a host is handed for a scenario it reads: the block normalised for the trusted sources above, and no block at all for
// anything else (an index-sourced scenario has none, whatever its source file says).
export function readWorld(rec, out) {
  if (!out || out.kind !== "scenario" || !out.payload || typeof out.payload !== "object") return out;
  const { world, ...rest } = out.payload; const w = rec && trustsWorld(rec.src) ? worldOf(out.payload) : null;
  return { ...out, payload: w ? { ...rest, world: w } : rest };
}
