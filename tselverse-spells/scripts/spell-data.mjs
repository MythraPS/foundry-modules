/**
 * Plain-text spell logic shared by the Foundry module (in the browser) and by
 * `foundry-import`'s pack builder (in node). No Foundry globals in here.
 *
 *   parseSpellcasting(text) - read an "Innate Spellcasting" / "Spellcasting" trait:
 *                             ability, DC, attack bonus and the spell names grouped by uses.
 *   spellSystem(d)          - turn a parsed spell (casting, range, duration, body text) into
 *                             Black Flag spell `system` data with working activities.
 */

export const ABILITIES = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"];
export const DAMAGE_TYPES = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
  "piercing", "poison", "psychic", "radiant", "slashing", "thunder"];

/** Strip HTML and Black Flag enrichers down to the words a reader sees. */
export function plainText(html) {
  return String(html ?? "")
    .replace(/\[\[\/\w+\s*([^\]]*)\]\](?:\{([^}]*)\})?/g, (m, args, label) => label ?? args)
    .replace(/@\w+\[[^\]]*\](?:\{([^}]*)\})?/g, (m, label) => label ?? "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>\s*<p[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#39;|&rsquo;/g, "’").replace(/&quot;/g, "\"");
}

/* ------------------------------------------------------------------ spellcasting traits */

// "At will:", "Cantrips (at will):", "3/day each:", "1/day:", "2/long rest each:",
// "1st level (4 slots):" -- each starts a group that runs to the next label.
const GROUP_RE = new RegExp(
  "(?:\\b(cantrips?\\s*\\(at will\\)|at[- ]will)" +
  "|\\b(\\d+)\\s*\\/\\s*(day|long rest|short rest|encounter)(?:\\s+each)?" +
  "|\\b(\\d+)(?:st|nd|rd|th)[- ](?:level|circle)\\s*\\((\\d+)\\s*slots?\\))\\s*:", "gi");

const PERIODS = { "day": "longRest", "long rest": "longRest", "short rest": "shortRest", "encounter": "encounter" };

export function isSpellcastingName(name) {
  return /\bspellcasting\b/i.test(String(name ?? ""));
}

/**
 * @returns {{ability: string|null, dc: number|null, attack: number|null,
 *            groups: {label: string, uses: number|null, period: string|null, names: string[]}[]}}
 */
export function parseSpellcasting(text) {
  const t = plainText(text).replace(/\s+/g, " ");
  const out = { ability: null, dc: null, attack: null, groups: [] };
  const ab = new RegExp(`spellcasting ability is (${ABILITIES.join("|")})`, "i").exec(t);
  if (ab) out.ability = ab[1].toLowerCase();
  const dc = /spell save DC\s*(\d+)/i.exec(t) ?? /\bDC\s*(\d+)/i.exec(t);
  if (dc) out.dc = Number(dc[1]);
  const atk = /([+-]\d+)\s+to hit with spell attacks/i.exec(t);
  if (atk) out.attack = Number(atk[1]);

  const marks = [...t.matchAll(GROUP_RE)];
  marks.forEach((m, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].index : t.length;
    let chunk = t.slice(m.index + m[0].length, end);
    // The last group ends at the sentence that follows it ("... Synaptic Static. The seraph can ...").
    chunk = chunk.split(/\.\s+(?=[A-Z])|\.\s*$/)[0];
    const names = chunk.split(/,|;|\band\b/)
      .map(s => s.replace(/\([^)]*\)/g, "").replace(/[*†‡.]/g, "").trim())
      .filter(s => /^[A-Za-z][A-Za-z'’\- ]{1,48}$/.test(s));
    let uses = null, period = null;
    if (m[2]) { uses = Number(m[2]); period = PERIODS[m[3].toLowerCase()]; }
    out.groups.push({ label: m[0].replace(/:$/, "").trim(), uses, period, names });
  });
  return out;
}

/* ------------------------------------------------------------------ spell activities */

const FT = "(?:foot|feet|ft\\.?)";
const n = s => String(Number(s));

