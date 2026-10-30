/**
 * Swarm rule: three or more creatures of the same kind summoned or controlled together act as
 * one swarm, so summons don't fill the initiative order.
 *
 * - When a summon activity places three or more tokens of one creature, they are merged at once.
 * - Select two or more tokens of the same creature and press the Token HUD swarm button to merge
 *   them (owned tokens only).
 *
 * The swarm is the first token, changed in place (token-only changes, the creature's sheet in
 * the sidebar is untouched). Numbers, matching the Conjure Animals swarm already in use:
 *   HP = half the merged creatures' HP. Damage dice x (count / 3, rounded up).
 *   Size one step up for 3-5 creatures, two steps for 6 or more (Gargantuan at most).
 *   Resistant to bludgeoning, piercing and slashing (unless vulnerable), and immune to charmed,
 *   frightened, grappled, paralyzed, petrified, prone, restrained and stunned.
 * Deleting the other tokens is done by the GM's client, so a GM has to be connected.
 */
const MOD = "tselverse-common";
const SIZES = ["tiny", "small", "medium", "large", "huge", "gargantuan"];
const CONDS = ["charmed", "frightened", "grappled", "paralyzed", "petrified", "prone", "restrained", "stunned"];
const setting = (k, d) => { try { return game.settings.get(MOD, k); } catch { return d; } };
const esc = s => foundry.utils.escapeHTML?.(String(s)) ?? String(s);

/** What counts as "the same creature": the same base actor, or failing that the same name. */
function kindOf(tokenDoc) {
  const a = tokenDoc.actor;
  return a?._stats?.compendiumSource || tokenDoc.actorId || a?.name || tokenDoc.name;
}

export const swarmMath = {
  multiplier: n => Math.max(1, Math.ceil(n / 3)),
  size(base, n) {
    const i = Math.max(0, SIZES.indexOf(base));
    return SIZES[Math.min(SIZES.length - 1, i + (n >= 6 ? 2 : 1))];
  }
};

/** GM side: turn tokens (uuids) into one swarm token. Returns the swarm token's uuid. */
async function mergeTokens(uuids) {
  const docs = (await Promise.all(uuids.map(u => fromUuid(u)))).filter(d => d?.actor);
  if (docs.length < 2) throw new Error("Pick at least two tokens of the same creature.");
  if (new Set(docs.map(kindOf)).size > 1) throw new Error("Those tokens aren't all the same creature.");
  if (docs.some(d => d.actor.getFlag(MOD, "swarm"))) throw new Error("One of those tokens is already a swarm.");
  const n = docs.length, lead = docs[0], m = swarmMath.multiplier(n);
  if (lead.actorLink) await lead.update({ actorLink: false });
  const actor = lead.actor;
  const sys = actor.system;
  const baseName = actor.name, baseSize = sys.traits?.size ?? "medium";
  const size = swarmMath.size(baseSize, n);
  const hpNow = docs.reduce((s, d) => s + (d.actor.system.attributes?.hp?.value ?? 0), 0);
  const hpMax = docs.reduce((s, d) => s + (d.actor.system.attributes?.hp?.max ?? 0), 0);
  const vuln = new Set(sys.traits?.damage?.vulnerabilities?.value ?? []);
  const res = new Set(sys.traits?.damage?.resistances?.value ?? []);
  for (const t of ["bludgeoning", "piercing", "slashing"]) if (!vuln.has(t)) res.add(t);
  const imm = new Set([...(sys.traits?.condition?.immunities?.value ?? []), ...CONDS]);
  const name = `${baseName} Swarm (${n})`;

  await actor.update({
    name,
    "system.attributes.hp.max": Math.max(1, Math.floor(hpMax / 2)),
    "system.attributes.hp.value": Math.max(1, Math.floor(hpNow / 2)),
    "system.traits.size": size,
    "system.traits.type.swarm": baseSize,
    "system.traits.damage.resistances.value": [...res],
    "system.traits.condition.immunities.value": [...imm],
    [`flags.${MOD}.swarm`]: { count: n, base: baseName, baseSize, multiplier: m }
  });

  // more damage dice: weapon base damage and every damage part of every activity
  const changes = [];
  for (const it of actor.items) {
    const src = it.toObject(), upd = { _id: it.id };
    const base = src.system?.damage?.base;
    if (base?.number) upd["system.damage.base.number"] = base.number * m;
    for (const [id, act] of Object.entries(src.system?.activities ?? {})) {
      const parts = act.system?.damage?.parts;
      if (Array.isArray(parts) && parts.some(p => p?.number)) {
        upd[`system.activities.${id}.system.damage.parts`] = parts.map(p => (p?.number ? { ...p, number: p.number * m } : p));
      }
    }
    if (Object.keys(upd).length > 1) changes.push(upd);
  }
  if (changes.length) await actor.updateEmbeddedDocuments("Item", changes);

  const sizeLabel = s => game.i18n.localize(CONFIG.BlackFlag?.sizes?.[s]?.label ?? s);
  const feat = (fname, html) => ({ name: fname, type: "feature", img: "icons/svg/pawprint.svg",
    system: { type: { category: "monsters" }, description: { value: html } } });
  await actor.createEmbeddedDocuments("Item", [
    feat("Swarm", `<p>${n} ${esc(baseName)} creatures acting as one. It can share a space with other creatures (they can enter its space too) and squeeze through any gap a ${esc(sizeLabel(baseSize))} creature fits through. It takes one turn, and its attacks can target a creature in its space or within its reach. It can’t regain HP or gain temporary HP (a swarm that stays with you for days regains all its HP when you finish a long rest).</p><p>Its damage dice are already multiplied by ${m}. When the swarm has half its HP or fewer, it rolls half as many damage dice (round up). When it drops to 0 HP, every creature in it is gone.</p>`),
    feat("Swarm Resilience", `<p>Resistance to bludgeoning, piercing and slashing damage. Immune to these conditions: charmed, frightened, grappled, paralyzed, petrified, prone, restrained, stunned.</p>`)
  ]);

  const scale = CONFIG.BlackFlag?.sizes?.[size]?.scale ?? 1;
  await lead.update({ name, width: Math.max(1, scale), height: Math.max(1, scale) });
  const scene = lead.parent;
  const rest = docs.slice(1).filter(d => d.parent === scene).map(d => d.id);
  if (rest.length) await scene.deleteEmbeddedDocuments("Token", rest);
  // the merged creatures leave any combat; the swarm keeps the lead's place
  for (const c of game.combats) {
    const ids = c.combatants.filter(cb => rest.includes(cb.tokenId) && cb.sceneId === scene.id).map(cb => cb.id);
    if (ids.length) await c.deleteEmbeddedDocuments("Combatant", ids);
  }
  return lead.uuid;
}

