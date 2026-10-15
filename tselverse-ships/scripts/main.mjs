/**
 * Ship Bridge - ship combat from Dark Matter Sci-Fi 5E (2026), Ships chapter pp 220-224, on Black Flag.
 *
 * A ship is a Black Flag vehicle actor carrying `flags["tselverse-ships"]` (foundry-import writes it from
 * the stat block; a GM can make any vehicle a ship from its sheet header). The sheet stays as it is:
 *   hit points       = Mega Hit Points
 *   temporary hp     = Shield Points
 * and this module adds what the sheet has no place for.
 *
 *   Shields     regain half their maximum when a new round starts; cover ONE side of the ship. Damage
 *               from an attacker standing off another side goes straight to the hull.
 *   Crew Roles  Captain, Engineer, Gunner, Pilot: who holds which, and a button for each action.
 *   0 MHP       Explosion Saving Throws: three successes a derelict wreck, three failures an explosion.
 *   Movement    the cone of movement as a region from the ship's front, as wide as its Maneuverability.
 *
 * The book's three new skills are played as skills the sheet has (the table's ruling, 2026-10-11):
 * Technology = Arcana, Piloting = Survival, Data = History. A check keeps the ability the book prints,
 * so Evasive Maneuvers is Dexterity (Survival).
 *
 * Players rarely own the ship actor, so every change to it is done by the GM's client (socket).
 */
const MOD = "tselverse-ships";
const DC = 15;
const SIDES = {front: 0, right: 90, rear: 180, left: -90};        // degrees clockwise from the bow
const SIDE_LABEL = {front: "Front", right: "Right", rear: "Rear", left: "Left"};
const ROLES = {captain: {label: "Captain", icon: "fa-star", one: true}, engineer: {label: "Engineer", icon: "fa-wrench"},
               gunner: {label: "Gunner", icon: "fa-crosshairs"}, pilot: {label: "Pilot", icon: "fa-gauge-high", one: true}};
const ARC = "__tsvShipShield";

const esc = s => foundry.utils.escapeHTML(String(s ?? ""));
const F = a => a?.flags?.[MOD] ?? {};
const isShip = a => a?.type === "vehicle" && !!F(a).ship;
const hpOf = a => a.system.attributes.hp;
const norm180 = d => { d = ((d + 180) % 360 + 360) % 360 - 180; return d === -180 ? 180 : d; };
const norm360 = d => ((d % 360) + 360) % 360;
const DialogV2 = foundry.applications.api.DialogV2;

/* ------------------------------------------------------------------ ships and their crews */
function allShips() {
  const out = game.actors.filter(isShip);
  for (const t of canvas?.scene?.tokens ?? []) if (!t.actorLink && isShip(t.actor)) out.push(t.actor);
  return out;
}
function crewOf(ship, role) {
  return (F(ship).crew?.[role] ?? []).map(u => fromUuidSync(u)).filter(Boolean);
}
const hasCrew = ship => Object.keys(ROLES).some(r => crewOf(ship, r).length);
const roleOf = (ship, actor) => Object.keys(ROLES).find(r => (F(ship).crew?.[r] ?? []).includes(actor.uuid));
const shipOf = actor => allShips().find(s => roleOf(s, actor));
function tokenOf(ship) {
  if (ship.token) return ship.token;                                      // (an unlinked token's own actor)
  const here = ship.getActiveTokens(false, true)[0];                      // a TokenDocument on the scene being viewed
  if (here) return here;
  // not on this client's scene (the GM's client does the work for a player looking at another one)
  for (const sc of [game.combat?.scene, game.scenes.active, ...game.scenes].filter(Boolean)) {
    const t = sc.tokens.find(x => x.actorId === ship.id && x.actorLink);
    if (t) return t;
  }
  return null;
}
const hasSystem = (ship, re) => (F(ship).systems ?? []).some(s => re.test(s));
const disabled = (ship, name) => hpOf(ship).value <= 0 || (F(ship).disabled ?? []).includes(name);

/* ------------------------------------------------------------------ GM-side work (socket) */
const OPS = {
  async flags(uuid, data) { const a = await fromUuid(uuid); return a ? (await a.update({[`flags.${MOD}`]: data}), true) : false; },
  async hp(uuid, data) {
    const a = await fromUuid(uuid); if (!a) return false;
    const hp = hpOf(a), up = {};
    if ("temp" in data) up["system.attributes.hp.temp"] = Math.clamp(Math.floor(data.temp), 0, Math.max(F(a).shieldMax ?? 0, 0));
    if ("heal" in data) {
      const v = Math.min(hp.max, hp.value + Math.max(0, Math.floor(data.heal)));
      up["system.attributes.hp.value"] = v; up["system.attributes.hp.damage"] = Math.max(0, hp.max - v);
    }
    await a.update(up); return true;
  },
  // Foundry 14 draws areas as Regions; its cone shape is given in pixels and degrees.
  async cone(tokenUuid, mode) {
    const t = await fromUuid(tokenUuid); if (!t?.actor) return false;
    await OPS.clearCone(tokenUuid);
    const f = F(t.actor), g = t.parent.grid, px = feet => feet / g.distance * g.size;
    const x = t.x + t.width * g.size / 2, y = t.y + t.height * g.size / 2;
    const feet = mode === "evasive" ? 500 : (f.speed || 0) * (mode === "half" ? 0.5 : 1);
    if (!feet) return false;
    const angle = Math.clamp(f.maneuverability || 90, 1, 360);
    const shape = mode === "evasive" || angle >= 360 ? {type: "circle", x, y, radius: px(feet)}
      : {type: "cone", x, y, radius: px(feet), angle, rotation: norm360(t.rotation + 90), curvature: "round"};
    await t.parent.createEmbeddedDocuments("Region", [{name: `${mode === "evasive" ? "Evasive Maneuvers" : "Cone of movement"}: ${t.name} (${feet.toLocaleString()} ft.)`,
      color: "#3fa7d6", visibility: CONST.REGION_VISIBILITY.ALWAYS, highlightMode: "coverage", displayMeasurements: true, shapes: [shape],
      flags: {[MOD]: {cone: t.id, mode}}}]);
    return true;
  },
  async clearCone(tokenUuid) {
    const t = await fromUuid(tokenUuid); if (!t) return false;
    const ids = t.parent.regions.filter(m => m.flags?.[MOD]?.cone === t.id).map(m => m.id);
    if (ids.length) await t.parent.deleteEmbeddedDocuments("Region", ids);
    return true;
  },
  async rotate(tokenUuid, delta) {
    const t = await fromUuid(tokenUuid); if (!t) return false;
    await t.update({rotation: norm360(t.rotation + delta)}); return true;
  }
};
const pending = new Map();
Hooks.once("ready", () => {
  game.socket.on(`module.${MOD}`, async msg => {
    if (msg.reply && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); return msg.error ? p.reject(new Error(msg.error)) : p.resolve(msg.result); }
    if (!msg.op || !game.users.activeGM?.isSelf) return;
    try { const result = await OPS[msg.op](...msg.args); game.socket.emit(`module.${MOD}`, {reply: true, id: msg.id, result}); }
    catch (err) { game.socket.emit(`module.${MOD}`, {reply: true, id: msg.id, error: err.message}); }
  });
});
async function asGM(op, ...args) {
  if (game.user.isGM) return OPS[op](...args);
  if (!game.users.activeGM) { ui.notifications.warn("A GM has to be connected to do that."); return false; }
  const id = foundry.utils.randomID();
  return new Promise((resolve, reject) => {
    pending.set(id, {resolve, reject});
    game.socket.emit(`module.${MOD}`, {op, args, id});
    setTimeout(() => { if (pending.delete(id)) reject(new Error("The GM's client didn't answer.")); }, 20000);
  });
}
const setFlags = (ship, data) => asGM("flags", ship.uuid, data);