/** Area of effect from spell prose, in Black Flag's template shape, or null. */
export function spellArea(text) {
  const t = String(text ?? "");
  // Only the sizes a shape uses, as Black Flag stores its own (Thunderwave's cube has no
  // width key at all). An empty `width: ""` on a cube - drawn as a ray - failed Foundry's
  // LineShapeData check ("width: must be a number") and the template never placed.
  const tpl = (type, size, extra = {}) => {
    const t = { count: 1, contiguous: false, type, size: n(size), unit: "foot" };
    for (const [k, v] of Object.entries(extra)) if (v !== "" && v != null) t[k] = v;
    return t;
  };
  let m;
  if ((m = new RegExp(`(\\d+)[- ]${FT}[- ]cone`, "i").exec(t))) return tpl("cone", m[1]);
  if ((m = new RegExp(`cone (?:that is |of )?(\\d+) ${FT}`, "i").exec(t))) return tpl("cone", m[1]);
  if ((m = new RegExp(`line[^.]{0,40}?(\\d+) ${FT} long and (\\d+) ${FT} wide`, "i").exec(t)))
    return tpl("line", m[1], { width: n(m[2]) });
  if ((m = new RegExp(`(\\d+)[- ]${FT}[- ]long,? (\\d+)[- ]${FT}[- ]wide line`, "i").exec(t)))
    return tpl("line", m[1], { width: n(m[2]) });
  if ((m = new RegExp(`(\\d+)[- ]${FT}[- ]line`, "i").exec(t))) {
    const w = new RegExp(`(\\d+)[- ]${FT}[- ]wide`, "i").exec(t);
    return tpl("line", m[1], { width: n(w ? w[1] : 5) });
  }
  if ((m = new RegExp(`(\\d+)[- ]${FT}[- ]radius,? (\\d+)[- ]${FT}[- ](?:high|tall) cylinder`, "i").exec(t)))
    return tpl("cylinder", m[1], { height: n(m[2]) });
  if ((m = new RegExp(`cylinder (?:that is )?(\\d+) ${FT} wide and (\\d+) ${FT} (?:high|tall)`, "i").exec(t)))
    return tpl("cylinder", Math.floor(Number(m[1]) / 2), { height: n(m[2]) });
  if ((m = new RegExp(`cylinder (?:that is |with a )?(\\d+)[- ]${FT}(?:[- ]radius| in radius)`, "i").exec(t))) {
    const h = new RegExp(`(\\d+) ${FT} (?:high|tall)`, "i").exec(t);
    return tpl("cylinder", m[1], { height: h ? n(h[1]) : "" });
  }
  if ((m = new RegExp(`(\\d+)[- ]${FT}[- ]cube`, "i").exec(t))) return tpl("cube", m[1]);
  if ((m = new RegExp(`cube (?:that is )?(\\d+) ${FT}`, "i").exec(t))) return tpl("cube", m[1]);
  if ((m = new RegExp(`(\\d+)[- ]${FT}[- ]square`, "i").exec(t))) return tpl("square", m[1]);
  if ((m = new RegExp(`(\\d+)[- ]${FT}[- ]radius sphere|sphere (?:with a |that has a )?(\\d+)[- ]${FT}[- ]radius`, "i").exec(t)))
    return tpl("sphere", m[1] ?? m[2]);
  if ((m = new RegExp(`(\\d+)[- ]${FT}[- ]radius`, "i").exec(t)))
    return tpl(/centered on (?:you|yourself|the caster)|emanat/i.test(t) ? "radius" : "sphere", m[1]);
  if ((m = new RegExp(`(\\d+)[- ]${FT}[- ]sphere`, "i").exec(t))) return tpl("sphere", m[1]);
  return null;
}

let seq = 0;
/** 16-character activity id: prefix + a deterministic counter keeps builds stable. */
function actId(prefix) {
  return (prefix + "Act" + String(seq++).padStart(16, "0")).replace(/[^A-Za-z0-9]/g, "").slice(0, 16).padEnd(16, "0");
}

