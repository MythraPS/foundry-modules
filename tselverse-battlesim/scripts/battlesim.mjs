/**
 * Battle Simulator for Black Flag (2026-10-19).
 *
 * The GM puts creatures on a scene and runs "Simulate Battle". Sides are token dispositions. A Combat of the
 * simulator's own is made (never one already on the scene), initiative is rolled, and each turn the creature:
 *   - recharges its recharge abilities and, if legendary, gets its legendary actions back;
 *   - weighs every option it has against every enemy: Multiattack, single attacks, saving-throw abilities
 *     (single target or an area, counting allies it would catch), healing an ally, each with the movement it
 *     needs this turn; limited uses and recharges are honoured;
 *   - moves (square by square search, around other creatures, not through walls), plays the animation
 *     (Automated Animations when it knows the item, else a JB2A effect picked from the attack), rolls, and
 *     applies damage through Black Flag's own applyDamage, so resistances and immunities count;
 *   - then takes its best bonus action.
 * Legendary creatures spend legendary actions after other creatures' turns; Legendary Resistance turns a
 * failed save that matters into a success. Rolls go to a GM-only chat card (the roll review in bf-auto-damage
 * lets GM-only rolls through). Positions, hit points, uses and new effects are saved first; Reset puts them back.
 *
 * Black Flag 3.0.078 contracts used: AttackActivity#getAttackDetails().formula (to-hit bonus),
 * Activity#getDamageConfig().rolls ({parts, data, options: {damageType, magical}}), CONFIG.Dice.DamageRoll
 * (options.isCritical doubles dice), actor.calculateDamage / applyDamage(damages, {multiplier}),
 * system.save.dc.final, system.save.ability (a Set), item.system.uses {max, spent, recovery[{period, formula}]},
 * system.attributes.legendary {max, spent}.
 */
const MOD = "tselverse-battlesim";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => foundry.utils.escapeHTML(String(s ?? ""));
const ABIL = { str: "strength", dex: "dexterity", con: "constitution", int: "intelligence", wis: "wisdom", cha: "charisma" };
const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
// glide: tokens slide square by square (Foundry's move animation); off = they jump straight to the new square.
// instant: no pauses, no attack animations, no camera; the fight plays out as fast as Foundry can save it.
const SPEEDS = {
  slow: { act: 2200, move: 900, glide: true }, normal: { act: 1100, move: 600, glide: true }, fast: { act: 350, move: 250, glide: true },
  veryFast: { act: 80, move: 0, glide: false }, instant: { act: 0, move: 0, glide: false, instant: true }
};
const SPEED_LABELS = { slow: "Slow", normal: "Normal", fast: "Fast", veryFast: "Very fast (tokens jump, short pauses)", instant: "Instant (no animations, just the result)" };
const TEAM = { 1: "Friendly", 0: "Neutral", "-1": "Hostile", "-2": "Secret" };

const SCOPE = () => game.modules.get(MOD)?.active ? MOD : "world";
const state = { running: false, stop: false, combat: null, opts: null, fx: { aa: 0, jb2a: 0 } };

/* ------------------------------------------------------------------ */
/*  Reading a creature                                                */
/* ------------------------------------------------------------------ */

const plain = html => String(html ?? "").replace(/<[^>]+>/g, " ").replace(/\[\[[^\]]*\]\]/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

/** A number from a deterministic formula ("8 + 6"), 0 if it can't be read. */
function num(formula, data = {}) {
  try { return Number(new Roll(String(formula || "0"), data).evaluateSync({ strict: false }).total) || 0; } catch { return 0; }
}
/** Average of each damage part, as damage descriptions. */
function averages(rolls) {
  return rolls.map(r => {
    const f = r.parts.filter(Boolean).join(" + ") || "0";
    let lo = 0, hi = 0;
    try { lo = new Roll(f, r.data).evaluateSync({ minimize: true, strict: false }).total; hi = new Roll(f, r.data).evaluateSync({ maximize: true, strict: false }).total; } catch {}
    return { value: (lo + hi) / 2, type: r.options?.damageType, magical: !!r.options?.magical, rollType: "damage" };
  });
}
/** What a list of damages does to an actor, after its resistances and immunities. */
function damageTo(actor, damages, multiplier = 1) {
  const raw = damages.reduce((a, d) => a + d.value, 0) * multiplier;
  try { const c = actor.calculateDamage(foundry.utils.deepClone(damages), { multiplier }); return Number.isFinite(c?.amount) ? c.amount : raw; } catch { return raw; }
}

function usesLeft(item, act) {
  const iu = item.system.uses, au = act?.uses;
  const left = [];
  if (iu?.max) left.push(num(iu.max) - (iu.spent ?? 0));
  if (au?.max) left.push(num(au.max) - (au.spent ?? 0));
  return left.length ? Math.min(...left) : Infinity;
}
async function spendUse(item, act) {
  const iu = item.system.uses, au = act?.uses;
  if (iu?.max) await item.update({ "system.uses.spent": (iu.spent ?? 0) + 1 });
  else if (au?.max) await item.update({ [`system.activities.${act.id}.uses.spent`]: (au.spent ?? 0) + 1 });
}
const rechargeOf = u => (u?.recovery ?? []).find(r => r.period === "recharge");

function saveAbility(act, text) {
  const set = act.system?.save?.ability;
  const first = set instanceof Set ? [...set][0] : Array.isArray(set) ? set[0] : typeof set === "string" ? set : null;
  if (first) return ABIL[first] ?? first;
  const m = /\b(strength|dexterity|constitution|intelligence|wisdom|charisma)\b(?:\s*\(\w+\))?\s+sav/i.exec(text) ?? /\/save\s+(str|dex|con|int|wis|cha)/i.exec(act.item?.system?.description?.value ?? "");
  return m ? (ABIL[m[1].toLowerCase()] ?? m[1].toLowerCase()) : "dexterity";
}
/** The area an activity covers: from its template, else from its text ("in a 60-foot cone"). */
function areaOf(act, text) {
  const t = act.target?.template ?? {};
  const self = act.range?.unit === "self";
  const norm = type => ({ radius: "sphere", sphere: "sphere", cylinder: "sphere", circle: "sphere", emanation: "sphere", cube: "cube", square: "cube", cone: "cone", line: "line", wall: "line" })[type] ?? null;
  let type = norm(t.type), size = num(t.size), width = num(t.width) || 5;
  if (!type || !size) {
    const m = /(\d+)[- ]foot[- ](cone|line|radius|sphere|cube|cylinder|emanation|square)/i.exec(text)
      ?? /(cone|line|sphere|cube|cylinder)[^.]{0,20}?(\d+) feet/i.exec(text);
    if (m) { const a = /\d/.test(m[1]) ? m : [m[0], m[2], m[1]]; type = norm(a[2].toLowerCase()); size = Number(a[1]); }
    const w = /(\d+) feet wide/i.exec(text); if (w) width = Number(w[1]);
    if (!type && /each creature within (\d+) feet of (?:it|the|you|him|her)/i.test(text)) { type = "sphere"; size = Number(/each creature within (\d+) feet/i.exec(text)[1]); return { type, size, width, self: true }; }
  }
  if (!type || !size) return null;
  return { type, size, width, self: self || type === "cone" || type === "line" };
}
function rangeOf(act, text, melee) {
  const r = act.range ?? {};
  if (melee) return num(r.reach) || 5;
  if (r.unit === "touch") return 5;
  const v = num(r.long) || num(r.value) || num(r.short) || num(act.item?.system?.range?.long) || num(act.item?.system?.range?.short);
  if (v) return r.unit === "mile" ? v * 5280 : v;
  const m = /(?:range|within)\s+(\d+)\s*(?:ft|feet)/i.exec(text);
  return m ? Number(m[1]) : 60;
}