/* ------------------------------------------------------------------ chat */
function card(ship, title, body, {gm = false, buttons = []} = {}) {
  const btns = buttons.map(b => `<button type="button" data-tsvship="${b.action}" ${Object.entries(b.data ?? {})
    .map(([k, v]) => `data-${k}="${esc(v)}"`).join(" ")}>${esc(b.label)}</button>`).join("");
  return ChatMessage.create({speaker: {alias: ship.name}, content: `<div class="tsvship-card"><h4>${esc(title)}</h4>${body}${btns}</div>`,
    whisper: gm ? game.users.filter(u => u.isGM).map(u => u.id) : []});
}
const CARD_ACTIONS = {
  explosion: async el => { const s = await fromUuid(el.dataset.uuid); if (s) explosionSave(s); },
  explode: async el => { const s = await fromUuid(el.dataset.uuid); if (s && game.user.isGM) explode(s); },
  unshielded: async el => {
    const s = await fromUuid(el.dataset.uuid); if (!s || !game.user.isGM) return;
    const n = Number(el.dataset.amount) || 0, hp = hpOf(s);
    const v = Math.max(0, hp.value - n);
    await s.update({"system.attributes.hp.temp": Math.min(F(s).shieldMax ?? 0, hp.temp + n), "system.attributes.hp.value": v,
                    "system.attributes.hp.damage": Math.max(0, hp.max - v)});
    el.disabled = true;
    card(s, "Unshielded side", `<p>${n} Mega damage moved from the shield to the hull.</p>`, {gm: true});
  },
  gunnerAttack: async el => { const s = await fromUuid(el.dataset.uuid), g = await fromUuid(el.dataset.crew); if (s && g) gunnerAttack(s, g); },
  bridge: async el => { const s = await fromUuid(el.dataset.uuid); if (s) openBridge(s); }
};
Hooks.on("renderChatMessageHTML", (message, html) => {
  for (const el of html.querySelectorAll?.("[data-tsvship]") ?? [])
    el.addEventListener("click", ev => { ev.preventDefault(); CARD_ACTIONS[el.dataset.tsvship]?.(el); });
});

/* ------------------------------------------------------------------ shields */
/** Each new round (top of initiative), every shield gets back half its maximum Shield Points, rounded down. */
async function regenShields(combat) {
  const seen = new Set();
  for (const t of combat.scene?.tokens ?? canvas.scene?.tokens ?? []) {
    const ship = t.actor;
    if (!isShip(ship) || seen.has(ship.uuid)) continue;
    seen.add(ship.uuid);
    const max = F(ship).shieldMax ?? 0, hp = hpOf(ship);
    if (!max || hp.value <= 0 || hp.temp >= max || disabled(ship, "Shield Generator")) continue;
    const now = Math.min(max, hp.temp + Math.floor(max / 2));
    await OPS.hp(ship.uuid, {temp: now});
    card(ship, "Shields recharge", `<p>Shield Points ${hp.temp} → <b>${now}</b> of ${max}.</p>`);
  }
}

/** Which side of the ship an attacker stands off, and whether the shield covers it ("the shortest line
 *  from an attacker to a target ... a shielded side or corner"). null when it can't be told. */
function hitSide(ship, attacker) {
  const t = tokenOf(ship);
  if (!t || !attacker || attacker.parent !== t.parent || attacker.id === t.id) return null;
  const gs = t.parent.grid.size, c = d => ({x: d.x + d.width * gs / 2, y: d.y + d.height * gs / 2});
  const a = c(attacker), s = c(t);
  if (a.x === s.x && a.y === s.y) return null;
  // rotation + 90 is the direction the token faces, in canvas degrees (see tselverse-facing)
  const rel = norm180(Math.toDegrees(Math.atan2(a.y - s.y, a.x - s.x)) - (t.rotation + 90));
  const side = Object.keys(SIDES).reduce((best, k) => Math.abs(norm180(rel - SIDES[k])) < Math.abs(norm180(rel - SIDES[best])) ? k : best, "front");
  const faces = F(ship).shieldSide ?? "front";
  return {side, faces, shielded: Math.abs(norm180(rel - SIDES[faces])) <= 45.5};
}

// who attacked last: the token an attack or damage roll's chat card speaks for
let lastAttacker = null;
Hooks.on("createChatMessage", msg => {
  const type = msg.flags?.[game.system.id]?.roll?.type;
  if ((type === "attack" || type === "damage") && msg.speaker?.token) lastAttacker = {scene: msg.speaker.scene, token: msg.speaker.token, at: Date.now()};
});
const attackerDoc = () => lastAttacker && Date.now() - lastAttacker.at < 600000
  ? game.scenes.get(lastAttacker.scene)?.tokens.get(lastAttacker.token) ?? null : null;

