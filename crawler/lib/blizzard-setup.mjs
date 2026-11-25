// BlizzardUI worlds into Pantheon (BlizzardUI 2.40 part 8b; spec 2026-11-02, "Added 2026-11-04"). BlizzardUI's setup
// file ({format:"blizzardui-setup", setupVersion:1}) is the whole setup of a story: the title, the premise, the Next Main
// Event note, the tracker, Player Canon, the lorebook, padlocks and the cast archive. It publishes as a scenario every
// host can read (title, premise as overview and blurb, lorebook as lore; no intro, since BlizzardUI writes the opening
// when the story begins, and no cover), and it rides whole as `blizzardui` so Open in BlizzardUI starts from it.
import { worldOf } from "./world.mjs";
const BS_FORMAT = "blizzardui-setup";
const BS_BLURB_MAX = 300; // the publish form's blurb limit (PUB_LIMITS.blurb)
const bsStr = v => (typeof v === "string" ? v : v == null ? "" : String(v));
// Keys written as text are split on commas, the way BlizzardUI's own normalizeLorebook reads them.
const bsKeys = v => (Array.isArray(v) ? v : bsStr(v).split(",")).map(k => bsStr(k).trim()).filter(Boolean);

export function isBlizzardSetup(o) {
  return Boolean(o) && typeof o === "object" && !Array.isArray(o) && o.format === BS_FORMAT && Number(o.setupVersion) >= 1;
}

// The premise's whole sentences that fit in the blurb. A first sentence longer than that is cut at a word and marked.
function bsBlurb(text) {
  const t = bsStr(text).replace(/\s+/g, " ").trim();
  if (t.length <= BS_BLURB_MAX) return t;
  let out = "";
  for (const s of t.match(/[^.!?]+[.!?]+["'’”)]*\s*|[^.!?]+$/g) || []) { if ((out + s).trim().length > BS_BLURB_MAX) break; out += s; }
  out = out.trim(); if (out) return out;
  const cut = t.slice(0, BS_BLURB_MAX - 1); const sp = cut.lastIndexOf(" ");
  return (sp > 0 ? cut.slice(0, sp) : cut).replace(/[\s,;:]+$/, "") + "…";
}

// Each entry's title, keys, secondary keys, content, constant and order (BlizzardUI's priority); a disabled entry stays
// disabled, and one with no content is left out. Written in the shape a second read of the scenario gives back.
function bsLore(setup, title) {
  const entries = [];
  for (const e of Array.isArray(setup.lorebook) ? setup.lorebook : []) {
    if (!e || typeof e !== "object") continue;
    const content = bsStr(e.content); if (!content.trim()) continue;
    const keys = bsKeys(e.keys); const pr = Math.trunc(Number(e.priority));
    entries.push({ title: bsStr(e.title) || keys[0] || "entry " + (entries.length + 1), keys, secondary_keys: bsKeys(e.secondaryKeys), content, enabled: e.enabled !== false, constant: e.constant === true, position: null, insertion_order: Number.isFinite(pr) ? pr : entries.length });
  }
  return entries.length ? { name: title, description: "", entries } : null;
}

// A BlizzardUI world file (spec 2026-11-24, part 2) is a setup with three more blocks: meta (name, pitch, tags, creator),
// recommended (the app's own settings) and cover (an https poster). It reads as a World: the pitch is the vibe, the
// tracker's people are the cast, its stats and fields are what the world keeps track of, and the settings ride under
// "blizzardui". A setup without meta publishes exactly as before.
const bsHttps = v => (typeof v === "string" && v.length <= 300 && /^https:\/\/\S+$/.test(v.trim()) ? v.trim() : null);
const bsInt = v => { const n = typeof v === "string" && /^\s*\d+\s*$/.test(v) ? Number(v) : v; return Number.isInteger(n) && n >= 0 && n <= 999 ? n : null; };
const bsFirst = t => { const m = bsStr(t).replace(/\s+/g, " ").trim().match(/^[^.!?]+[.!?]*/); return m ? m[0].trim().slice(0, 200) : ""; };
function bsWorld(setup, meta, pitch) {
  const tr = setup.tracker && typeof setup.tracker === "object" ? setup.tracker : {};
  const cast = (Array.isArray(tr.npcs) ? tr.npcs : []).filter(n => n && typeof n === "object" && bsStr(n.name).trim()).map(n => ({ name: bsStr(n.name).trim(), age: bsInt(n.age), role: bsStr(n.role || n.occupation), look: bsStr(n.appearance || n.look), manner: bsStr(n.personality || n.manner), secret: bsStr(n.secrets || n.secret) }));
  const systems = [];
  for (const st of Array.isArray(tr.stats) ? tr.stats : []) if (st && typeof st === "object" && bsStr(st.name).trim()) systems.push({ label: bsStr(st.name).trim(), meaning: bsStr(st.note || st.meaning), change: bsStr(st.change) });
  for (const f of Array.isArray(tr.custom) ? tr.custom : []) if (f && typeof f === "object" && bsStr(f.label || f.name).trim()) systems.push({ label: bsStr(f.label || f.name).trim(), meaning: bsStr(f.hint || f.meaning || f.value), change: "" });
  const rec = setup.recommended && typeof setup.recommended === "object" && !Array.isArray(setup.recommended) ? setup.recommended : null;
  const art = rec && typeof rec.imageStyle === "string" ? rec.imageStyle : "";
  const opening = bsStr(meta.opening).trim();
  return worldOf({ world: { vibe: pitch || bsFirst(setup.premise), opening: opening ? { note: opening, mode: "plain" } : null, cast, systems, style: art ? { art } : null, credit: { author: bsStr(meta.creator).trim(), via: "BlizzardUI", url: null }, recommended: rec ? { blizzardui: rec } : null } });
}

export function scenarioFromBlizzardSetup(setup) {
  if (!isBlizzardSetup(setup)) return null;
  const meta = setup.meta && typeof setup.meta === "object" && !Array.isArray(setup.meta) ? setup.meta : null;
  const title = (meta && bsStr(meta.name).trim()) || bsStr(setup.title).trim(); if (!title) return null;
  const premise = bsStr(setup.premise).trim(); const pitch = meta ? bsStr(meta.pitch).replace(/\s+/g, " ").trim() : "";
  const tags = meta && Array.isArray(meta.tags) ? Array.from(new Set(meta.tags.map(t => bsStr(t).trim().toLowerCase().slice(0, 30)).filter(Boolean))).slice(0, 20) : [];
  const out = { title, blurb: bsBlurb(pitch || premise), intro: "", starters: [], tags, cover: meta ? bsHttps(setup.cover) : null, lore: bsLore(setup, title) };
  if (meta) { const w = bsWorld(setup, meta, pitch); if (w) out.world = w; }
  if (premise) out.overview = premise;
  out.from = { app: "blizzardui" };
  out.blizzardui = JSON.parse(JSON.stringify(setup));
  return out;
}