/** Every option a creature has, by the action it costs. */
function readFighter(token) {
  const actor = token.actor;
  const f = { token, doc: token.document, actor, name: token.name, team: token.document.disposition, options: [], multi: null, legendary: [], notes: [], dealt: 0, taken: 0, kills: 0 };
  const isPC = actor.type === "pc";
  const idle = new Set();
  for (const item of actor.items) {
    const text = plain(item.system.description?.value);
    for (const act of item.system.activities ?? []) {
      const at = act.activation?.type;
      if (!["action", "bonus", "legendary"].includes(at)) continue;
      const base = { item, act, name: item.name, cost: at, legendCost: at === "legendary" ? (num(act.activation.value) || 1) : 0 };
      if (item.type === "spell" && isPC && (item.system.circle?.base ?? 0) > 0 && !item.system.uses?.max) { f.notes.push(`${item.name} (spell slots not simulated)`); continue; }
      let dmg = [];
      try { dmg = act.getDamageConfig?.()?.rolls ?? []; } catch {}
      if (act.type === "attack") {
        const melee = (act.system?.attack?.type?.value ?? item.system.type?.value) !== "ranged";
        let toHit = 0; try { toHit = num(act.getAttackDetails().formula); } catch {}
        f.options.push({ ...base, kind: "attack", melee, spell: act.system?.attack?.type?.classification === "spell", toHit, reach: rangeOf(act, text, melee), dmg, avg: averages(dmg) });
      } else if (act.type === "save" && dmg.length) {
        const area = areaOf(act, text);
        const onSave = act.system?.damage?.onSave ?? (/half as much/i.test(text) ? "half" : "none");
        f.options.push({ ...base, kind: "save", ability: saveAbility(act, text), dc: num(act.system?.save?.dc?.final) || num(actor.system.spellcasting?.dc) || 13, half: onSave === "half",
          area, reach: area?.self ? area.size : rangeOf(act, text, false), dmg, avg: averages(dmg) });
      } else if (act.type === "heal" && dmg.length) {
        f.options.push({ ...base, kind: "heal", reach: rangeOf(act, text, false), dmg, avg: averages(dmg) });
      } else if (at === "legendary") {
        f.legendary.push({ ...base, kind: "proxy", text });
      } else if (!/^multiattack/i.test(item.name) && ["save", "utility", "effect", "summon", "cast"].includes(act.type) && at === "action") {
        idle.add(item);
      }
    }
  }
  for (const item of idle) if (!f.options.some(o => o.item === item)) f.notes.push(`${item.name} (no damage, not simulated)`);
  const attacks = f.options.filter(o => o.kind === "attack");
  const ma = actor.items.find(i => /^multiattack/i.test(i.name));
  if (ma) f.multi = parsePlan(plain(ma.system.description?.value), attacks);
  // Legendary actions that "make a Tail attack": the attack itself, at the legendary cost
  for (const l of f.legendary) {
    const plan = parsePlan(l.text, attacks);
    if (plan?.length) f.options.push({ ...l, kind: "proxy", plan });
  }
  for (const o of f.options) if (o.cost === "legendary" && o.kind !== "proxy") o.legendCost ||= 1;
  const lr = actor.items.find(i => /^legendary resistance/i.test(i.name));
  if (lr) f.legendRes = lr;
  return f;
}