Hooks.on("blackFlag.preApplyDamage", (ship, amount, updates) => {
  if (!isShip(ship) || !(amount > 0)) return;
  const hp = hpOf(ship), f = F(ship);
  // damage taken at 0 hit points counts as one failed Explosion Saving Throw
  if (hp.value <= 0 && !f.explosion?.state && f.explosion?.rolling) setTimeout(() => explosionFailure(ship, 1, "it took damage at 0 Mega Hit Points"), 50);
  const absorbed = hp.temp - (updates["system.attributes.hp.temp"] ?? hp.temp);
  if (absorbed <= 0) return;
  const hit = hitSide(ship, attackerDoc());
  if (hit && !hit.shielded) {
    const v = updates["system.attributes.hp.value"] ?? hp.value, nv = Math.max(0, v - absorbed);
    updates["system.attributes.hp.temp"] = hp.temp;
    updates["system.attributes.hp.value"] = nv;
    updates["system.attributes.hp.damage"] = Math.max(0, hp.max - nv);
    card(ship, "Unshielded side", `<p>The attack comes in on the <b>${SIDE_LABEL[hit.side].toLowerCase()}</b>; the shield faces ${SIDE_LABEL[hit.faces].toLowerCase()}. All ${amount} Mega damage goes to the hull.</p>`, {gm: true});
  } else if (hit) {
    card(ship, "Shield hit", `<p>The attack comes in on the <b>${SIDE_LABEL[hit.side].toLowerCase()}</b>, which the shield covers: it absorbs ${absorbed}.</p>`, {gm: true});
  } else {
    card(ship, "Shield hit", `<p>The shield (facing ${SIDE_LABEL[f.shieldSide ?? "front"].toLowerCase()}) absorbed ${absorbed}. I couldn't tell where the attack came from.</p>`,
      {gm: true, buttons: [{action: "unshielded", label: "It hit an unshielded side", data: {uuid: ship.uuid, amount: absorbed}}]});
  }
});

/* ------------------------------------------------------------------ 0 Mega Hit Points */
Hooks.on("preUpdateActor", (actor, changes, options) => {
  if (isShip(actor) && foundry.utils.hasProperty(changes, "system.attributes.hp.value")) options[MOD] = {was: hpOf(actor).value};
});
Hooks.on("updateActor", async (actor, changes, options) => {
  if (!isShip(actor)) return;
  for (const t of actor.getActiveTokens()) drawShield(t);
  for (const app of foundry.applications.instances.values()) if (app instanceof BridgeApp && app.ship === actor) app.render();
  if (!game.users.activeGM?.isSelf || !options?.[MOD]) return;
  const was = options[MOD].was, now = hpOf(actor).value;
  if (was > 0 && now <= 0) {
    const crewed = hasCrew(actor);
    await actor.update({[`flags.${MOD}.explosion`]: {s: 0, f: 0, state: null, rolling: crewed}, "system.attributes.hp.temp": 0});
    if (crewed) card(actor, "0 Mega Hit Points", `<p>All its systems and weapons are disabled. When the round ends (after the last turn in initiative), one crew member rolls an <b>Explosion Saving Throw</b> for the ship.</p>`,
      {buttons: [{action: "bridge", label: "Open the bridge", data: {uuid: actor.uuid}}]});
    else card(actor, "0 Mega Hit Points", `<p>GM-controlled ships normally blow up at 0 Mega Hit Points; they don't roll Explosion Saving Throws.</p>`,
      {gm: true, buttons: [{action: "explode", label: "It explodes", data: {uuid: actor.uuid}}, {action: "explosion", label: "Roll Explosion Saving Throws instead", data: {uuid: actor.uuid}}]});
  } else if (was <= 0 && now > 0 && F(actor).explosion) {
    // any healing of Mega Hit Points clears both counts
    await actor.update({[`flags.${MOD}.-=explosion`]: null});
  }
});

async function explosionFailure(ship, n, why) {
  const e = F(ship).explosion ?? {s: 0, f: 0};
  if (e.state) return;
  const f = Math.min(3, (e.f ?? 0) + n);
  await setFlags(ship, {explosion: {...e, f, rolling: true, state: f >= 3 ? "exploded" : null}});
  await card(ship, "Explosion Saving Throw failure", `<p>${n === 2 ? "Two failures" : "One failure"}: ${esc(why)}. Failures ${f} of 3, successes ${e.s ?? 0} of 3.</p>`);
  if (f >= 3) explode(ship, true);
}
async function explode(ship, told = false) {
  if (!told) await setFlags(ship, {explosion: {...(F(ship).explosion ?? {s: 0}), f: 3, state: "exploded"}});
  card(ship, "The ship explodes", `<p>Everyone still aboard dies. Only those who got off first (Escape Pods, a Fighter Bay or Teleporters) survive.</p>`);
}
/** Explosion save: d20, 10+ succeeds, a 1 counts as two failures, a 20 gives the ship back 1 Mega Hit Point. */
async function explosionSave(ship) {
  const e = F(ship).explosion ?? {s: 0, f: 0};
  if (hpOf(ship).value > 0) return ui.notifications.info(`${ship.name} isn't at 0 Mega Hit Points.`);
  if (e.state) return ui.notifications.info(`${ship.name} is already ${e.state === "derelict" ? "a derelict wreck" : "destroyed"}.`);
  const roll = await new Roll("1d20").evaluate();
  await roll.toMessage({speaker: {alias: ship.name}, flavor: "Explosion Saving Throw"});
  const d = roll.total;
  if (d === 20) {
    await asGM("hp", ship.uuid, {heal: 1});          // (regaining a Mega Hit Point resets both counts)
    return card(ship, "A 20!", `<p>The ship gets back 1 Mega Hit Point, and its successes and failures go back to zero.</p>`);
  }
  let s = e.s ?? 0, f = e.f ?? 0;
  if (d === 1) f += 2; else if (d >= 10) s += 1; else f += 1;
  s = Math.min(3, s); f = Math.min(3, f);
  const state = f >= 3 ? "exploded" : s >= 3 ? "derelict" : null;
  await setFlags(ship, {explosion: {s, f, rolling: true, state}});
  await card(ship, d >= 10 ? "Explosion Saving Throw: success" : d === 1 ? "Explosion Saving Throw: a 1, two failures" : "Explosion Saving Throw: failure",
    `<p>Successes ${s} of 3, failures ${f} of 3.</p>`);
  if (state === "exploded") explode(ship, true);
  else if (state === "derelict") card(ship, "Derelict wreck", `<p>It won't explode now, but every system stays disabled and it drifts. A tow to a repair dock at sublight speed can bring it back.</p>`);
}