function baseActivity(type, id, casting) {
  return {
    _id: id, type, name: "", img: "", description: "", flags: {}, sort: 0, magical: true,
    activation: { type: casting?.type ?? "action", value: casting?.value ?? null, condition: casting?.condition ?? "", override: false, primary: true },
    consumption: { scale: { allowed: false, max: "" }, targets: [] },
    duration: { concentration: false, override: false, special: "", value: "", unit: "" },
    range: { override: false, special: "", value: "", unit: "" },
    target: { affects: { choice: false, special: "", type: "", count: "" },
      template: { count: "", contiguous: false, type: "", size: "", width: "", height: "", unit: "" },
      override: false, prompt: true },
    uses: { max: "", recovery: [], spent: 0, consumeQuantity: false },
    visibility: { level: {}, requireAttunement: false, requireIdentification: false, requireMagic: false },
    system: {}
  };
}

function damagePart(num, den, bonus, type, scales) {
  return { number: Number(num), denomination: Number(den), bonus: bonus ?? "", type,
    additionalTypes: [], custom: { enabled: false, formula: "" },
    scaling: { mode: scales ? "whole" : "", number: scales ? 1 : null, formula: "" } };
}

/**
 * @param {object} d  {name, level, school, casting:{type,value}, range:{units,value},
 *                     duration:{units,value}, concentration, components[], material, tags[], body}
 * @param {string} idPrefix  stable prefix for activity ids (the spell's own id works)
 */
