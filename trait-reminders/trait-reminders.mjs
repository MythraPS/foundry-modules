/**
 * Trait Reminders.
 *
 * Black Flag does not automate monster traits; they are text on the sheet. This module
 * reads each passive trait's description for trigger phrasing and whispers the GM a
 * reminder with the trait's text (so any [[/save]] in it can be clicked) at the moment
 * it matters. It never rolls or applies anything on its own.
 *
 * A "passive trait" is a feature with no activity, or whose activities are all
 * activation type "free" - the same rule Black Flag's NPC sheet uses for its passive
 * list (NPCSheet#_prepareActions).
 *
 * Foundry 14.367: `combatTurnChange(combat, previous, current)` fires on every client after
 * turn events; only the active GM acts on it here, matching core's own #triggerTurnEvents.
 */

const MODULE = "trait-reminders";
const FT = "f(?:ee|oo)t";

const TRIGGERS = {
  // "Any creature hostile to the larva that starts its turn within 20 feet of the ..."
  auraStart: new RegExp(`starts? (?:its|their|his|her) turn within (\\d+) ${FT}`, "i"),
  auraEnd:   new RegExp(`ends? (?:its|their|his|her) turn within (\\d+) ${FT}`, "i"),
  ownStart:  /at the start of (?:each of )?(?:its|their|his|her) turns?/i,
  ownEnd:    /at the end of (?:each of )?(?:its|their|his|her) turns?/i,
  onKill:    /reduces (?:a|another|any) creature[^.]{0,80}?to 0 hit points/i,
  onDamaged: /\bwhen (?:it|he|she|they|the [a-z' -]+?) takes? damage\b/i
};

const setting = key => game.settings.get(MODULE, key);
const plain = html => String(html ?? "").replace(/<[^>]+>/g, " ").replace(/\[\[[^\]]*\]\]/g, " ").replace(/\s+/g, " ");

Hooks.once("init", () => {
  for (const [key, name] of [["auras", "Auras"], ["ownTurn", "OwnTurn"], ["onKill", "OnKill"], ["onDamaged", "OnDamaged"], ["reactions", "Reactions"]]) {
    game.settings.register(MODULE, key, {
      name: `TRAITREM.Settings.${name}.Name`, hint: `TRAITREM.Settings.${name}.Hint`,
      scope: "world", config: true, type: Boolean, default: true
    });
  }
});

/** Passive features of an actor, each with the triggers its text matches. */
function passiveTraits(actor) {
  const out = [];
  for (const item of actor?.items ?? []) {
    if (item.type !== "feature") continue;
    const acts = item.system.activities?.contents ?? [];
    if (acts.length && !acts.every(a => a.activation?.type === "free")) continue;
    const text = plain(item.system.description?.value);
    const hits = {};
    for (const [key, re] of Object.entries(TRIGGERS)) {
      const m = re.exec(text);
      if (m) hits[key] = m[1] ? Number(m[1]) : true;
    }
    if (Object.keys(hits).length) out.push({ item, hits });
  }
  return out;
}

/** Edge-to-edge distance in grid units between two tokens, using occupied grid spaces. */
function tokenDistance(a, b) {
  const spaces = t => {
    const offsets = t.document.getOccupiedGridSpaceOffsets?.() ?? [];
    return offsets.length ? offsets.map(o => canvas.grid.getCenterPoint(o)) : [t.center];
  };
  let best = Infinity;
  for (const p of spaces(a)) for (const q of spaces(b)) {
    const d = canvas.grid.measurePath([p, q]).distance;
    if (d < best) best = d;
  }
  return best;
}

const hostile = (a, b) => a.document.disposition * b.document.disposition < 0;

async function remind(holderActor, entries, headline, titleKey = "TRAITREM.Title") {
  if (!entries.length) return;
  const parts = [];
  for (const { item } of entries) {
    const body = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
      item.system.description?.value ?? "", { rollData: item.getRollData?.(), relativeTo: item });
    parts.push(`<p><strong>@UUID[${item.uuid}]{${item.name}}</strong></p>${body}`);
  }
  const content = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
    `<p><em>${game.i18n.localize(titleKey)}: ${headline}</em></p>${parts.join("")}`, {});
  await ChatMessage.create({
    content,
    speaker: ChatMessage.getSpeaker({ actor: holderActor }),
    whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id),
    flags: { [MODULE]: { reminder: true } }
  });
}