/* ------------------------------------------------------------------ GM socket */
const OPS = { merge: mergeTokens };
const pending = new Map();
Hooks.once("ready", () => {
  game.socket.on(`module.${MOD}`, async msg => {
    if (msg?.scope !== "swarm") return;
    if (msg.reply && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); return msg.error ? p.reject(new Error(msg.error)) : p.resolve(msg.result); }
    if (!msg.op || !game.users.activeGM?.isSelf) return;
    const user = game.users.get(msg.user);
    try {
      // a player may only merge tokens they own
      const docs = await Promise.all((msg.args[0] ?? []).map(u => fromUuid(u)));
      if (!user || docs.some(d => !d?.testUserPermission?.(user, "OWNER"))) throw new Error("You can only merge tokens you own.");
      const result = await OPS[msg.op](...msg.args);
      game.socket.emit(`module.${MOD}`, { scope: "swarm", reply: true, id: msg.id, result });
    } catch (err) { game.socket.emit(`module.${MOD}`, { scope: "swarm", reply: true, id: msg.id, error: err.message }); }
  });
});
function asGM(op, ...args) {
  if (game.user.isGM) return OPS[op](...args);
  if (!game.users.activeGM) return Promise.reject(new Error("A GM has to be connected to make a swarm."));
  const id = foundry.utils.randomID();
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    game.socket.emit(`module.${MOD}`, { scope: "swarm", op, args, id, user: game.user.id });
    setTimeout(() => { if (pending.delete(id)) reject(new Error("The GM's client didn't answer.")); }, 20000);
  });
}

/** Merge these tokens (TokenDocuments or Tokens) into one swarm. */
export async function makeSwarm(tokens) {
  const uuids = tokens.map(t => (t.document ?? t).uuid);
  try {
    const uuid = await asGM("merge", uuids);
    ui.notifications.info(`${uuids.length} creatures now act as one swarm.`);
    return uuid;
  } catch (err) { ui.notifications.warn(err.message); }
}

/* ------------------------------------------------------------------ hooks */
Hooks.once("init", () => {
  game.settings.register(MOD, "autoSwarm", {
    name: "Summons form swarms",
    hint: "When a summon places three or more of the same creature, they become one swarm (half their total HP, damage dice x count/3).",
    scope: "world", config: true, type: Boolean, default: true
  });
  const mod = game.modules.get(MOD); if (mod) mod.api = { ...(mod.api ?? {}), makeSwarm, swarmMath };
});

Hooks.on("blackFlag.postSummon", async (activity, profile, tokens) => {
  if (!setting("autoSwarm", true) || (tokens?.length ?? 0) < 3) return;
  const groups = new Map();
  for (const t of tokens) { const k = kindOf(t); groups.set(k, [...(groups.get(k) ?? []), t]); }
  for (const g of groups.values()) if (g.length >= 3) await makeSwarm(g);
});

Hooks.on("renderTokenHUD", (hud, element) => {
  const root = element instanceof HTMLElement ? element : element?.[0];
  const col = root?.querySelector(".col.left");
  const tokenDoc = hud.document ?? hud.object?.document;
  if (!col || !tokenDoc) return;
  col.querySelectorAll(".tsv-swarm").forEach(n => n.remove());
  const picked = canvas.tokens.controlled.map(t => t.document).filter(d => d.isOwner && d.actor);
  if (picked.length < 2 || !picked.includes(tokenDoc)) return;
  if (new Set(picked.map(kindOf)).size > 1 || picked.some(d => d.actor.getFlag(MOD, "swarm"))) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "control-icon tsv-swarm";
  btn.dataset.tooltip = `Merge these ${picked.length} into one swarm`;
  btn.innerHTML = `<i class="fa-solid fa-users-rays" inert></i>`;
  btn.addEventListener("click", async ev => { ev.preventDefault(); hud.close?.(); await makeSwarm(picked); });
  col.append(btn);
});