export function spellSystem(d, idPrefix = "TSV") {
  seq = 0;
  const body = plainText(d.body);
  const [main, higher = ""] = body.split(/\bAt Higher (?:Levels|Circles)\b\.?/i);
  // "1 reaction, which you take when you are hit by a melee attack": the trigger is the
  // reaction's condition
  const cond = d.casting?.type === "reaction"
    ? (/reaction,?\s*(?:which you take\s*|that you take\s*)?(.*)$/i.exec(d.casting_raw ?? "")?.[1] ?? "").trim() : "";
  const casting = { type: d.casting?.type ?? "action", value: d.casting?.value ?? null, condition: cond };
  const scales = /increases? by \d+d\d+/i.test(higher);

  const dmgRe = new RegExp(`(\\d+)d(\\d+)(?:\\s*\\+\\s*(\\d+))?\\)?\\s+(${DAMAGE_TYPES.join("|")})\\s+damage`, "gi");
  const parts = [], seen = new Set();
  for (const m of main.matchAll(dmgRe)) {
    const key = m.slice(1).join("|").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key); parts.push(damagePart(m[1], m[2], m[3] ?? "", m[4].toLowerCase(), scales));
  }

  const activities = {};
  const add = a => { activities[a._id] = a; return a; };
  const ABBR = { str: "strength", dex: "dexterity", con: "constitution",
                 int: "intelligence", wis: "wisdom", cha: "charisma" };
  // 5E: "a Dexterity saving throw". Tales of the Valiant: "a DEX save".
  let saveM = new RegExp(`(${ABILITIES.join("|")}) (?:saving throw|save)`, "i").exec(main);
  if (!saveM) {
    const abbr = /\b(STR|DEX|CON|INT|WIS|CHA)\s+save\b/.exec(main);
    if (abbr) saveM = [abbr[0], ABBR[abbr[1].toLowerCase()]];
  }
  const atkM = /\b(melee|ranged) spell attack/i.exec(main);
  const healM = /regains?\s+(?:a number of\s+)?hit points equal to\s+(\d+)d(\d+)(\s*\+\s*your spellcasting ability modifier)?/i.exec(main)
             ?? /regains?\s+(\d+)d(\d+)(\s*\+\s*your spellcasting ability modifier)?\s+hit points/i.exec(main);
  const tempM = /(\d+)d(\d+)(\s*\+\s*your spellcasting ability modifier)?\s+temporary hit points/i.exec(main);

  if (atkM) {
    const a = add(baseActivity("attack", actId(idPrefix), casting));
    a.system = { attack: { ability: "", bonus: "", critical: {}, flat: false,
                           type: { value: atkM[1].toLowerCase(), classification: "spell" } },
                 damage: { critical: {}, includeBase: true, parts }, effects: [] };
  }
  if (saveM) {
    const a = add(baseActivity("save", actId(idPrefix), casting));
    a.system = { damage: { onSave: /half as much damage/i.test(main) ? "half" : "none", parts: atkM ? [] : parts },
                 effects: [],
                 save: { ability: [saveM[1].toLowerCase()], bonus: "", dc: { ability: "", formula: "" }, visible: true } };
  }
  if (healM || tempM) {
    const h = healM ?? tempM;
    const a = add(baseActivity("heal", actId(idPrefix), casting));
    a.system = { effects: [], healing: { ...damagePart(h[1], h[2], h[3] ? "@mod" : "", healM ? "healing" : "temp", scales) } };
  }
  if (!atkM && !saveM && parts.length) {
    const a = add(baseActivity("damage", actId(idPrefix), casting));
    a.system = { damage: { critical: { allow: false, bonus: "" }, parts }, effects: [] };
  }
  if (!Object.keys(activities).length) add(baseActivity("utility", actId(idPrefix), casting)).system = { effects: [], roll: { formula: "", name: "", prompt: false, visible: false } };
  // Only the first activity is "primary": it is the one the cast button runs and the one uses are spent from.
  Object.values(activities).forEach((a, i) => { a.activation.primary = i === 0; });

  const template = spellArea(main);
  const count = /\b(?:up to )?(one|two|three|four|five|six|\d+) (?:creatures?|targets?)/i.exec(main);
  const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
  const tags = [...new Set([...(d.tags ?? []), ...(d.concentration ? ["concentration"] : [])])];

  return {
    activities,
    uses: { spent: 0, consumeQuantity: false, recovery: [], min: "", max: "" },
    type: { value: "standard" },
    circle: { value: null, base: d.level ?? 1 },
    casting: { value: casting.value, type: casting.type, condition: casting.condition },
    components: { required: d.components ?? [],
      material: { cost: null, description: d.material ?? "", consumed: false, denomination: "gp" } },
    duration: { units: d.duration?.units ?? "instantaneous", value: d.duration?.value ?? "" },
    tags,
    target: {
      template: template ?? { count: 1, contiguous: false, type: "", unit: "foot" },
      affects: { choice: false, type: template || count ? "creature" : "",
                 count: !template && count ? String(words[count[1].toLowerCase()] ?? count[1]) : "", special: "" }
    },
    range: { units: d.range?.units ?? "self", value: d.range?.value ?? "", special: "" },
    school: d.school ?? "evocation",
    // Which magic source the spell belongs to. Tales of the Valiant builds class spell
    // lists from this, so a wyrd spell shows up for warlocks and witches.
    source: d.sources ?? []
  };
}

/** Name of a search a player can open in a new tab to find a spell's text. */
export function searchQuery(name, suffix = "ToV Tales of the Valiant") {
  return `${name} ${suffix}`.trim();
}

/* ------------------------------------------------------------------ pasted spell text
 * A spell copied from a PDF or a web page, in either format:
 *   Tales of the Valiant:  "3rd-Circle Arcane, Divine (Evocation)" / "Arcane Cantrip (Evocation)"
 *   5E:                    "3rd-level evocation (ritual)" / "Evocation cantrip"
 * then "Casting Time: / Range: / Components: / Duration:" and the description. Mirrors the
 * importer's parse_spell (foundry-import), which reads the same fields out of a book.
 * Returns the fields spellSystem() takes, plus `warnings` for anything it couldn't find. */