/* ------------------------------------------------------------------ rounds and turns */
Hooks.on("preUpdateCombat", (combat, changes, options) => { if ("round" in changes) options[MOD] = {round: combat.round}; });
Hooks.on("updateCombat", async (combat, changes, options) => {
  if (!game.users.activeGM?.isSelf) return;
  if ("round" in changes && options?.[MOD] && changes.round > options[MOD].round && options[MOD].round >= 1) {
    // the end of the Initiative order, then the start of the next
    for (const t of combat.scene?.tokens ?? canvas.scene?.tokens ?? []) {
      const s = t.actor, e = F(s).explosion;
      if (isShip(s) && hpOf(s).value <= 0 && e?.rolling && !e.state)
        card(s, "End of the round", `<p>One character makes an Explosion Saving Throw for the ship. Successes ${e.s} of 3, failures ${e.f} of 3.</p>`,
          {buttons: [{action: "explosion", label: "Roll the Explosion Saving Throw", data: {uuid: s.uuid}}]});
    }
    await regenShields(combat);
  }
  // Evasive Maneuvers ends when the Pilot's next turn starts (or the ship's own)
  if ("turn" in changes || "round" in changes) {
    const who = combat.combatant?.actor;
    for (const s of allShips()) {
      const ev = F(s).evasive;
      if (ev && who && (who.uuid === ev.by || who.uuid === s.uuid) && !(ev.round === combat.round && ev.turn === combat.turn))
        await s.update({[`flags.${MOD}.-=evasive`]: null});
    }
  }
});
Hooks.on("blackFlag.preRollAttack", rollConfig => {
  const dodging = [...game.user.targets].map(t => t.actor).filter(a => isShip(a) && F(a).evasive);
  if (!dodging.length || !rollConfig.rolls?.[0]) return;
  rollConfig.rolls[0].options = {...(rollConfig.rolls[0].options ?? {}), disadvantage: true};
  ui.notifications.info(`${dodging[0].name} is taking Evasive Maneuvers: Disadvantage on this attack.`);
});
Hooks.on("updateToken", (doc, changes) => {
  if (doc.object) drawShield(doc.object);
  if (game.users.activeGM?.isSelf && ("x" in changes || "y" in changes) && isShip(doc.actor)) OPS.clearCone(doc.uuid);
});

/* ------------------------------------------------------------------ the shield on the token */
function drawShield(token) {
  try {
    const a = token.actor, g0 = token[ARC];
    const show = isShip(a) && (F(a).shieldMax ?? 0) > 0 && hpOf(a).temp > 0;
    if (!show) { if (g0) g0.visible = false; return; }
    const g = g0 ?? (token[ARC] = token.addChild(new PIXI.Graphics()));
    const r = Math.max(token.w, token.h) * 0.6, mid = Math.toRadians(token.document.rotation + 90 + SIDES[F(a).shieldSide ?? "front"]);
    g.visible = true; g.clear();
    g.lineStyle(Math.max(3, r * 0.08), 0x4fc3f7, 0.9);
    g.arc(token.w / 2, token.h / 2, r, mid - Math.PI / 4, mid + Math.PI / 4);
  } catch (err) { console.warn(`${MOD} | shield arc`, err); }
}
Hooks.on("refreshToken", drawShield);

/* ------------------------------------------------------------------ rolls */
const total = rolls => Array.isArray(rolls) ? rolls[0]?.total : rolls?.total;
/** A crew member's check against DC 15; null when they close the roll window. */
async function check(actor, skill, ability) {
  const t = total(await actor.rollSkill({skill, ability, target: DC}));
  return t === undefined ? null : t;
}
const abilityName = k => game.i18n.localize(CONFIG.BlackFlag.abilities[k]?.labels?.full ?? CONFIG.BlackFlag.abilities[k]?.label ?? k);
const skillName = k => game.i18n.localize(CONFIG.BlackFlag.skills[k].label);
const levelOf = a => Number(a.system?.progression?.level) || Number(a.system?.attributes?.cr) || 1;
async function pick(title, intro, options) {
  if (!options.length) return null;
  if (options.length === 1 && options[0].only) return options[0].value;
  const content = `${intro ? `<p>${intro}</p>` : ""}<select name="v" style="width:100%">${options.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join("")}</select>`;
  try { return await DialogV2.prompt({window: {title}, content, ok: {label: "Choose", callback: (ev, btn) => btn.form.elements.v.value}, rejectClose: false}); }
  catch { return null; }
}

/* ------------------------------------------------------------------ crew actions */
async function assign(ship, actor, role) {
  const crew = foundry.utils.deepClone(F(ship).crew ?? {});
  for (const r of Object.keys(ROLES)) crew[r] = (crew[r] ?? []).filter(u => u !== actor.uuid && fromUuidSync(u));
  if (role) crew[role] = ROLES[role].one ? [actor.uuid] : [...crew[role], actor.uuid];
  await setFlags(ship, {crew});
}

