// The adapter path language (spec §6). Deliberately tiny; no evaluation, no code.
//   a.b.c      nested property
//   a[]        map over array
//   a[].b      pluck b from each element (flattens one level if b is an array)
//   x|y        first alternative that is non-empty
//   {field}    inside a template string: raw substitution from the object
//   {field~u}  the same, URL-encoded as one component (a file name with spaces or brackets)
//   {field~p}  the same, encoded segment by segment so its slashes stay (a repository path)
//              A ~u or ~p field that is empty makes the whole template undefined: a link that cannot be built is
//              left out instead of pointing at a bare prefix.
//   A map value that starts with https:// or http:// and has no braces is a literal, the same for every row.
const isEmpty = v => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

function walk(obj, segments) {
  let cur = obj;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (cur === null || cur === undefined) return undefined;
    if (seg.endsWith("[]")) {
      const key = seg.slice(0, -2);
      const arr = key === "" ? cur : cur[key];
      if (!Array.isArray(arr)) return undefined;
      const rest = segments.slice(i + 1);
      if (rest.length === 0) return arr;
      const out = [];
      for (const el of arr) {
        const v = walk(el, rest);
        if (Array.isArray(v)) out.push(...v); else if (v !== undefined) out.push(v);
      }
      return out;
    }
    if (typeof cur !== "object") return undefined;
    cur = cur[seg];
  }
  return cur;
}

export function get(obj, path) {
  if (typeof path !== "string" || path === "") return undefined;
  for (const alt of path.split("|")) {
    const v = walk(obj, alt.trim().split("."));
    if (!isEmpty(v)) return v;
  }
  return undefined;
}

const encodeAs = (mode, v) => (mode === "u" ? encodeURIComponent(v) : v.split("/").map(encodeURIComponent).join("/"));
const MOD = /^(.*)~([up])$/;
export function template(str, obj) {
  return String(str).replace(/\{([^}]+)\}/g, (_, p) => {
    const mod = MOD.exec(p);
    const v = get(obj, mod ? mod[1] : p);
    if (v === undefined || v === null) return "";
    return mod ? encodeAs(mod[2], String(v)) : String(v);
  });
}
// True when a template holds a ~u or ~p field the row has no value for.
const missingEncoded = (str, obj) => {
  for (const m of String(str).matchAll(/\{([^}]+)\}/g)) {
    const mod = MOD.exec(m[1]);
    if (mod) { const v = get(obj, mod[1]); if (v === undefined || v === null || v === "") return true; }
  }
  return false;
};

export function mapFields(map, raw) {
  const out = {};
  for (const [k, expr] of Object.entries(map)) {
    if (typeof expr !== "string") continue;
    if (expr.includes("{")) out[k] = missingEncoded(expr, raw) ? undefined : template(expr, raw);
    else if (/^https?:\/\//.test(expr)) out[k] = expr;
    else out[k] = get(raw, expr);
  }
  return out;
}