const SCHOOLS = ["abjuration", "conjuration", "divination", "enchantment", "evocation", "illusion", "necromancy", "transmutation"];
const SOURCES = ["arcane", "divine", "primordial", "wyrd"];
export function parseSpellText(text, { fallbackSource = "arcane" } = {}) {
  const lines = String(text ?? "").replace(/\r/g, "").split("\n").map(l => l.trim());
  const warnings = [];
  const nonEmpty = lines.filter(Boolean);
  const title = nonEmpty[0] ?? "";
  const name = title === title.toUpperCase()
    ? title.toLowerCase().replace(/(^|[\s(-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()).replace(/\b(Of|The|And|A|An|In|On|To)\b(?!$)/g, w => w.toLowerCase()).replace(/^./, c => c.toUpperCase())
    : title;
  const d = { name, level: 1, school: "evocation", sources: [], tags: [], warnings };
  const schoolRe = SCHOOLS.join("|");
  const tov = new RegExp(`^(?:(\\d+)(?:st|nd|rd|th)-(?:Circle\\s+)?(.+?)|(.+?)\\s+Cantrip)(\\s+Ritual)?\\s*\\((${schoolRe})\\)\\s*$`, "i");
  const five = new RegExp(`^(?:(\\d)(?:st|nd|rd|th)[- ]level\\s+(${schoolRe})|(${schoolRe})\\s+cantrip)((?:\\s*[(\\[][^)\\]]+[)\\]])*)\\s*$`, "i");
  let headerAt = -1;
  for (let i = 0; i < Math.min(lines.length, 6); i++) {
    let m = tov.exec(lines[i]);
    if (m) {
      const raw = (m[2] ?? m[3] ?? "").toLowerCase();
      const srcs = SOURCES.filter(s => new RegExp(`\\b${s}\\b`).test(raw));
      if (srcs.length) {
        d.level = m[1] ? Number(m[1]) : 0; d.sources = srcs; d.school = m[5].toLowerCase();
        if (m[4]) d.tags.push("ritual");
        headerAt = i; break;
      }
    }
    m = five.exec(lines[i]);
    if (m) {
      d.level = m[1] ? Number(m[1]) : 0;
      d.school = (m[2] ?? m[3]).toLowerCase();
      if (/ritual/i.test(m[4] ?? "")) d.tags.push("ritual");
      // 5E names no magic source - unless one is written in its brackets ("cantrip (divine)")
      const named = SOURCES.filter(s => new RegExp(`\\b${s}\\b`, "i").test(m[4] ?? ""));
      d.sources = named.length ? named : [fallbackSource];
      if (!named.length) warnings.push(`5E spell: no magic source printed, so it is ${fallbackSource}`);
      headerAt = i; break;
    }
  }
  // written loosely ("1st-circle arcane evocation", "Evocation cantrip (divine)"): a circle or level
  // number or "cantrip", and a school name, anywhere on one of the first lines
  for (let i = 0; headerAt < 0 && i < Math.min(lines.length, 6); i++) {
    const school = new RegExp(`\\b(${schoolRe})\\b`, "i").exec(lines[i]);
    const num = /\b(\d)(?:st|nd|rd|th)[- ]?(?:circle|level)\b/i.exec(lines[i]);
    if (!school || !(num || /\bcantrip\b/i.test(lines[i]))) continue;
    d.level = num ? Number(num[1]) : 0;
    d.school = school[1].toLowerCase();
    if (/\britual\b/i.test(lines[i])) d.tags.push("ritual");
    const srcs = SOURCES.filter(s => new RegExp(`\\b${s}\\b`, "i").test(lines[i]));
    d.sources = srcs.length ? srcs : [fallbackSource];
    if (!srcs.length) warnings.push(`no magic source on its circle line, so it is ${fallbackSource}`);
    headerAt = i;
  }
  if (headerAt < 0) warnings.push("circle/school line not found - treated as a 1st-circle evocation");

  const grab = re => { const i = lines.findIndex(l => re.test(l)); return i < 0 ? [null, -1] : [lines[i].replace(re, "").trim(), i]; };
  const [ct, ctAt] = grab(/^Casting Time:?\s*/i);
  const [rg, rgAt] = grab(/^Range:?\s*/i);
  let [cp, cpAt] = grab(/^Components?(?::\s*|\s+(?=[VSM]\b))/i);
  const [du, duAt] = grab(/^Duration:?\s*/i);
  // "M (a 1-inch piece of green vine, which" / "grows ...)" - a material that wraps
  let cpEnd = cpAt;
  while (cp && (cp.match(/\(/g) ?? []).length > (cp.match(/\)/g) ?? []).length && cpEnd + 1 < lines.length) cp += " " + lines[++cpEnd];

  d.casting_raw = ct ?? "";
  const cunit = /bonus action/i.test(ct ?? "") ? "bonus" : /reaction/i.test(ct ?? "") ? "reaction"
    : /minute/i.test(ct ?? "") ? "minute" : /hour/i.test(ct ?? "") ? "hour" : "action";
  const cnum = /(\d+)/.exec(ct ?? "");
  d.casting = { type: cunit, value: ["minute", "hour"].includes(cunit) && cnum ? Number(cnum[1]) : null };
  if (!ct) warnings.push("Casting Time not found");

  const rn = /(\d+)\s*(feet|foot|ft|mile)/i.exec(rg ?? "");
  d.range = rn ? { units: /mile/i.test(rn[2]) ? "mile" : "foot", value: rn[1] }
    : /\bself\b/i.test(rg ?? "") ? { units: "self", value: "" }
    : /\btouch\b/i.test(rg ?? "") ? { units: "touch", value: "" } : { units: rg ? "special" : "self", value: "" };
  if (!rg) warnings.push("Range not found");

  d.components = [];
  if (/\bV\b/.test(cp ?? "")) d.components.push("verbal");
  if (/\bS\b/.test(cp ?? "")) d.components.push("somatic");
  if (/\bM\b/.test(cp ?? "")) d.components.push("material");
  d.material = /\bM\b\s*\(([^)]*)\)/.exec(cp ?? "")?.[1]?.trim() ?? "";
  if (!cp) warnings.push("Components not found");

  d.concentration = /concentration/i.test(du ?? "");
  const dn = /(\d+)\s*(round|minute|hour|day)s?/i.exec(du ?? "");
  d.duration = /instantaneous/i.test(du ?? "") || !du ? { units: "instantaneous", value: "" }
    : dn ? { units: dn[2].toLowerCase(), value: dn[1] } : { units: "special", value: "" };
  if (!du) warnings.push("Duration not found");

  // the description: everything after the last field line, paragraphs split at blank lines
  const last = Math.max(headerAt, ctAt, rgAt, cpEnd, duAt, 0);
  const paras = [];
  let cur = [];
  for (const l of lines.slice(last + 1)) {
    if (!l) { if (cur.length) paras.push(cur.join(" ")); cur = []; continue; }
    // a line that starts a new thought on its own ("At Higher Circles.", a bullet)
    if (cur.length && (/^(At Higher (Circles|Levels)|[•\-*] )/.test(l))) { paras.push(cur.join(" ")); cur = []; }
    cur.push(l);
  }
  if (cur.length) paras.push(cur.join(" "));
  // undo end-of-line hyphenation ("sub- stance")
  d.body = paras.map(p => p.replace(/(\w)- (\w)/g, "$1$2")).join("\n\n");
  if (!d.body) warnings.push("no description text");
  return d;
}

/** The pasted text as an unsaved spell Item the add dialog can preview and add. */
export function spellFromText(text, opts = {}) {
  const d = parseSpellText(text, opts);
  const esc = s => foundry.utils.escapeHTML(s);
  const html = d.body.split(/\n\n/).map(p => `<p>${esc(p)}</p>`).join("");
  const item = new CONFIG.Item.documentClass({
    name: d.name || "New Spell", type: "spell", img: "icons/magic/symbols/runes-star-blue.webp",
    system: { ...spellSystem(d), description: { value: html } }
  });
  return { item, warnings: d.warnings };
}