const ACTIONS = {
  /* Captain */
  async fireAtWill(ship, who) {
    const gunners = crewOf(ship, "gunner");
    if (!gunners.length) return ui.notifications.warn("The ship has no Gunner to direct.");
    const g = await pick("Fire at Will", "Which Gunner attacks?", gunners.map(a => ({value: a.uuid, label: a.name, only: gunners.length === 1})));
    const gunner = g && fromUuidSync(g); if (!gunner) return;
    card(ship, "Fire at Will", `<p><b>${esc(who.name)}</b> directs <b>${esc(gunner.name)}</b> to attack. ${esc(gunner.name)} can use their Reaction for one attack with a ship weapon.</p>`,
      {buttons: [{action: "gunnerAttack", label: `${gunner.name}: attack`, data: {uuid: ship.uuid, crew: gunner.uuid}}]});
  },
  async fullShields(ship, who) {
    const max = F(ship).shieldMax ?? 0;
    if (!max) return ui.notifications.warn("This ship has no shield.");
    if (disabled(ship, "Shield Generator")) return ui.notifications.warn("The Shield Generator is disabled.");
    await asGM("hp", ship.uuid, {temp: max});
    card(ship, "Full Power to Shields", `<p><b>${esc(who.name)}</b>: the ship regains all of its Shield Points (${max}).</p>`);
  },
  async fullSpeed(ship, who) {
    const pilot = crewOf(ship, "pilot")[0];
    if (!pilot) return ui.notifications.warn("The ship has no Pilot to direct.");
    const t = tokenOf(ship); if (t) await asGM("cone", t.uuid, "half");
    card(ship, "Full Speed Ahead", `<p><b>${esc(who.name)}</b> directs <b>${esc(pilot.name)}</b> to move. ${esc(pilot.name)} can use their Reaction to fly the ship up to half its Speed (${Math.floor((F(ship).speed ?? 0) / 2).toLocaleString()} ft.), staying inside the movement cone.</p>`);
  },
  /* Engineer */
  async emergencyRepairs(ship, who) {
    const ab = await pick("Emergency Repairs", `DC ${DC}. On a success the ship regains Mega Hit Points: ${Math.max(1, Math.floor(levelOf(who) / 2))}d6 + the ability modifier used.`,
      [{value: "strength:athletics", label: `${abilityName("strength")} (${skillName("athletics")})`},
       {value: "intelligence:arcana", label: `${abilityName("intelligence")} (${skillName("arcana")}) - the book's Technology`}]);
    if (!ab) return;
    const [ability, skill] = ab.split(":");
    const t = await check(who, skill, ability); if (t === null) return;
    if (t < DC) return card(ship, "Emergency Repairs", `<p><b>${esc(who.name)}</b> rolls ${t} against DC ${DC}: no repairs.</p>`);
    const mod = who.system.abilities?.[ability]?.mod ?? 0;
    const roll = await new Roll(`${Math.max(1, Math.floor(levelOf(who) / 2))}d6 + ${mod}`).evaluate();
    await roll.toMessage({speaker: ChatMessage.getSpeaker({actor: who}), flavor: `Emergency Repairs: Mega Hit Points for ${ship.name}`});
    const before = hpOf(ship).value;
    await asGM("hp", ship.uuid, {heal: Math.max(0, roll.total)});
    card(ship, "Emergency Repairs", `<p><b>${esc(who.name)}</b> rolls ${t} against DC ${DC}: the ship regains ${Math.max(0, roll.total)} Mega Hit Points (${before} → ${Math.min(hpOf(ship).max, before + Math.max(0, roll.total))}).</p>`);
  },
  async useSystem(ship, who) {
    const list = (F(ship).systems ?? []).filter(s => !disabled(ship, s));
    if (!list.length) return ui.notifications.warn("The ship has no working system.");
    const s = await pick("Use System", "Which system?", list.map(x => ({value: x, label: x}))); if (!s) return;
    card(ship, "Use System", `<p><b>${esc(who.name)}</b> activates the <b>${esc(s)}</b>.</p>`);
  },
  async repairSystem(ship, who) {
    const list = F(ship).disabled ?? [];
    if (!list.length) return ui.notifications.info("No system is disabled.");
    const s = await pick("Repair a system", `A Utilize action: DC ${DC} ${abilityName("intelligence")} (${skillName("arcana")}) - the book's Technology.`, list.map(x => ({value: x, label: x}))); if (!s) return;
    const t = await check(who, "arcana", "intelligence"); if (t === null) return;
    if (t >= DC) await setFlags(ship, {disabled: (F(ship).disabled ?? []).filter(x => x !== s)});
    card(ship, "Repair a system", `<p><b>${esc(who.name)}</b> rolls ${t} against DC ${DC}: ${t >= DC ? `the <b>${esc(s)}</b> is working again.` : `the ${esc(s)} stays disabled.`}</p>`);
  },
  /* Gunner */
  attack: (ship, who) => gunnerAttack(ship, who),
  async arcaneCannon(ship, who) {
    card(ship, "Arcane Cannon", `<p><b>${esc(who.name)}</b> uses a Magic action to cast either a [Mega] spell or an ordinary spell (cast as an action or Bonus Action, aimed at an area or at one creature other than themself) blown up to Mega scale.</p>
      <p><b>Mega Size.</b> Distances, including range, ×100. <b>Mega Damage.</b> It deals Mega damage. <b>Mega Targets.</b> Only Mega-sized targets. <b>Concentration.</b> A Constitution save when the ship takes damage, DC 10 or half the Mega damage (max 30). <b>Fragile Casting.</b> It fails if any part reaches an atmosphere or significant gravity.</p>`);
  },
  /* Pilot */
  async moveFire(ship, who) {
    const t = tokenOf(ship); if (t) await asGM("cone", t.uuid, "full");
    const big = !/^fighter/i.test(F(ship).size ?? "");
    card(ship, "Move and Fire", `<p><b>${esc(who.name)}</b> flies the ship up to its Speed (${(F(ship).speed ?? 0).toLocaleString()} ft.) inside the movement cone and may take the Attack action${big ? ": only one attack, with a Melee weapon or one that has the Fixed property (the ship is Personal-sized or larger)" : ""}. Afterwards the ship may turn up to its Maneuverability (${F(ship).maneuverability ?? "?"}°).</p>`);
  },
  async evasive(ship, who) {
    const tk = tokenOf(ship); if (tk) await asGM("cone", tk.uuid, "evasive");
    const t = await check(who, "survival", "dexterity"); if (t === null) return;
    if (t >= DC) await setFlags(ship, {evasive: {by: who.uuid, round: game.combat?.round ?? null, turn: game.combat?.turn ?? null}});
    card(ship, "Evasive Maneuvers", `<p><b>${esc(who.name)}</b> moves the ship 500 feet in any direction, facing any way, and rolls ${t} against DC ${DC} (${abilityName("dexterity")} (${skillName("survival")}), the book's Piloting): ${t >= DC
      ? "attacks against the ship have Disadvantage, and their Dexterity saving throws for it have Advantage, until the start of their next turn."
      : "no benefit."}</p>`);
  },
  async targetedStrike(ship, who) {
    const t = tokenOf(ship); if (t) await asGM("cone", t.uuid, "half");
    card(ship, "Targeted Strike", `<p><b>${esc(who.name)}</b> flies the ship up to half its Speed inside the movement cone, then makes one attack (Attack action, a single attack). If it hits and some damage gets past the target's shields, they pick one of that ship's systems and disable it.</p>`);
  },
  async voidJump(ship, who) {
    card(ship, "Void Jump", `<p><b>${esc(who.name)}</b> starts charging a void jump. In 1 minute the ship jumps, and nothing can stop it.</p>`);
  },
  shipSave: (ship, who) => shipSave(ship, who)
};

/** A ship's saving throws are rolled by its Pilot. */
async function shipSave(ship, who) {
  const keys = Object.keys(CONFIG.BlackFlag.abilities);
  const ability = await pick(`Saving throw for ${ship.name}`, "", keys.map(k => ({value: k, label: abilityName(k)})).sort((a, b) => (b.value === "dexterity") - (a.value === "dexterity")));
  if (!ability) return;
  const pilot = who ?? crewOf(ship, "pilot")[0];
  if (pilot) {
    const adv = F(ship).evasive && ability === "dexterity";
    return pilot.rollAbilitySave({ability, rolls: adv ? [{options: {advantage: true}}] : []});
  }
  if (hasCrew(ship)) return card(ship, "Saving throw", `<p>The ship has no Pilot: it automatically fails its ${abilityName(ability)} saving throw.</p>`);
  return gmRoll(ship, `${abilityName(ability)} saving throw`);
}
/** a d20 plus the ship's Proficiency Bonus */
async function gmRoll(ship, what) {
  const roll = await new Roll(`1d20 + ${F(ship).pb || 2}`).evaluate();
  return roll.toMessage({speaker: {alias: ship.name}, flavor: `${what} (d20 + the ship's Proficiency Bonus)`});
}