/* ------------------------------------------------------------------ turn start / end */

async function onTurnBoundary(combat, combatant, phase) {
  const token = combatant?.token?.object;
  if (!token || !canvas.ready || combatant.token?.parent?.id !== canvas.scene?.id) return;

  // traits of the creature whose turn it is
  if (setting("ownTurn")) {
    const own = passiveTraits(combatant.actor).filter(t => t.hits[phase === "start" ? "ownStart" : "ownEnd"]);
    await remind(combatant.actor, own, game.i18n.format(phase === "start" ? "TRAITREM.OwnStart" : "TRAITREM.OwnEnd",
      { holder: combatant.name }));
  }

  // auras of other creatures that this creature is standing in. Same-named auras from
  // several holders are merged into one reminder with a count, because some traits only
  // apply near two or more of them (Crossfire: "two or more curs", Horrid Stench: three).
  if (setting("auras")) {
    const key = phase === "start" ? "auraStart" : "auraEnd";
    const groups = new Map();                              // trait name -> {entry, holders[], range}
    for (const other of combat.combatants) {
      const holderToken = other.token?.object;
      if (!holderToken || other.id === combatant.id || other.isDefeated) continue;
      if (!hostile(token, holderToken)) continue;
      for (const t of passiveTraits(other.actor)) {
        const range = t.hits[key];
        if (!Number.isFinite(range) || tokenDistance(token, holderToken) > range) continue;
        const g = groups.get(t.item.name) ?? { entry: t, holders: [], range, actor: other.actor };
        g.holders.push(other.name);
        groups.set(t.item.name, g);
      }
    }
    for (const g of groups.values()) {
      const names = [...new Set(g.holders)];
      const holder = g.holders.length > 1
        ? `${g.holders.length} × ${names.join(", ")}`
        : g.holders[0];
      await remind(g.actor, [g.entry], game.i18n.format(phase === "start" ? "TRAITREM.Aura" : "TRAITREM.AuraEnd",
        { creature: combatant.name, range: g.range, holder }));
    }
  }
}

Hooks.on("combatTurnChange", async (combat, previous, current) => {
  if (!game.user.isActiveGM) return;
  try {
    const prev = previous?.combatantId && combat.combatants.get(previous.combatantId);
    if (prev) await onTurnBoundary(combat, prev, "end");
    const cur = current?.combatantId && combat.combatants.get(current.combatantId);
    if (cur) await onTurnBoundary(combat, cur, "start");
  } catch (err) { console.error(`${MODULE} | turn reminder failed`, err); }
});

/* ------------------------------------------------------------------ damage and kills */

Hooks.on("preUpdateActor", (actor, changed, options) => {
  const v = foundry.utils.getProperty(changed, "system.attributes.hp.value");
  if (v === undefined) return;
  options[`${MODULE}PrevHP`] = actor.system.attributes?.hp?.value;
});