/** "one Bite attack and two Claw attacks", "three attacks: one with its bite and two with its claws", "makes two attacks". */
function parsePlan(text, attacks) {
  const t = text.toLowerCase();
  const plan = [];
  for (const o of attacks) {
    const n = o.item.name.toLowerCase().replace(/\(.*?\)/g, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&").trim();
    if (!n) continue;
    const re = new RegExp(`\\b(a|an|one|two|three|four|five|six)\\s+(?:${n}s?\\b|(?:attacks?\\s+)?with\\s+(?:its|their|his|her)\\s+${n}s?\\b)`, "g");
    let c = 0; for (const m of t.matchAll(re)) c += NUM[m[1]];
    if (c && !plan.some(p => p.option.item === o.item)) plan.push({ option: o, count: c });
  }
  if (plan.length) return plan;
  const m = /makes (two|three|four|five|six|seven|eight) (?:(melee|ranged|weapon) )?attacks/.exec(t);
  if (m) return [{ option: null, count: NUM[m[1]], only: m[2] === "melee" ? "melee" : m[2] === "ranged" ? "ranged" : null }];
  return null;
}

/* ------------------------------------------------------------------ */
/*  The map                                                           */
/* ------------------------------------------------------------------ */

const G = () => ({ size: canvas.grid.size, dist: canvas.grid.distance });
/** A creature's footprint in grid squares, at its position or at {x, y} pixels. */
function box(f, at) {
  const { size } = G();
  const x = (at?.x ?? f.doc.x) / size, y = (at?.y ?? f.doc.y) / size;
  return { x, y, w: f.doc.width, h: f.doc.height };
}
const centerPx = (f, at) => { const { size } = G(); const b = box(f, at); return { x: (b.x + b.w / 2) * size, y: (b.y + b.h / 2) * size }; };
/** Feet between two footprints, as the game counts it (adjacent = 5 feet). */
function feet(a, b) {
  const gx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
  const gy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
  return (Math.round(Math.max(gx, gy)) + 1) * G().dist;
}
const overlaps = (a, b) => a.x < b.x + b.w - 0.01 && b.x < a.x + a.w - 0.01 && a.y < b.y + b.h - 0.01 && b.y < a.y + a.h - 0.01;
function blocked(from, to) {
  try {
    const backend = CONFIG.Canvas.polygonBackends?.move;
    return !!backend?.testCollision(from, to, { type: "move", mode: "any" });
  } catch { return false; }
}
const alive = f => (f.actor.system.attributes.hp.value ?? 0) > 0;
const speedOf = f => { const m = f.actor.system.traits?.movement?.types ?? {}; return Math.max(num(m.walk), num(m.fly), num(m.climb) / 2, num(m.swim) / 2, num(m.burrow) / 2, 0) || 30; };

/**
 * Where to stand this turn: the nearest square (fewest squares moved) from which `test(box)` holds, within
 * `budget` feet, not on another living creature, not through a wall, inside the scene. Falls back to the square
 * that gets closest to `toward` if none holds. Returns {x, y, moved, ok}.
 */
function findSpot(f, all, budget, test, toward, preferFar = false) {
  const { size, dist } = G();
  const here = box(f);
  if (test(here)) return { x: f.doc.x, y: f.doc.y, moved: 0, ok: true };
  const steps = Math.floor(budget / dist);
  const rect = canvas.dimensions.sceneRect;
  const others = all.filter(o => o !== f && alive(o)).map(o => box(o));
  const from = centerPx(f);
  const cands = [];
  const bx = Math.round(here.x), by = Math.round(here.y);
  for (let dx = -steps; dx <= steps; dx++) for (let dy = -steps; dy <= steps; dy++) {
    const b = { x: bx + dx, y: by + dy, w: here.w, h: here.h };
    const px = b.x * size, py = b.y * size;
    if (px < rect.x || py < rect.y || px + b.w * size > rect.x + rect.width || py + b.h * size > rect.y + rect.height) continue;
    if (others.some(o => overlaps(b, o))) continue;
    const ok = test(b);
    const moved = Math.max(Math.abs(dx), Math.abs(dy));
    const gap = toward ? feet(b, toward) : 0;
    cands.push({ x: px, y: py, b, moved, ok, gap });
  }
  const good = cands.filter(c => c.ok).sort((p, q) => p.moved - q.moved || (preferFar ? q.gap - p.gap : p.gap - q.gap));
  const near = cands.filter(c => !c.ok).sort((p, q) => p.gap - q.gap || p.moved - q.moved);
  for (const c of [...good, ...near]) {
    if (c.moved && blocked(from, centerPx(f, c))) continue;
    return { x: c.x, y: c.y, moved: c.moved * dist, ok: c.ok };
  }
  return { x: f.doc.x, y: f.doc.y, moved: 0, ok: false };
}

/** Creatures an area covers, cast from footprint `src` aimed at pixel point `aim`. */
function inArea(area, src, srcPx, aimPx, all, self) {
  const { size, dist } = G();
  const ppf = size / dist;
  const L = area.size * ppf;
  const srcR = (src.w * size) / 2;
  return all.filter(o => o !== self && alive(o)).filter(o => {
    const c = centerPx(o), r = (o.doc.width * size) / 2;
    if (area.type === "sphere") {
      const at = area.self ? srcPx : aimPx;
      return Math.hypot(c.x - at.x, c.y - at.y) <= L + (area.self ? srcR : 0) + r * 0.6;
    }
    if (area.type === "cube") {
      const h = L / 2;
      return Math.abs(c.x - aimPx.x) <= h + r * 0.6 && Math.abs(c.y - aimPx.y) <= h + r * 0.6;
    }
    const dir = Math.atan2(aimPx.y - srcPx.y, aimPx.x - srcPx.x);
    const vx = c.x - srcPx.x, vy = c.y - srcPx.y;
    const along = vx * Math.cos(dir) + vy * Math.sin(dir);
    const across = Math.abs(-vx * Math.sin(dir) + vy * Math.cos(dir));
    if (along < 0 || along > L + srcR + r * 0.6) return false;
    if (area.type === "line") return across <= (area.width * ppf) / 2 + r * 0.6;
    return across <= Math.max(0, along - srcR) * 0.5 + r * 0.6;   // cone: width = distance (53°)
  });
}

/* ------------------------------------------------------------------ */
/*  Choosing                                                          */
/* ------------------------------------------------------------------ */

const enemiesOf = (f, all) => all.filter(o => o.team !== f.team && alive(o));
const alliesOf = (f, all) => all.filter(o => o.team === f.team && alive(o));
const acOf = a => num(a.system.attributes.ac?.value) || 10;
const saveMod = (a, ab) => num(a.system.abilities?.[ab]?.save?.mod ?? a.system.abilities?.[ab]?.mod);
const pHit = (toHit, ac) => Math.min(0.95, Math.max(0.05, (21 + toHit - ac) / 20));
const pFail = (dc, mod) => Math.min(1, Math.max(0, (dc - 1 - mod) / 20));
const worth = (exp, hp) => Math.min(exp, hp) + (exp >= hp ? 4 : 0);
function attackValue(o, t) { return pHit(o.toHit, acOf(t.actor)) * damageTo(t.actor, o.avg); }
function saveValue(o, t) {
  const full = damageTo(t.actor, o.avg), p = pFail(o.dc, saveMod(t.actor, o.ability));
  return p * full + (1 - p) * (o.half ? full / 2 : 0);
}
/** "Vicious Bound (44 HP or Fewer)", "Fury (Bloodied)": only when the creature itself is that hurt. */
function gateOK(f, o) {
  const hp = f.actor.system.attributes.hp, n = o.item.name;
  const m = /\((\d+)\s*(?:HP|hit points) or (?:fewer|less)\)/i.exec(n);
  if (m) return hp.value <= Number(m[1]);
  if (/\(bloodied\)/i.test(n)) return hp.value <= hp.max / 2;
  const more = /\((\d+)\s*(?:HP|hit points) or more\)/i.exec(n);
  if (more) return hp.value >= Number(more[1]);
  return true;
}
const usable = (f, o) => gateOK(f, o) && usesLeft(o.item, o.act) > 0 && (o.cost !== "legendary" || legendLeft(f) >= (o.legendCost || 1));
const legendLeft = f => { const l = f.actor.system.attributes.legendary; return l?.max ? (l.max - (l.spent ?? 0)) : 0; };

/** The best thing to do with an action (cost "action"/"bonus"/"legendary"), with where to stand. */
function choose(f, all, cost, budget) {
  const foes = enemiesOf(f, all), friends = alliesOf(f, all);
  if (!foes.length) return null;
  let best = null;
  const take = p => { if (p.score > 0 && (!best || p.score > best.score)) best = p; };
  const opts = f.options.filter(o => o.cost === cost && usable(f, o));
  for (const t of foes) {
    const tb = box(t), hp = t.actor.system.attributes.hp.value;
    for (const o of opts) {
      if (o.kind === "attack") {
        const spot = findSpot(f, all, budget, b => feet(b, tb) <= o.reach, tb, !o.melee);
        if (!spot.ok) continue;
        take({ kind: "attack", option: o, target: t, spot, score: worth(attackValue(o, t), hp) });
      } else if (o.kind === "proxy") {
        const a = o.plan[0]?.option; if (!a) continue;
        if (feet(box(f), tb) > a.reach) continue;            // legendary actions don't move
        take({ kind: "proxy", option: o, target: t, spot: { x: f.doc.x, y: f.doc.y, moved: 0, ok: true }, score: worth(attackValue(a, t) * o.plan[0].count, hp) / (o.legendCost || 1) });
      } else if (o.kind === "save") {
        if (!o.area) {
          const spot = findSpot(f, all, budget, b => feet(b, tb) <= o.reach, tb, true);
          if (!spot.ok) continue;
          take({ kind: "save", option: o, targets: [t], aim: centerPx(t), spot, score: worth(saveValue(o, t), hp) });
          continue;
        }
        const reach = o.area.self ? o.area.size : o.reach + o.area.size;
        const spot = cost === "legendary" ? (feet(box(f), tb) <= reach ? { x: f.doc.x, y: f.doc.y, moved: 0, ok: true } : { ok: false })
          : findSpot(f, all, budget, b => feet(b, tb) <= reach, tb, true);
        if (!spot.ok) continue;
        const sb = box(f, spot), sp = centerPx(f, spot);
        const aim = centerPx(t);
        const hit = inArea(o.area, sb, sp, aim, all.map(x => x === f ? x : x), f);
        let score = 0;
        for (const h of hit) {
          const v = saveValue(o, h), hhp = h.actor.system.attributes.hp.value;
          score += h.team === f.team ? -1.5 * Math.min(v, hhp) : worth(v, hhp);
        }
        take({ kind: "save", option: o, targets: hit, aim, spot, score: score * (o.item.system.uses?.max && !rechargeOf(o.item.system.uses) ? 0.9 : 1) });
      }
    }
  }
  // Multiattack: the whole sequence, at the target the first attack goes for
  if (cost === "action" && f.multi?.length) {
    for (const t of foes) {
      const tb = box(t), hp = t.actor.system.attributes.hp.value;
      const steps = f.multi.flatMap(p => {
        if (p.option && !gateOK(f, p.option)) return [];
        const o = p.option ?? f.options.filter(x => x.kind === "attack" && x.cost === "action" && gateOK(f, x) && (!p.only || (p.only === "melee") === x.melee))
          .sort((a, b) => attackValue(b, t) - attackValue(a, t))[0];
        return o ? Array(p.count).fill(o) : [];
      });
      if (!steps.length) continue;
      const reach = Math.min(...steps.map(s => s.reach));
      const spot = findSpot(f, all, budget, b => feet(b, tb) <= reach, tb, !steps[0].melee);
      if (!spot.ok) continue;
      const exp = steps.reduce((a, s) => a + attackValue(s, t), 0);
      take({ kind: "multi", steps, target: t, spot, score: worth(exp, hp) + Math.max(0, exp - hp) * 0.5 });
    }
  }
  // Healing a hurt ally (below half)
  for (const o of opts.filter(o => o.kind === "heal")) {
    for (const a of friends) {
      const hp = a.actor.system.attributes.hp; if (hp.value > hp.max / 2) continue;
      const ab = box(a);
      const spot = findSpot(f, all, budget, b => feet(b, ab) <= o.reach, ab);
      if (!spot.ok) continue;
      const amount = o.avg.reduce((x, d) => x + d.value, 0);
      take({ kind: "heal", option: o, target: a, spot, score: Math.min(amount, hp.max - hp.value) * 1.2 });
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/*  Animations                                                        */
/* ------------------------------------------------------------------ */

const COLOR = { fire: "orange", cold: "blue", lightning: "blue", acid: "green", poison: "green", necrotic: "purple", radiant: "yellow", force: "purple", psychic: "pink", thunder: "blue" };
const seqOK = () => game.modules.get("sequencer")?.active && window.Sequence && window.Sequencer;
const has = p => { try { return Sequencer.Database.entryExists(p); } catch { return false; } };
const pick = (...paths) => paths.find(has);

async function animate(f, plan, results) {
  if (!state.opts.animations || SPEEDS[state.opts.speed].instant) return;
  const src = f.token;
  const targets = (plan.targets ?? [plan.target]).filter(Boolean).map(t => t.token);
  const hits = results.filter(r => r.hit).map(r => r.target.token);
  const item = plan.option?.item ?? plan.item;
  // Automated Animations first: it knows many items by name
  if (state.opts.useAA && game.modules.get("autoanimations")?.active && window.AutomatedAnimations && item) {
    try { const h = await AutomatedAnimations.playAnimation(src, item, { targets, hitTargets: hits, hit: hits.length > 0 }); if (h) { state.fx.aa++; return; } } catch {}
  }
  if (!seqOK()) return;
  const o = plan.option ?? {};
  const type = o.avg?.[0]?.type ?? "slashing", color = COLOR[type] ?? "orange";
  const name = (item?.name ?? "").toLowerCase();
  const seq = new Sequence();
  try {
    if (plan.kind === "heal") {
      seq.effect().file(pick(`jb2a.healing_generic.burst.tealyellow`, "jb2a.healing_generic.burst", "jb2a.cure_wounds")).atLocation(targets[0]).scaleToObject(1.8);
    } else if (plan.kind === "save" && o.area) {
      const a = o.area, sizePx = a.size * (canvas.grid.size / canvas.grid.distance);
      if (a.type === "cone") seq.effect().file(pick(`jb2a.breath_weapons.${type}.cone.${color}`, `jb2a.breath_weapons.${type}.cone`, `jb2a.cone_of_cold.${color}`, "jb2a.breath_weapons.fire.cone.orange")).atLocation(src).stretchTo(plan.aim);
      else if (a.type === "line") seq.effect().file(pick(`jb2a.breath_weapons.${type}.line.${color}`, `jb2a.breath_weapons.${type}.line`, `jb2a.lightning_bolt.wide.${color}`, "jb2a.lightning_bolt.wide")).atLocation(src).stretchTo(plan.aim);
      else {
        const at = a.self ? src : plan.aim;
        const file = type === "fire" ? pick(`jb2a.fireball.explosion.orange`) : type === "thunder" ? pick("jb2a.thunderwave.center") : type === "necrotic" ? pick("jb2a.toll_the_dead.purple.shockwave")
          : pick(`jb2a.explosion.01.${color}`, "jb2a.explosion.01");
        if (a.type === "sphere" && type === "fire" && !a.self) seq.effect().file(pick("jb2a.fireball.beam.orange", "jb2a.fireball.beam")).atLocation(src).stretchTo(at).waitUntilFinished(-800);
        seq.effect().file(file).atLocation(at).size(sizePx * 2 + (a.self ? f.doc.width * canvas.grid.size : 0));
      }
    } else {
      for (const t of targets) {
        const hit = hits.includes(t);
        if (plan.kind === "save") { seq.effect().file(type === "necrotic" ? pick("jb2a.toll_the_dead.purple.skull_smoke") : pick(`jb2a.impact.001.${color}`, "jb2a.impact.001")).atLocation(t).scaleToObject(1.5); continue; }
        const melee = o.melee !== false;
        if (melee) {
          const file = /bite|jaw|fang|maw/.test(name) ? pick(`jb2a.bite.400px.red`, "jb2a.bite.400px")
            : /claw|talon|rake/.test(name) ? pick(`jb2a.claws.400px.red`, "jb2a.claws.400px")
            : /fist|unarmed|slam|punch|kick/.test(name) ? pick("jb2a.unarmed_strike.physical")
            : type === "bludgeoning" ? pick("jb2a.melee_generic.bludgeoning.one_handed") : type === "piercing" ? pick("jb2a.melee_generic.piercing.one_handed")
            : pick("jb2a.melee_generic.slash.01.orange", "jb2a.melee_attack.01.trail");
          if (/bite|claw|talon|fist|unarmed|slam|punch|kick|jaw|fang|maw|rake/.test(name)) seq.effect().file(file).atLocation(t).scaleToObject(1.4);
          else seq.effect().file(file).atLocation(src).stretchTo(t);
        } else {
          const file = o.spell
            ? ({ fire: "jb2a.fire_bolt.orange", cold: "jb2a.ray_of_frost.blue", force: "jb2a.eldritch_blast.purple", necrotic: "jb2a.spell_projectile.skull", radiant: "jb2a.guiding_bolt", poison: "jb2a.spell_projectile.poison", lightning: "jb2a.lightning_bolt.narrow" })[type]
            : /bolt|crossbow/.test(name) ? "jb2a.bolt.physical.white" : /javelin|spear|dagger|axe|hammer|rock|boulder/.test(name) ? (/rock|boulder/.test(name) ? "jb2a.throwable.throw.boulder" : "jb2a.dagger.throw") : "jb2a.arrow.physical.white";
          seq.effect().file(pick(file, "jb2a.magic_missile.purple", "jb2a.arrow.physical.white")).atLocation(src).stretchTo(t).missed(!hit);
        }
        if (!hit) seq.effect().file(pick("jb2a.ui.miss.white", "jb2a.ui.miss")).atLocation(t).scaleToObject(1).delay(250);
      }
    }
    state.fx.jb2a++;
    await seq.play();
  } catch (e) { console.warn(`${MOD} | animation`, e); }
}

/* ------------------------------------------------------------------ */
/*  Doing                                                             */
/* ------------------------------------------------------------------ */

async function rollDamage(option, crit = false, multiplier = 1) {
  const rolls = [];
  for (const r of option.dmg) {
    const f = r.parts.filter(Boolean).join(" + ") || "0";
    const R = new CONFIG.Dice.DamageRoll(f, r.data, { ...foundry.utils.deepClone(r.options ?? {}), isCritical: crit });
    await R.evaluate();
    rolls.push(R);
  }
  return rolls;
}
const describe = rolls => rolls.map(r => `${r.total} ${r.options?.damageType ?? ""}`.trim()).join(" + ");
const descs = rolls => rolls.map(r => ({ value: r.total, type: r.options?.damageType, magical: !!r.options?.magical, rollType: "damage" }));

async function hurt(f, t, damages, multiplier = 1) {
  const before = t.actor.system.attributes.hp.value;
  await t.actor.applyDamage(foundry.utils.deepClone(damages), { multiplier });
  const after = t.actor.system.attributes.hp.value;
  const lost = Math.max(0, before - after);
  f.dealt += lost; t.taken += lost;
  if (before > 0 && after <= 0) { f.kills++; await down(t); }
  return { lost, after };
}
async function down(t) {
  const c = state.combat?.combatants.find(c => c.tokenId === t.doc.id);
  if (c) await c.update({ defeated: true });
  line(`<b>${esc(t.name)}</b> ${t.actor.type === "pc" ? "falls unconscious" : "is slain"}.`, "down");
}

async function doAttack(f, o, t, crit0) {
  const d20 = await new Roll(`1d20 + ${o.toHit}`).evaluate();
  const nat = d20.dice[0]?.total ?? 0, ac = acOf(t.actor);
  const crit = nat === 20, hit = crit || (nat !== 1 && d20.total >= ac);
  const res = { target: t, hit, crit };
  await animate(f, { kind: "attack", option: o, target: t }, [res]);
  let txt = `${esc(o.name)} → <b>${esc(t.name)}</b>: ${d20.total} vs AC ${ac} `;
  if (!hit) txt += `<span style="color:#888">${nat === 1 ? "miss (natural 1)" : "miss"}</span>`;
  else {
    const rolls = await rollDamage(o, crit);
    const { lost, after } = await hurt(f, t, descs(rolls));
    txt += `<b style="color:${crit ? "#c50" : "#2a7"}">${crit ? "CRITICAL" : "hit"}</b>, ${describe(rolls)} = <b>${lost}</b> (${Math.max(0, after)} HP left)`;
  }
  line(txt);
  return res;
}

async function doSave(f, o, targets, aim) {
  const rolls = await rollDamage(o);
  const damages = descs(rolls);
  const results = [];
  const parts = [];
  for (const t of targets) {
    const mod = saveMod(t.actor, o.ability);
    const r = await new Roll(`1d20 + ${mod}`).evaluate();
    let ok = r.total >= o.dc, why = "";
    if (!ok && t.legendRes && usesLeft(t.legendRes) > 0 && damageTo(t.actor, damages) >= t.actor.system.attributes.hp.max * 0.15) {
      await spendUse(t.legendRes); ok = true; why = " (Legendary Resistance)";
    }
    results.push({ target: t, hit: !ok, ok, roll: r.total, why });
  }
  await animate(f, { kind: "save", option: o, targets, aim }, results);
  for (const r of results) {
    const mult = r.ok ? (o.half ? 0.5 : 0) : 1;
    let lost = 0, after = r.target.actor.system.attributes.hp.value;
    if (mult) ({ lost, after } = await hurt(f, r.target, damages, mult));
    parts.push(`<b>${esc(r.target.name)}</b> ${r.roll}${r.ok ? ` saves${r.why}` : " fails"} → <b>${lost}</b>${mult ? ` (${Math.max(0, after)} HP left)` : ""}`);
  }
  line(`${esc(o.name)} (DC ${o.dc} ${o.ability.slice(0, 3).toUpperCase()}${o.area ? `, ${o.area.size}-ft ${o.area.type}` : ""}): ${describe(rolls)}<br>${parts.join("<br>") || "no one caught"}`);
  return results;
}

async function doHeal(f, o, t) {
  const rolls = await rollDamage(o);
  await animate(f, { kind: "heal", option: o, target: t }, [{ target: t, hit: true }]);
  const before = t.actor.system.attributes.hp.value;
  await t.actor.applyDamage(descs(rolls));
  line(`${esc(o.name)} → <b>${esc(t.name)}</b> heals ${t.actor.system.attributes.hp.value - before} (${t.actor.system.attributes.hp.value} HP)`);
}

async function moveTo(f, spot) {
  if (!spot || (spot.x === f.doc.x && spot.y === f.doc.y)) return;
  const sp = SPEEDS[state.opts.speed];
  await f.doc.update({ x: spot.x, y: spot.y }, { animate: sp.glide });
  // Foundry 14 writes the new position once the move animation ends: wait for it, or reach is judged from the old square
  for (let i = 0; i < 100 && (f.doc.x !== spot.x || f.doc.y !== spot.y); i++) await sleep(sp.glide ? 50 : 10);
  if (sp.move) await sleep(sp.move / 3);
}

async function perform(f, plan, all) {
  await moveTo(f, plan.spot);
  if (plan.kind === "multi") {
    line(`<i>Multiattack</i>`);
    for (const o of plan.steps) {
      if (state.stop) return;
      let t = alive(plan.target) && feet(box(f), box(plan.target)) <= o.reach ? plan.target
        : enemiesOf(f, all).filter(e => feet(box(f), box(e)) <= o.reach).sort((a, b) => a.actor.system.attributes.hp.value - b.actor.system.attributes.hp.value)[0];
      if (!t) continue;
      await doAttack(f, o, t);
      if (SPEEDS[state.opts.speed].act) await sleep(SPEEDS[state.opts.speed].act / 2);
    }
    return;
  }
  const o = plan.option;
  if (plan.kind === "proxy") {
    for (const p of o.plan) for (let i = 0; i < p.count; i++) if (alive(plan.target)) await doAttack(f, p.option ?? o, plan.target);
  } else if (plan.kind === "attack") await doAttack(f, o, plan.target);
  else if (plan.kind === "heal") await doHeal(f, o, plan.target);
  else if (plan.kind === "save") {
    let targets = plan.targets;
    if (o.area) targets = inArea(o.area, box(f), centerPx(f), plan.aim, all, f);
    await doSave(f, o, targets, plan.aim);
  }
  await spendUse(o.item, o.act);
  if (o.cost === "legendary") await f.actor.update({ "system.attributes.legendary.spent": (f.actor.system.attributes.legendary.spent ?? 0) + (o.legendCost || 1) });
}

/* ------------------------------------------------------------------ */
/*  Chat                                                              */
/* ------------------------------------------------------------------ */

let buffer = [], speaker = null;
function line(html, cls = "") { buffer.push(`<div class="bs-line ${cls}" style="margin:2px 0">${html}</div>`); }
async function flush(title) {
  if (!buffer.length) return;
  const content = `<div class="${MOD}">${title ? `<h4 style="margin:0 0 3px">${title}</h4>` : ""}${buffer.join("")}</div>`;
  buffer = [];
  const whisper = state.opts.publicChat ? [] : (state.opts.whisper ?? game.users.filter(u => u.isGM).map(u => u.id));
  await ChatMessage.implementation.create({ content, speaker: speaker ?? ChatMessage.getSpeaker(), whisper, flags: { [MOD]: { log: true } } });
}

/* ------------------------------------------------------------------ */
/*  Snapshot and reset                                                */
/* ------------------------------------------------------------------ */

function snapshot(fighters) {
  return fighters.map(f => ({
    token: f.doc.id, x: f.doc.x, y: f.doc.y, rotation: f.doc.rotation,
    hp: foundry.utils.deepClone(f.actor._source.system.attributes.hp),
    legendary: f.actor._source.system.attributes.legendary?.spent ?? null,
    items: f.actor.items.map(i => ({ id: i.id, spent: i._source.system.uses?.spent ?? null,
      acts: Object.fromEntries(Object.entries(i._source.system.activities ?? {}).map(([k, a]) => [k, a.uses?.spent ?? null])) })),
    effects: f.actor.effects.map(e => e.id)
  }));
}
export async function reset(scene = canvas.scene) {
  const snap = scene?.getFlag(SCOPE(), "snapshot");
  if (!snap?.length) return ui.notifications.warn("Battle Simulator: nothing to reset on this scene.");
  if (state.running) { state.stop = true; await sleep(500); }
  for (const s of snap) {
    const doc = scene.tokens.get(s.token); if (!doc?.actor) continue;
    const a = doc.actor;
    await doc.update({ x: s.x, y: s.y, rotation: s.rotation }, { animate: false });
    // Black Flag keeps hp.damage beside hp.value and works value out from it, so both go back
    // (field by field: an unlinked token's actor ignores a whole-object hp update)
    const up = { "system.attributes.hp.value": s.hp.value, "system.attributes.hp.temp": s.hp.temp ?? null,
      "system.attributes.hp.tempMax": s.hp.tempMax ?? null, "system.attributes.hp.damage": s.hp.damage ?? 0 };
    if (s.legendary !== null) up["system.attributes.legendary.spent"] = s.legendary;
    await a.update(up);
    const items = s.items.filter(i => a.items.get(i.id)).map(i => {
      const u = { _id: i.id };
      if (i.spent !== null) u["system.uses.spent"] = i.spent;
      for (const [k, v] of Object.entries(i.acts)) if (v !== null) u[`system.activities.${k}.uses.spent`] = v;
      return u;
    });
    if (items.length) await a.updateEmbeddedDocuments("Item", items);
    // effects the battle added (the dead-tokens module may be taking its own off at the same moment)
    await sleep(150);
    for (const e of a.effects.filter(e => !s.effects.includes(e.id))) { try { if (a.effects.get(e.id)) await e.delete(); } catch {} }
    for (const st of ["dead", "unconscious", "defeated"]) if (a.statuses?.has(st)) try { await a.toggleStatusEffect(st, { active: false }); } catch {}
  }
  await scene.unsetFlag(SCOPE(), "snapshot");
  ui.notifications.info("Battle Simulator: the battle is reset.");
}

/* ------------------------------------------------------------------ */
/*  The battle                                                        */
/* ------------------------------------------------------------------ */

export async function simulate(opts = {}) {
  if (!game.user.isGM) return ui.notifications.warn("Only the GM can run the Battle Simulator.");
  if (state.running) return ui.notifications.warn("A battle is already running. Use Stop Battle first.");
  const scene = canvas.scene;
  if (game.combats.some(c => c.scene?.id === scene.id && !c.flags?.[MOD]?.sim))
    return ui.notifications.warn("This scene already has a combat. End it, or run the simulation on another scene.");
  if (opts.speed && !SPEEDS[opts.speed]) opts.speed = "normal";
  state.opts = foundry.utils.mergeObject({ speed: "normal", maxRounds: 20, animations: true, useAA: true, publicChat: false, follow: true, autoReset: false, tokens: null }, opts);
  const picked = state.opts.tokens ?? (canvas.tokens.controlled.length >= 2 ? canvas.tokens.controlled : canvas.tokens.placeables.filter(t => !t.document.hidden));
  const fighters = picked.filter(t => t.actor && (t.actor.system.attributes?.hp?.max ?? 0) > 0 && t.actor.system.attributes.hp.value > 0).map(readFighter);
  const teams = [...new Set(fighters.map(f => f.team))];
  if (teams.length < 2) return ui.notifications.warn("Battle Simulator: the creatures need at least two sides. Set token dispositions (friendly / neutral / hostile).");

  state.running = true; state.stop = false; state.fx = { aa: 0, jb2a: 0 };
  await scene.setFlag(SCOPE(), "snapshot", snapshot(fighters));
  // initiative
  for (const f of fighters) {
    const mod = num(f.actor.system.attributes.initiative?.mod ?? f.actor.system.abilities?.dexterity?.mod);
    f.init = (await new Roll(`1d20 + ${mod}`).evaluate()).total + mod / 100;
  }
  fighters.sort((a, b) => b.init - a.init);
  const combat = await Combat.implementation.create({ scene: scene.id, active: true, flags: { [MOD]: { sim: true } } });
  state.combat = combat;
  await combat.createEmbeddedDocuments("Combatant", fighters.map(f => ({ tokenId: f.doc.id, sceneId: scene.id, actorId: f.actor.id, initiative: Math.floor(f.init) })));
  await combat.update({ round: 1, turn: 0 });
  line(fighters.map(f => `${esc(f.name)} <span style="color:#888">(${TEAM[f.team] ?? f.team}, initiative ${Math.floor(f.init)})</span>`).join("<br>"));
  const skipped = [...new Set(fighters.flatMap(f => f.notes.map(n => `${f.name}: ${n}`)))];
  if (skipped.length) line(`<details><summary>Not simulated (${skipped.length})</summary>${skipped.map(esc).join("<br>")}</details>`);
  await flush("Battle begins");

  const sp = SPEEDS[state.opts.speed];
  let round = 1, winner = null;
  try {
    outer: for (; round <= state.opts.maxRounds; round++) {
      for (let i = 0; i < fighters.length; i++) {
        if (state.stop) break outer;
        const f = fighters[i];
        if (!alive(f)) continue;
        const ct = combat.turns.findIndex(c => c.tokenId === f.doc.id);
        if (ct >= 0) await combat.update({ round, turn: ct });
        if (state.opts.follow && !sp.instant) canvas.animatePan({ ...centerPx(f), duration: 400 });
        speaker = ChatMessage.getSpeaker({ token: f.doc });
        // start of turn: recharges and legendary actions back
        for (const o of f.options) {
          const rc = rechargeOf(o.item.system.uses);
          if (rc && (o.item.system.uses.spent ?? 0) > 0) {
            const r = await new Roll("1d6").evaluate();
            if (r.total >= (num(rc.formula) || 6)) { await o.item.update({ "system.uses.spent": 0 }); line(`${esc(o.name)} recharges (${r.total}).`); }
          }
        }
        if (f.actor.system.attributes.legendary?.max) await f.actor.update({ "system.attributes.legendary.spent": 0 });
        const speed = speedOf(f);
        let plan = choose(f, fighters, "action", speed);
        if (plan) await perform(f, plan, fighters);
        else {
          // nothing in reach: dash toward the nearest enemy
          const foes = enemiesOf(f, fighters);
          if (!foes.length) { winner = f.team; break outer; }
          const near = foes.sort((a, b) => feet(box(f), box(a)) - feet(box(f), box(b)))[0];
          const spot = findSpot(f, fighters, speed * 2, () => false, box(near));
          await moveTo(f, spot);
          line(`${esc(f.name)} moves toward ${esc(near.name)}.`);
        }
        if (!state.stop && alive(f)) {
          const bonus = choose(f, fighters, "bonus", 0);
          if (bonus) await perform(f, bonus, fighters);
        }
        await flush(`Round ${round}: ${esc(f.name)}`);
        if (sp.act) await sleep(sp.act);
        // legendary actions from the others, one each after this turn
        for (const l of fighters) {
          if (l === f || !alive(l) || state.stop || legendLeft(l) <= 0) continue;
          const lp = choose(l, fighters, "legendary", 0);
          if (!lp) continue;
          speaker = ChatMessage.getSpeaker({ token: l.doc });
          line(`<i>Legendary action</i>`);
          await perform(l, lp, fighters);
          await flush(`Round ${round}: ${esc(l.name)} (legendary)`);
          if (sp.act) await sleep(sp.act / 2);
        }
        const standing = new Set(fighters.filter(alive).map(x => x.team));
        if (standing.size <= 1) { winner = [...standing][0] ?? null; break outer; }
      }
    }
  } catch (e) {
    console.error(`${MOD} | battle failed`, e);
    ui.notifications.error(`Battle Simulator stopped on an error: ${e.message}`);
  } finally {
    state.running = false;
    speaker = null;
    const rows = fighters.map(f => {
      const hp = f.actor.system.attributes.hp;
      return `<tr><td>${esc(f.name)}</td><td>${TEAM[f.team] ?? f.team}</td><td>${Math.max(0, hp.value)}/${hp.max}</td><td>${f.dealt}</td><td>${f.taken}</td><td>${f.kills}</td></tr>`;
    }).join("");
    const head = state.stop ? "Stopped" : winner !== null ? `${TEAM[winner] ?? winner} side wins` : `No winner after ${state.opts.maxRounds} rounds`;
    line(`<b>${head}</b>${!state.stop && winner !== null ? ` in round ${Math.min(round, state.opts.maxRounds)}` : ""}.`);
    line(`<table style="font-size:0.9em"><tr><th>Creature</th><th>Side</th><th>HP</th><th>Dealt</th><th>Taken</th><th>Kills</th></tr>${rows}</table>`);
    line(`<button type="button" data-action="${MOD}-reset" style="margin-top:4px"><i class="fa-solid fa-rotate-left"></i> Reset battle</button>`);
    await flush("Battle over");
    try { await combat.delete(); } catch {}
    state.combat = null;
    if (state.opts.autoReset) await reset(scene);
  }
  return { winner, round, fx: { ...state.fx }, fighters: fighters.map(f => ({ name: f.name, team: f.team, hp: f.actor.system.attributes.hp.value, dealt: f.dealt, taken: f.taken })) };
}

export function stop() { if (state.running) { state.stop = true; ui.notifications.info("Battle Simulator: stopping after this action."); } }

/** The setup window. */
export async function start() {
  if (!game.user.isGM) return ui.notifications.warn("Only the GM can run the Battle Simulator.");
  const picked = canvas.tokens.controlled.length >= 2 ? canvas.tokens.controlled : canvas.tokens.placeables.filter(t => !t.document.hidden);
  const list = picked.filter(t => t.actor && (t.actor.system.attributes?.hp?.max ?? 0) > 0 && t.actor.system.attributes.hp.value > 0);
  const byTeam = {};
  for (const t of list) (byTeam[TEAM[t.document.disposition] ?? t.document.disposition] ??= []).push(t.name);
  const teams = Object.entries(byTeam).map(([k, v]) => `<p><b>${k}:</b> ${v.map(esc).join(", ")}</p>`).join("");
  const content = `
    <p>${canvas.tokens.controlled.length >= 2 ? "The selected tokens fight." : "Every visible token on this scene fights (select two or more to choose)."} Sides are token dispositions.</p>
    ${teams || "<p>No creatures.</p>"}
    <div class="form-group"><label>Speed</label><select name="speed">${Object.entries(SPEED_LABELS).map(([k, v]) => `<option value="${k}"${k === "normal" ? " selected" : ""}>${v}</option>`).join("")}</select></div>
    <div class="form-group"><label>Rounds at most</label><input type="number" name="maxRounds" value="20" min="1" max="100"></div>
    <div class="form-group"><label>Animations</label><input type="checkbox" name="animations" checked></div>
    <div class="form-group"><label>Camera follows the turn</label><input type="checkbox" name="follow" checked></div>
    <div class="form-group"><label>Players see the rolls</label><input type="checkbox" name="publicChat"></div>
    <div class="form-group"><label>Reset when it ends</label><input type="checkbox" name="autoReset"></div>`;
  const res = await foundry.applications.api.DialogV2.wait({
    window: { title: "Simulate Battle", icon: "fa-solid fa-swords" }, content, rejectClose: false,
    buttons: [{ action: "go", label: "Fight", icon: "fa-solid fa-play", default: true,
      callback: (ev, btn) => { const fd = new foundry.applications.ux.FormDataExtended(btn.form).object; return fd; } }, { action: "cancel", label: "Cancel" }]
  });
  if (!res || res === "cancel") return;
  return simulate({ speed: res.speed, maxRounds: Number(res.maxRounds) || 20, animations: !!res.animations, follow: !!res.follow, publicChat: !!res.publicChat, autoReset: !!res.autoReset, tokens: list });
}

/* ------------------------------------------------------------------ */
/*  Hooks and macros                                                  */
/* ------------------------------------------------------------------ */

/** Foundry 14 dropped BaseGrid#getCenter(x, y) -> [x, y]; Automated Animations 6.6.2 still calls it for melee
 *  range and crashes. Put it back on top of getCenterPoint. */
export function gridShim() {
  const proto = foundry.grid?.BaseGrid?.prototype;
  if (proto && typeof proto.getCenter !== "function" && typeof proto.getCenterPoint === "function")
    proto.getCenter = function (x, y) { const c = this.getCenterPoint({ x, y }); return [c.x, c.y]; };
  // measureDistances(segments [{ray}], options) -> [feet]: the v11 API, from measurePath
  if (proto && typeof proto.measureDistances !== "function" && typeof proto.measurePath === "function")
    proto.measureDistances = function (segments) { return segments.map(s => this.measurePath([s.ray.A, s.ray.B]).distance); };
}
Hooks.once("init", () => { gridShim(); game.modules.get(MOD).api = { start, simulate, stop, reset }; });

/** The simulator does recharges and legendary actions itself; Black Flag's own turn-start recovery would roll them
 *  again and post the rolls (which the GM roll review then holds). Only for the simulator's combat. */
export function recoveryHook(combatant) { if (combatant?.combat?.flags?.[MOD]?.sim) return false; }
Hooks.on("blackFlag.preCombatRecovery", recoveryHook);

Hooks.on("renderChatMessageHTML", (msg, html) => {
  html.querySelector?.(`[data-action="${MOD}-reset"]`)?.addEventListener("click", () => game.user.isGM && reset());
});

const MACROS = [
  { key: "start", name: "Simulate Battle", img: "icons/skills/melee/weapons-crossed-swords-yellow.webp", command: `game.modules.get("${MOD}").api.start();` },
  { key: "stop", name: "Stop Battle", img: "icons/svg/cancel.svg", command: `game.modules.get("${MOD}").api.stop();` },
  { key: "reset", name: "Reset Battle", img: "icons/svg/clockwise.svg", command: `game.modules.get("${MOD}").api.reset();` }
];
Hooks.once("ready", async () => {
  if (!game.user.isGM || game.users.activeGM?.id !== game.user.id) return;
  let folder = game.folders.find(f => f.type === "Macro" && f.getFlag(MOD, "folder"));
  if (!folder) folder = await Folder.implementation.create({ name: "Battle Simulator", type: "Macro", flags: { [MOD]: { folder: true } } });
  for (const m of MACROS) {
    if (game.macros.find(x => x.getFlag(MOD, "key") === m.key)) continue;
    await Macro.implementation.create({ name: m.name, type: "script", img: m.img, command: m.command, folder: folder.id, flags: { [MOD]: { key: m.key } } });
  }
});