/** A Gunner's attack: the ship weapon as an item on the Gunner's own sheet, so their proficiency, ability
 *  and features apply (class features and feats that work with ordinary weapons work with ship weapons too). */
async function gunnerAttack(ship, who) {
  if (!who.isOwner) return ui.notifications.warn(`You don't control ${who.name}.`);
  if (hpOf(ship).value <= 0) return ui.notifications.warn("At 0 Mega Hit Points the ship's weapons are all disabled.");
  const mounts = F(ship).weapons?.length ? F(ship).weapons : ship.items.filter(i => i.type === "weapon").map(i => i.name);
  if (!mounts.length) return ui.notifications.warn("This ship has no weapons.");
  const m = await pick(`${who.name}: ship weapon`, "", mounts.map(x => ({value: x, label: x, only: mounts.length === 1}))); if (!m) return;
  // "2 Pneumatic Pincers (Fixed Front)" is the item Pneumatic Pincer; "Saw Claws" is Saw Claws
  const base = m.replace(/\s*\(.*$/, "").replace(/^\d+\s+/, "").trim(), names = [base, base.replace(/s$/, "")];
  let item = who.items.find(i => names.includes(i.flags?.[MOD]?.mount)) ?? who.items.find(i => i.type === "weapon" && names.includes(i.name));
  if (!item) {
    let src = null;
    for (const n of names) if ((src = await findWeapon(n) ?? ship.items.find(i => i.type === "weapon" && i.name === n))) break;
    if (!src) return ui.notifications.warn(`No ship weapon called ${base} in the Items compendium or on the ship.`);
    const name = src.name;
    const data = src.toObject(); delete data._id;
    foundry.utils.setProperty(data, `flags.${MOD}.mount`, name);
    // (the ship's own copy rolls the printed GM bonus: a Gunner uses their own)
    for (const a of Object.values(data.system?.activities ?? {})) if (a.system?.attack?.flat) { a.system.attack.flat = false; a.system.attack.bonus = ""; }
    [item] = await who.createEmbeddedDocuments("Item", [data]);
    ui.notifications.info(`${name} added to ${who.name}'s sheet for ship combat.`);
  }
  const act = [...(item.system.activities ?? [])].find(a => a.type === "attack");
  return act ? act.activate() : item.sheet.render(true);
}
let weaponIndex = null;
async function findWeapon(name) {
  weaponIndex ??= (await Promise.all(game.packs.filter(p => p.documentName === "Item" && /^(tselverse-art|fi5e-content)\./.test(p.collection))
    .map(async p => (await p.getIndex()).filter(e => e.type === "weapon").map(e => ({pack: p, id: e._id, name: e.name}))))).flat();
  const hit = weaponIndex.find(e => e.name === name) ?? weaponIndex.find(e => e.name.toLowerCase() === name.toLowerCase());
  return hit ? hit.pack.getDocument(hit.id) : null;
}

/* ------------------------------------------------------------------ the Bridge window */
const ROLE_ACTIONS = {
  captain: [["fireAtWill", "Fire at Will"], ["fullShields", "Full Power to Shields"], ["fullSpeed", "Full Speed Ahead"]],
  engineer: [["emergencyRepairs", "Emergency Repairs"], ["useSystem", "Use System"], ["repairSystem", "Repair a system"]],
  gunner: [["attack", "Attack"], ["arcaneCannon", "Arcane Cannon", ship => hasSystem(ship, /arcane cannon/i)]],
  pilot: [["moveFire", "Move and Fire"], ["evasive", "Evasive Maneuvers"], ["targetedStrike", "Targeted Strike", ship => /^fighter/i.test(F(ship).size ?? "")],
          ["voidJump", "Void Jump", ship => (F(ship).darkMatter ?? 0) > 0], ["shipSave", "Ship's saving throw"]]
};

class BridgeApp extends foundry.applications.api.ApplicationV2 {
  constructor(ship, options = {}) { super({...options, id: `tsvship-${ship.uuid.replaceAll(".", "-")}`}); this.ship = ship; }
  static DEFAULT_OPTIONS = {classes: ["tsvship"], window: {title: "Bridge", icon: "fa-solid fa-shuttle-space", resizable: true},
    position: {width: 600, height: "auto"},
    actions: {crewAct: BridgeApp.#crewAct, leave: BridgeApp.#leave, join: BridgeApp.#join, side: BridgeApp.#side, cone: BridgeApp.#cone,
              rotate: BridgeApp.#rotate, system: BridgeApp.#system, gm: BridgeApp.#gm, sheet: BridgeApp.#sheet}};
  get title() { return `Bridge: ${this.ship.name}`; }

  static async #crewAct(event, target) {
    const who = fromUuidSync(target.closest("[data-crew]").dataset.crew);
    if (!who) return;
    if (!who.isOwner) return ui.notifications.warn(`You don't control ${who.name}.`);
    await ACTIONS[target.dataset.do]?.(this.ship, who);
  }
  static async #leave(event, target) {
    const who = fromUuidSync(target.closest("[data-crew]").dataset.crew);
    if (who && (who.isOwner || game.user.isGM)) await assign(this.ship, who, null);
  }
  static async #join(event, target) {
    const sel = target.closest(".row").querySelector("select");
    const who = sel?.value && fromUuidSync(sel.value);
    if (who) await assign(this.ship, who, target.dataset.role);
  }
  static async #side(event, target) {
    if (disabled(this.ship, "Shield Generator") && !game.user.isGM) return ui.notifications.warn("The Shield Generator is disabled.");
    await setFlags(this.ship, {shieldSide: target.dataset.side});
    card(this.ship, "Move Shield", `<p>The shield now covers the ship's <b>${SIDE_LABEL[target.dataset.side].toLowerCase()}</b>.</p>`);
  }
  static async #cone(event, target) {
    const t = tokenOf(this.ship);
    if (!t) return ui.notifications.warn("The ship has no token on a scene.");
    const ok = target.dataset.mode === "clear" ? await asGM("clearCone", t.uuid) : await asGM("cone", t.uuid, target.dataset.mode);
    if (!ok && target.dataset.mode !== "clear") ui.notifications.warn("The ship has no Speed to draw a cone from.");
  }
  static async #rotate(event, target) {
    const t = tokenOf(this.ship);
    if (!t) return ui.notifications.warn("The ship has no token on a scene.");
    await asGM("rotate", t.uuid, Number(target.dataset.deg));
    const drawn = t.parent.regions.find(m => m.flags?.[MOD]?.cone === t.id && m.flags[MOD].mode !== "evasive");
    if (drawn) await asGM("cone", t.uuid, drawn.flags[MOD].mode);
  }
  static async #system(event, target) {
    if (!game.user.isGM) return;
    const name = target.dataset.name, list = F(this.ship).disabled ?? [];
    const off = !list.includes(name);
    await setFlags(this.ship, {disabled: off ? [...list, name] : list.filter(x => x !== name)});
    card(this.ship, off ? "System disabled" : "System repaired", `<p>The <b>${esc(name)}</b> is ${off ? "disabled" : "working again"}.</p>`);
  }
  static async #sheet() { this.ship.sheet.render(true); }
  static async #gm(event, target) {
    const ship = this.ship, a = target.dataset.do;
    if (a === "explosion") return explosionSave(ship);
    if (a === "save") return shipSave(ship, crewOf(ship, "pilot").find(p => p.isOwner) ?? null);
    if (!game.user.isGM) return;
    if (a === "check") return gmRoll(ship, "Ability check");
    if (a === "regen") { const max = F(ship).shieldMax ?? 0; return OPS.hp(ship.uuid, {temp: Math.min(max, hpOf(ship).temp + Math.floor(max / 2))}); }
    if (a === "failure") return explosionFailure(ship, 1, "the GM added one");
    if (a === "endEvasive") return ship.update({[`flags.${MOD}.-=evasive`]: null});
    if (a === "grid") {
      const sc = canvas.scene;
      if (sc && await DialogV2.confirm({window: {title: "500-foot squares"}, content: `<p>Set the scene <b>${esc(sc.name)}</b> to 500 feet a square? (It is ${sc.grid.distance} ${esc(sc.grid.units || "units")} now.)</p>`}))
        await sc.update({"grid.distance": 500, "grid.units": "ft"});
      return this.render();
    }
    if (a === "edit") return editShip(ship);
  }

  async _renderHTML() {
    const ship = this.ship, f = F(ship), hp = hpOf(ship), gm = game.user.isGM;
    const e = f.explosion, sc = canvas?.scene, tok = tokenOf(ship);
    const mine = game.actors.filter(a => a.type === "pc" && (gm || a.isOwner));
    const pips = (n, ch) => ch.repeat(n) + "○".repeat(3 - n);
    let alert = "";
    if (e?.state === "exploded") alert = `<p class="alert"><b>Destroyed.</b> The ship has exploded.</p>`;
    else if (e?.state === "derelict") alert = `<p class="alert"><b>Derelict wreck.</b> Adrift, all systems disabled, no longer at risk of exploding.</p>`;
    else if (hp.value <= 0) alert = `<p class="alert"><b>0 Mega Hit Points.</b> Systems and weapons are all disabled.
      Successes <span class="pips">${pips(e?.s ?? 0, "●")}</span> &nbsp; Failures <span class="pips">${pips(e?.f ?? 0, "✖")}</span>
      <button type="button" data-action="gm" data-do="explosion" style="width:auto;margin-left:.5rem">Explosion Saving Throw</button></p>`;
    const evasive = f.evasive ? `<p class="alert" style="background:rgba(63,167,214,.2);border-color:#3fa7d6"><b>Evasive Maneuvers.</b> Attack rolls against the ship have Disadvantage; the Pilot's Dexterity saves for it have Advantage.
      ${gm ? `<button type="button" data-action="gm" data-do="endEvasive" style="width:auto;margin-left:.5rem">End</button>` : ""}</p>` : "";

    const stats = `<div class="stats">
      <div class="stat${hp.value <= 0 ? " warn" : ""}"><b>${hp.value} / ${hp.max}</b><span>Mega Hit Points</span></div>
      <div class="stat"><b>${f.shieldMax ? `${hp.temp} / ${f.shieldMax}` : "none"}</b><span>Shield Points</span></div>
      <div class="stat"><b>${(f.speed ?? 0).toLocaleString()} ft.</b><span>Speed</span></div>
      <div class="stat"><b>${f.maneuverability ?? "?"}°</b><span>Maneuverability</span></div></div>`;

    const side = f.shieldSide ?? "front";
    const shield = f.shieldMax ? `<div class="row sides"><span>Shield covers the</span>
      ${Object.keys(SIDES).map(k => `<button type="button" data-action="side" data-side="${k}" class="${k === side ? "on" : ""}">${SIDE_LABEL[k]}</button>`).join("")}
      <span class="hint">Move Shield: the Engineer's Bonus Action.</span></div>` : "";

    const scale = !sc ? "" : sc.grid.distance === 500 ? `<span class="hint">This scene: 500 ft. a square.</span>`
      : `<span class="hint">This scene is ${sc.grid.distance} ${esc(sc.grid.units || "units")} a square; ship combat uses 500 ft.</span>${gm ? `<button type="button" data-action="gm" data-do="grid">Set 500 ft.</button>` : ""}`;
    const move = `<div class="row"><span>Cone of movement</span>
      <button type="button" data-action="cone" data-mode="full">Full Speed</button><button type="button" data-action="cone" data-mode="half">Half</button>
      <button type="button" data-action="cone" data-mode="clear">Clear</button>
      <span>Turn</span><button type="button" data-action="rotate" data-deg="-45" data-tooltip="45° to port">⟲ 45°</button>
      <button type="button" data-action="rotate" data-deg="45" data-tooltip="45° to starboard">⟳ 45°</button></div>
      <div class="row">${tok ? scale : `<span class="hint">The ship has no token on this scene.</span>`}</div>`;

    const roles = Object.entries(ROLES).map(([role, def]) => {
      const crew = crewOf(ship, role);
      const acts = ROLE_ACTIONS[role].filter(([, , when]) => !when || when(ship));
      const rows = crew.map(a => `<li data-crew="${a.uuid}"><div class="who"><img src="${esc(a.img)}" alt=""><b>${esc(a.name)}</b>
          ${a.isOwner || gm ? `<button type="button" data-action="leave" data-tooltip="Leave this role"><i class="fa-solid fa-xmark" inert></i></button>` : ""}</div>
        <div class="acts">${acts.map(([id, label]) => `<button type="button" data-action="crewAct" data-do="${id}" ${a.isOwner ? "" : "disabled"}>${label}</button>`).join("")}</div></li>`).join("");
      const free = mine.filter(a => !crew.includes(a));
      const join = free.length && !(def.one && crew.length && !gm && !crew[0].isOwner)
        ? `<div class="row"><select>${free.map(a => `<option value="${a.uuid}">${esc(a.name)}</option>`).join("")}</select>
           <button type="button" data-action="join" data-role="${role}">${def.one && crew.length ? "Take over" : "Take this role"}</button></div>` : "";
      return `<h3><i class="fa-solid ${def.icon}" inert></i> ${def.label}</h3><ul class="crew">${rows || `<li class="empty">Nobody.</li>`}</ul>${join}`;
    }).join("");

    const off = f.disabled ?? [];
    const systems = (f.systems ?? []).length ? `<h3>Systems <small>${gm ? "click to disable or repair" : ""}</small></h3>
      <div class="systems">${f.systems.map(s => `<button type="button" data-action="system" data-name="${esc(s)}" class="${off.includes(s) || hp.value <= 0 ? "off" : ""}" ${gm ? "" : "disabled"}>${esc(s)}</button>`).join("")}</div>` : "";

    const tools = `<h3>${gm ? "Game Master" : "Ship"}</h3><div class="row">
      <button type="button" data-action="gm" data-do="save">Ship's saving throw</button>
      ${gm ? `<button type="button" data-action="gm" data-do="check">Check (d20 + PB ${f.pb || 2})</button>
      ${f.shieldMax ? `<button type="button" data-action="gm" data-do="regen">Recharge shield (half)</button>` : ""}
      ${hp.value <= 0 && !e?.state ? `<button type="button" data-action="gm" data-do="failure">+1 failure</button>` : ""}
      <button type="button" data-action="gm" data-do="edit">Ship numbers</button>` : ""}
      <button type="button" data-action="sheet">Open the sheet</button></div>
      <p class="hint">Switching roles is a Bonus Action. Technology is Arcana, Piloting is Survival, Data is History.</p>`;
    return `${alert}${evasive}${stats}${shield}${move}${roles}${systems}${tools}`;
  }
  _replaceHTML(html, content) {
    content.innerHTML = html;
    content.ondragover = ev => ev.preventDefault();
    content.ondrop = async ev => {
      let data; try { data = JSON.parse(ev.dataTransfer.getData("text/plain")); } catch { return; }
      const who = data?.type === "Actor" && await fromUuid(data.uuid);
      if (!who || !(who.isOwner || game.user.isGM)) return;
      const role = await pick(`${who.name} aboard ${this.ship.name}`, "Which Crew Role?", Object.entries(ROLES).map(([k, d]) => ({value: k, label: d.label})));
      if (role) await assign(this.ship, who, role);
    };
  }
}