Hooks.on("updateActor", async (actor, changed, options, userId) => {
  if (!game.user.isActiveGM) return;
  const prev = options?.[`${MODULE}PrevHP`];
  const now = actor.system.attributes?.hp?.value;
  if (prev === undefined || now === undefined || now >= prev) return;
  try {
    if (setting("onDamaged")) {
      const hurt = passiveTraits(actor).filter(t => t.hits.onDamaged);
      await remind(actor, hurt, game.i18n.format("TRAITREM.OnDamaged", { holder: actor.name }));
    }
    // `game.combat` is only the combat being viewed; a world can have several. Use the
    // started combat this creature is actually in.
    const combat = game.combats.find(c => c.started && c.combatants.some(cb =>
      cb.actor?.id === actor.id || (actor.token && cb.tokenId === actor.token.id)));
    if (setting("onKill") && prev > 0 && now <= 0 && combat) {
      const turnHolder = combat.combatant;
      if (turnHolder?.actor && turnHolder.actor.id !== actor.id) {
        const kills = passiveTraits(turnHolder.actor).filter(t => t.hits.onKill);
        await remind(turnHolder.actor, kills, game.i18n.format("TRAITREM.OnKill",
          { victim: actor.name, holder: turnHolder.name }));
      }
    }
  } catch (err) { console.error(`${MODULE} | damage reminder failed`, err); }
});

/* ------------------------------------------------------------------ reactions */

/**
 * Reaction triggers, read from the reaction's own text. `range` (feet) is taken from the
 * first "within N feet" in the text when the trigger involves another creature.
 * Measured against the imported reactions: Devilish Charm, Slip Away (targeted),
 * Fear Drinker (missed), Tug of War (melee hit), Pain Absorption / Share Agony /
 * Vengeful Charge (damaged), Absorb Soul (dies nearby), Corrupt Healing (healed nearby).
 */