async function editShip(ship) {
  const f = F(ship);
  const n = (k, label, v) => `<label>${label} <input type="number" name="${k}" value="${Number(v) || 0}" min="0"></label>`;
  const content = `<div class="tsvship-form"><label>Size <input type="text" name="size" value="${esc(f.size ?? "")}" placeholder="Fighter, Personal, Transport ..."></label>
    ${n("shieldMax", "Shield Points (maximum)", f.shieldMax)}${n("speed", "Speed (feet)", f.speed)}${n("maneuverability", "Maneuverability (degrees)", f.maneuverability)}
    ${n("pb", "Proficiency Bonus (GM-run)", f.pb)}${n("darkMatter", "Dark Matter engine class (0 = none)", f.darkMatter)}
    <label>Systems <input type="text" name="systems" value="${esc((f.systems ?? []).join("; "))}"></label>
    <label>Weapons <input type="text" name="weapons" value="${esc((f.weapons ?? []).join("; "))}"></label></div>`;
  let res; try { res = await DialogV2.prompt({window: {title: `Ship numbers: ${ship.name}`}, content, rejectClose: false,
    ok: {label: "Save", callback: (ev, btn) => Object.fromEntries(new FormData(btn.form))}}); } catch { return; }
  if (!res) return;
  const list = s => String(s).split(";").map(x => x.trim()).filter(Boolean);
  await ship.update({[`flags.${MOD}`]: {ship: true, size: res.size, shieldMax: Number(res.shieldMax) || 0, speed: Number(res.speed) || 0,
    maneuverability: Number(res.maneuverability) || 0, pb: Number(res.pb) || 0, darkMatter: Number(res.darkMatter) || 0,
    systems: list(res.systems), weapons: list(res.weapons)}});
}