const R_TRIGGERS = {
  targeted: /\b(?:is targeted by an attack|targets? (?:it|them|him|her|the [a-z' -]+?) with an attack)/i,
  missed:   /\bwhen an attack misses\b/i,
  meleeHit: /\bhits? (?:it|them|him|her|the [a-z' -]+?) with a melee attack\b/i,
  damaged:  /\b(?:takes damage|deals damage to (?:it|them|him|her|the [a-z' -]+?))\b/i,
  died:     /\bdies within (\d+) f(?:ee|oo)t\b/i,
  healed:   /within (\d+) f(?:ee|oo)t[^.]{0,60}?regains hit points/i
};
const RANGE = /within (\d+) f(?:ee|oo)t/i;

/** Reactions an actor could use right now, each with the triggers its text matches. */
function readyReactions(actor) {
  if (!actor || actor.statuses?.has("dead") || (actor.system?.attributes?.hp?.value ?? 1) <= 0) return [];
  if (actor.effects?.some(e => e.name === "Reaction Used" || e.flags?.["bf-qol"]?.reaction)) return [];
  const out = [];
  for (const item of actor.items ?? []) {
    const acts = item.system.activities?.contents ?? [];
    if (!acts.some(a => a.activation?.type === "reaction")) continue;
    const uses = item.system.uses;
    if (uses?.max && Number(uses.spent ?? 0) >= Number(uses.max)) continue;
    const text = plain(item.system.description?.value);
    const hits = {};
    for (const [k, re] of Object.entries(R_TRIGGERS)) {
      const m = re.exec(text);
      if (m) hits[k] = m[1] ? Number(m[1]) : true;
    }
    if (!Object.keys(hits).length) continue;
    const r = RANGE.exec(text);
    out.push({ item, hits, range: r ? Number(r[1]) : null });
  }
  return out;
}

const tokenOf = actor => actor?.token?.object ?? actor?.getActiveTokens?.()?.[0] ?? null;
const within = (t, a, b) => {
  if (!Number.isFinite(t.range) || !a || !b) return { ok: true, dist: null };
  const dist = tokenDistance(a, b);
  return { ok: dist <= t.range, dist };
};
const fmt = (key, data) => game.i18n.format(`TRAITREM.R.${key}`, data);

/** Attacks: read Black Flag's attack card (flags.black-flag.roll.type === "attack"). */
Hooks.on("createChatMessage", async message => {
  if (!game.user.isActiveGM || !setting("reactions")) return;
  const f = message.flags?.["black-flag"];
  if (f?.roll?.type !== "attack" || !f.targets?.length) return;
  const roll = message.rolls?.[0];
  if (!roll) return;
  try {
    const activity = f.activity?.uuid ? await fromUuid(f.activity.uuid) : null;
    const item = f.item?.uuid ? await fromUuid(f.item.uuid) : activity?.item;
    const attackerActor = item?.actor ?? ChatMessage.getSpeakerActor(message.speaker);
    const attackerTok = tokenOf(attackerActor);
    const melee = item?.system?.type?.value === "melee" || /Melee/i.test(item?.system?.description?.value ?? "");
    for (const t of f.targets) {
      const targetActor = await fromUuid(t.uuid);
      const targetTok = tokenOf(targetActor);
      const hit = roll.isCriticalSuccess || (roll.total >= t.ac && !roll.isCriticalFailure);
      for (const r of readyReactions(targetActor)) {
        const w = within(r, attackerTok, targetTok);
        if (!w.ok) continue;
        const who = { attacker: attackerActor?.name ?? message.speaker?.alias, holder: targetActor.name, dist: w.dist ?? "?" };
        if (r.hits.targeted) await remind(targetActor, [r], fmt("Targeted", who), "TRAITREM.ReactionTitle");
        else if (r.hits.missed && !hit) await remind(targetActor, [r], fmt("Missed", who), "TRAITREM.ReactionTitle");
        else if (r.hits.meleeHit && hit && melee) await remind(targetActor, [r], fmt("MeleeHit", who), "TRAITREM.ReactionTitle");
      }
    }
  } catch (err) { console.error(`${MODULE} | attack reaction reminder failed`, err); }
});

/**
 * Hit point changes. `preUpdateActor` runs only on the client that made the change, so
 * the previous value may not reach the GM when a player applied it; keep a GM-side cache.
 */
const hpCache = new Map();
Hooks.on("canvasReady", () => {
  for (const t of canvas.tokens?.placeables ?? []) {
    const hp = t.actor?.system?.attributes?.hp?.value;
    if (hp !== undefined) hpCache.set(t.actor.uuid, hp);
  }
});

Hooks.on("updateActor", async (actor, changed, options) => {
  if (!game.user.isActiveGM || !setting("reactions")) return;
  if (foundry.utils.getProperty(changed, "system.attributes.hp.value") === undefined) return;
  const now = actor.system.attributes?.hp?.value;
  const prev = options?.[`${MODULE}PrevHP`] ?? hpCache.get(actor.uuid);
  hpCache.set(actor.uuid, now);
  if (prev === undefined || now === undefined || now === prev) return;
  try {
    const selfTok = tokenOf(actor);
    if (now < prev) {
      for (const r of readyReactions(actor).filter(r => r.hits.damaged))
        await remind(actor, [r], fmt("Damaged", { holder: actor.name }), "TRAITREM.ReactionTitle");
    }
    if (!selfTok || !canvas.ready) return;
    const died = prev > 0 && now <= 0, healed = now > prev;
    if (!died && !healed) return;
    for (const other of canvas.tokens.placeables) {
      if (!other.actor || other === selfTok || other.actor.uuid === actor.uuid) continue;
      for (const r of readyReactions(other.actor)) {
        const key = died && Number.isFinite(r.hits.died) ? "died" : healed && Number.isFinite(r.hits.healed) ? "healed" : null;
        if (!key) continue;
        const dist = tokenDistance(selfTok, other);
        if (dist > r.hits[key]) continue;
        const headline = key === "died"
          ? fmt("Died", { victim: actor.name, holder: other.actor.name, dist })
          : fmt("Healed", { target: actor.name, holder: other.actor.name, dist });
        await remind(other.actor, [r], headline, "TRAITREM.ReactionTitle");
      }
    }
  } catch (err) { console.error(`${MODULE} | hit point reaction reminder failed`, err); }
});

Hooks.once("ready", () => {
  game.modules.get(MODULE).api = { passiveTraits, readyReactions, tokenDistance, TRIGGERS, R_TRIGGERS };
  console.log(`${MODULE} | ready`);
});