function openBridge(ship) {
  if (!isShip(ship)) return ui.notifications.warn("That isn't a ship.");
  const open = foundry.applications.instances.get(`tsvship-${ship.uuid.replaceAll(".", "-")}`);
  if (open) { open.render(true); open.bringToFront?.(); return open; }
  const app = new BridgeApp(ship); app.render(true); return app;
}
async function openAny() {
  const picked = canvas.tokens?.controlled.map(t => t.actor).find(isShip) ?? [...game.user.targets].map(t => t.actor).find(isShip);
  if (picked) return openBridge(picked);
  const ships = allShips();
  const own = game.user.character && ships.find(s => roleOf(s, game.user.character));
  if (own) return openBridge(own);
  if (!ships.length) return ui.notifications.info("There is no ship in this world yet: drag one out of the Creatures compendium (folder Vehicles).");
  if (ships.length === 1) return openBridge(ships[0]);
  const u = await pick("Bridge", "Which ship?", ships.map(s => ({value: s.uuid, label: s.name})));
  const s = u && await fromUuid(u); if (s) openBridge(s);
}

Hooks.on("getHeaderControlsApplicationV2", (app, controls) => {
  const actor = app.document;
  if (actor?.documentName !== "Actor" || actor.type !== "vehicle") return;
  if (isShip(actor)) controls.push({icon: "fa-solid fa-shuttle-space", label: "Ship bridge", action: "tselverseShipBridge", onClick: () => openBridge(actor)});
  else if (game.user.isGM) controls.push({icon: "fa-solid fa-shuttle-space", label: "Make this a ship (Dark Matter)", action: "tselverseShipMake", onClick: () => editShip(actor)});
});
Hooks.on("getSceneControlButtons", controls => {
  const group = Array.isArray(controls) ? controls.find(c => c.name === "token") : controls.tokens ?? controls.token;
  if (!group?.tools) return;
  const tool = {name: `${MOD}-bridge`, order: 98, title: "Ship bridge", icon: "fa-solid fa-shuttle-space", visible: true, button: true,
                onClick: openAny, onChange: openAny};
  if (Array.isArray(group.tools)) group.tools.push(tool); else group.tools[tool.name] = tool;
});

globalThis.TselverseShips = {open: openBridge, openAny, isShip, hitSide, assign, crewOf, explosionSave, explosionFailure, regenShields, findWeapon, gunnerAttack, shipSave, ACTIONS, OPS, BridgeApp, tokenOf};
