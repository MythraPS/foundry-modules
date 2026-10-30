/**
 * Tamer Companions - the tamer's Pocket Familiar rules (Ryoko's Guide to the Yokai Realms) on
 * Black Flag.
 *
 * A companion is a world actor (a copy of the creature) flagged with its tamer, linked to its
 * token, owned by the tamer's players. The tamer carries a Vessel item for each. Everything is
 * driven from the Companions window (the paw button in the tamer's sheet header):
 *   - Bond: drop a creature on the window. It's checked against the Tamer Companion Summary
 *     (bonded count, size, CR) and the book's refusals (Humanoid, Giant, swarm); a GM may bond
 *     anyway (the optional non-combat taming rule). On bonding it loses the traits the book
 *     strips (spells, summons, Regeneration, Rejuvenation, Legendary Resistance, legendary and
 *     lair actions), its fixed save DCs become ability-based so they grow with the tamer, and it
 *     gets the improvements and Hit Dice the Improvements/Hit Dice Gained on Taming table gives.
 *   - Monster Trainer: a companion uses its tamer's proficiency bonus (in the prepared data, so
 *     nothing is rewritten; its attacks, saves, skills and DCs follow).
 *   - Each tamer level beyond 1st gives each companion one Companion Improvement to choose
 *     (Speed Training, Toughen Up, Ability Boost, Go For the Throat, Survival Instincts, War
 *     Training), and each Ability Score Improvement level (4, 8, 12, 16, 19) a Hit Die.
 *   - Summon (next to the tamer's token, one at a time) and Dismiss (back into the vessel; its
 *     hit points stay with the actor).
 *   - Soul Bond: heal companions from the tamer's pool (the Soul Bond feature's uses).
 *   - A long rest heals companions (all hit points, or half from 0); a companion's initiative
 *     follows its tamer's, just after it.
 * Players can't create world actors, so a player's bonding is done by the GM's client (socket).
 *
 * Bespoke familiars (Ryoko's Guide ch. 11, Heliana's Guide ch. 8; data/bespoke.json): a companion
 * bonded from one of them gets its Bonus Tamer Improvement and +2 Hit Dice, one more Hit Die at
 * tamer levels 3, 5, 11 and 17 (Shared Resilience, retroactive), and Train also offers its own
 * improvement tree (level and prerequisite checked). An improvement becomes a feature on the
 * companion; a "Growth" one also changes its size and Hit Die, and "can't do so again until its
 * tamer finishes a ... rest" gives it one use.
 * The tamer in combat (buttons in the window, each only when the tamer has the feature):
 *   - Throw vessel: at the targeted creature within 30 ft; it rolls its Charisma save against the
 *     tamer's spell save DC (an automatic success for what can't be tamed); on a failure it's
 *     bonded and its token leaves the scene.
 *   - Bolster: spend a spell slot, heal the companion 2d4 per slot circle + the casting modifier.
 *   - Switcheroo: swap the tamer's and the companion's tokens (within 100 ft), one use.
 *   - Alpha Strike: offered when summoning in a combat (one use: it acts on its turn).
 *   - Summon the Horde: up to three companions out at once; End Horde sends all but one back and
 *     leaves the tamer unable to move or act until the end of its next turn.
 *   - Wilful Blows (6th): the companion's attack damage counts as magical (Black Flag's roll flag).
 *   - Psychic Bond (2nd): see through its eyes (its token's vision; Blinded + Deafened on the tamer
 *     until the start of its next turn). Spell Swap: the companion's spells are the tamer's while it
 *     is summoned within 100 ft and the vessel is held; a reminder when a self/touch spell is cast.
 * Pact of the Chain + a bespoke familiar from Ryoko's Guide, Wrath of the Kaiju or L'Arsene's Ledger:
 * +3 Hit Dice, its 1st-level improvement and one 3rd-level improvement (Train).
 * Spirit Bonded (Ryoko's feat), for a familiar in one of the book's five forms: the tree's 1st-level
 * improvement on bonding, temporary hit points equal to the character's level on each summon
 * (doubled from 5th level), and from 5th level one 3rd-level improvement through Train.
 */
const MOD = "tselverse-companions";
const TAMER = "tamer";
const t = (s, data = {}) => s.replace(/\{(\w+)\}/g, (_, k) => data[k] ?? "");

/* ------------------------------------------------------------------ the book's tables */
// Tamer Companion Summary, by tamer level 1-20
const BONDED = [1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6];
const MAX_CR = [0.5, 0.5, 0.5, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6];
const maxSize = lvl => lvl >= 17 ? "huge" : lvl >= 11 ? "large" : lvl >= 5 ? "medium" : "small";
// Improvements/Hit Dice Gained on Taming: [improvements, hit dice] by tamer level (rows) and
// creature CR (columns: 1/2 or lower, 1, 2, 3, 4, 5, 6); null = can't be tamed yet
const ON_TAMING = [
  [[0, 0]], [[1, 0]], [[2, 0]], [[3, 1], [0, 0]], [[4, 1], [1, 0]], [[5, 1], [2, 0]],
  [[6, 1], [3, 0], [0, 0]], [[7, 2], [4, 1], [1, 1]], [[8, 2], [5, 1], [2, 1]],
  [[9, 2], [6, 1], [3, 1], [0, 0]], [[10, 2], [7, 1], [4, 1], [1, 0]], [[11, 3], [8, 2], [5, 2], [2, 1]],
  [[12, 3], [9, 2], [6, 2], [3, 1], [0, 0]], [[13, 3], [10, 2], [7, 2], [4, 1], [1, 0]], [[14, 3], [11, 2], [8, 2], [5, 1], [2, 0]],
  [[15, 4], [12, 3], [9, 3], [6, 2], [3, 1], [0, 0]], [[16, 4], [13, 3], [10, 3], [7, 2], [4, 1], [1, 0]], [[17, 4], [14, 3], [11, 3], [8, 2], [5, 1], [2, 0]],
  [[18, 5], [15, 4], [12, 4], [9, 3], [6, 2], [3, 1], [0, 0]], [[19, 5], [16, 4], [13, 4], [10, 3], [7, 2], [4, 1], [1, 0]]];
const crColumn = cr => cr <= 0.5 ? 0 : Math.min(6, Math.ceil(cr));
const HD_LEVELS = new Set([4, 8, 12, 16, 19]);          // the tamer's Ability Score Improvement levels
const SIZES = ["tiny", "small", "medium", "large", "huge", "gargantuan"];
const ABILITIES = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"];
const throatLimit = lvl => lvl >= 9 ? 3 : lvl >= 5 ? 2 : 1;
const profFor = lvl => Math.floor((Math.max(lvl, 1) - 1) / 4) + 2;

const IMPROVEMENTS = {
  speed: {label: "Speed Training", hint: "Increase one speed by 15 feet, up to 150% of its base speed."},
  tough: {label: "Toughen Up", hint: "Gain a Hit Die: roll it and add the Constitution modifier (minimum 0) to its hit point maximum."},
  ability: {label: "Ability Boost", hint: "Increase one ability score by 1, to a maximum of 20."},
  throat: {label: "Go For the Throat", hint: "+1 to attack and damage rolls with its natural weapons (once; twice from tamer level 5, three times from 9)."},
  save: {label: "Survival Instincts", hint: "Gain proficiency in one saving throw."},
  war: {label: "War Training", hint: "Gain proficiency with one armour type (light, then medium, then heavy) or two weapons."}
};

/* ------------------------------------------------------------------ who is who */
// a class's levels are the character's progression entries that point at it - read from the stored
// data, so it's right even while the tamer's own data is still being prepared
const classLevel = actor => {
  const c = actor?.items?.find(i => i.type === "class" && (i.identifier ?? i.system?.identifier?.value) === TAMER);
  if (!c) return 0;
  return Object.values(actor._source?.system?.progression?.levels ?? {}).filter(l => l?.class === c.id).length;
};
const isTamer = actor => actor?.type === "pc" && classLevel(actor) > 0;
// anyone else with a companion feature (foundry-import flags those: a ranger's beast spirit, a
// familiar master's familiar, an elemental companion...) or who already has one
const canHaveCompanions = actor => actor?.type === "pc" && (isTamer(actor)
  || actor.items.some(i => i.flags?.[MOD]?.rules) || !!pactChain(actor) || companionsOf(actor).length > 0);
const tamerOf = companion => { const u = companion?.flags?.[MOD]?.tamer; return u ? fromUuidSync(u) : null; };
const companionsOf = tamer => game.actors.filter(a => a.flags?.[MOD]?.tamer === tamer.uuid);
const soulBond = tamer => tamer.items.find(i => (i.identifier ?? i.system?.identifier?.value) === "soul-bond" || /^soul bond$/i.test(i.name));
const feature = (actor, name) => actor?.items?.find(i => i.type === "feature" && (i.name.toLowerCase() === name.toLowerCase()
  || (i.identifier ?? i.system?.identifier?.value) === name.toLowerCase().replace(/\s+/g, "-")));
const usesLeft = item => item?.system?.uses?.max ? (item.system.uses.value ?? 0) : Infinity;
const spendUse = item => item?.system?.uses?.max ? item.update({"system.uses.spent": (item.system.uses.spent ?? 0) + 1}) : null;
const castMod = tamer => { const o = tamer.system?.spellcasting?.origins?.[TAMER];
  return Math.max(1, o?.dc ? o.dc - 8 - (tamer.system.attributes?.proficiency ?? 2) : 1); };
const tokenOf = actor => actor?.getActiveTokens?.().find(tk => tk.document.parent === canvas?.scene);
const distance = (a, b) => canvas.grid.measurePath([a.center, b.center]).distance;
const spiritBonded = pc => pc?.items?.find(i => (i.identifier ?? i.system?.identifier?.value) === "spirit-bonded" || /^spirit bonded$/i.test(i.name));
const charLevel = pc => Number(pc?.system?.progression?.level) || 0;

/* ------------------------------------------------------------------ bespoke familiars */
let BESPOKE = {};
Hooks.once("ready", async () => {
  try { BESPOKE = await (await fetch(`modules/${MOD}/data/bespoke.json`)).json(); }
  catch (err) { console.warn(`${MOD} | bespoke familiars`, err); }
});
const BESPOKE_HD = [3, 5, 11, 17];
const norm = s => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s*\(released\)\s*$/, "").trim();   // ("Caskadon (APL 10)" is a different, ready-made creature)
/** The improvement tree of the bespoke familiar this companion was bonded from (null: not one). */
function treeFor(actor) {
  for (const n of [actor?.flags?.[MOD]?.sourceName, actor?.name]) {
    const k = n && Object.keys(BESPOKE).find(x => norm(x) === norm(n));
    if (k) return {key: k, ...BESPOKE[k]};
  }
  return null;
}
const ownedImprovements = companion => new Set(companion.items.filter(i => i.flags?.[MOD]?.bespoke).map(i => i.flags[MOD].bespoke));
// a Spirit Bonded familiar: one of the five forms the feat names (Ryoko's own familiars)
const spiritForm = (owner, companion) => !isTamer(owner) && spiritBonded(owner) && /Ryoko/.test(treeFor(companion)?.source ?? "");
// Pact of the Chain with a bespoke familiar: three more Hit Dice (hit points to match), the first
// improvement on its tree and one 3rd-level improvement of the player's choice - the sidebar printed in Ryoko's Guide (p225), Wrath of the Kaiju
// (p161) and L'Arsene's Ledger - Treasures & Trinkets; Heliana's Guide has no such sidebar, so its
// familiars don't get it
const pactChain = pc => pc?.items?.find(i => /^pact of the chain\b/i.test(i.name) || (i.identifier ?? i.system?.identifier?.value) === "pact-of-the-chain");
const PACT_BOOKS = /Ryoko|Kaiju|L'Ars[eè]ne/i;
const pactForm = (owner, companion) => !isTamer(owner) && !!pactChain(owner) && PACT_BOOKS.test(treeFor(companion)?.source ?? "");

/** Give a companion one improvement from its tree, as a feature. */
async function grantImprovement(companion, imp) {
  const para = imp.text.split("\n").map(l => l.startsWith("• ") ? `<li>${foundry.utils.escapeHTML(l.slice(2))}</li>` : `<p>${foundry.utils.escapeHTML(l)}</p>`).join("")
    .replace(/(<li>.*?<\/li>)+/g, m => `<ul>${m}</ul>`);
  const once = /can[’']?t (?:do so|use (?:this|it|that)[^.]*?) again until its tamer finishes a (short or long|long) rest/i.exec(imp.text);
  const data = {name: imp.name, type: "feature", img: "icons/svg/upgrade.svg",
    system: {type: {category: "monster", value: ""},
      description: {value: `<p><em>${foundry.utils.escapeHTML(imp.type)} · bespoke improvement${imp.level ? `, ${imp.level}th-level tamer` : ""}</em></p>${para}`}},
    flags: {[MOD]: {bespoke: imp.name}}};
  if (once) data.system.uses = {spent: 0, max: "1", recovery: [{period: /short/i.test(once[1]) ? "shortRest" : "longRest", type: "recoverAll"}]};
  await companion.createEmbeddedDocuments("Item", [data]);
  // an improvement that grows the companion names its new size and its new Hit Die (e.g. Small and d6);
  // the hit point maximum then rises by half the die difference for each Hit Die (d4 -> d6: +1 each)
  const g = /size increases to (tiny|small|medium|large|huge)\b[^.]*?hit die size increases to a d(\d+)/i.exec(imp.text);
  if (g) {
    const f = companion.flags[MOD], count = f?.hd?.count ?? 1, from = f?.hd?.die ?? 4, to = Number(g[2]);
    const per = Math.max(0, (to - from) / 2), hp = companion.system.attributes.hp;
    await companion.update({"system.traits.size": g[1].toLowerCase(),
      "system.attributes.hp.max": (companion._source.system.attributes.hp.max ?? hp.max) + count * per,
      "system.attributes.hp.value": hp.value + count * per, [`flags.${MOD}.hd.die`]: to});
    const tw = {tiny: 0.5, small: 1, medium: 1, large: 2, huge: 3}[g[1].toLowerCase()];
    await companion.update({"prototypeToken.width": tw, "prototypeToken.height": tw});
    for (const tk of companion.getActiveTokens()) await tk.document.update({width: tw, height: tw});
  }
  return imp.name;
}
/** The improvements of its tree this companion could take now. */
function availableImprovements(companion, maxLevel, onlyLevel = null) {
  const tree = treeFor(companion);
  if (!tree) return [];
  const have = ownedImprovements(companion);
  return tree.improvements.filter(i => !have.has(i.name) && i.level <= maxLevel && (onlyLevel == null || i.level === onlyLevel)
    && i.level > 0 && i.requires.every(r => have.has(r)));
}

/* ------------------------------------------------------------------ Monster Trainer */
// A companion's proficiency bonus is its tamer's. Black Flag sets a creature's from its CR in
// prepareBaseData and keeps each proficient ability's modifier with that bonus already in it;
// both move by the difference, so saves, attacks and ability-based DCs come out on the tamer's.
Hooks.once("init", () => {
  const model = CONFIG.Actor.dataModels?.npc;
  if (!model?.prototype?.prepareBaseData) return console.warn(`${MOD} | Black Flag NPC data model not found`);
  const original = model.prototype.prepareBaseData;
  model.prototype.prepareBaseData = function (...args) {
    const r = original.apply(this, args);
    try {
      const tamer = tamerOf(this.parent);
      const usePB = tamer && (isTamer(tamer) || this.parent.flags?.[MOD]?.usePB);
      if (usePB) {
        const pb = isTamer(tamer) ? profFor(classLevel(tamer)) : (tamer.system?.attributes?.proficiency ?? profFor(Number(tamer.system?.progression?.level) || 1));
        // (a CR-less creature with a printed PB was saved with that PB - foundry-import's flag)
        const delta = pb - (this.parent.flags?.["foundry-import"]?.pb ?? this.attributes.proficiency ?? 0);
        this.attributes.proficiency = pb;
        if (delta) for (const ab of Object.values(this.abilities ?? {})) if (ab?.proficient) ab.mod = (ab.mod ?? 0) + delta;
      }
    } catch (err) { console.warn(`${MOD} | proficiency`, err); }
    return r;
  };
});

/* ------------------------------------------------------------------ GM-side work (socket) */
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
  if (!game.users.activeGM) throw new Error("A GM has to be connected to do that.");
  const id = foundry.utils.randomID();
  return new Promise((resolve, reject) => {
    pending.set(id, {resolve, reject});
    game.socket.emit(`module.${MOD}`, {op, args, id});
    setTimeout(() => { if (pending.delete(id)) reject(new Error("The GM's client didn't answer.")); }, 20000);
  });
}

/* ------------------------------------------------------------------ bonding */
/** Why this creature can't become this tamer's companion ([] = it can). */
function refusals(tamer, creature) {
  if (!isTamer(tamer)) return [];                 // other classes' companions follow their own book
  const lvl = classLevel(tamer), out = [];
  const type = creature.system?.traits?.type?.value;
  if (["humanoid", "giant"].includes(type)) out.push(`it is a ${type[0].toUpperCase() + type.slice(1)}`);
  if (creature.system?.traits?.type?.swarm) out.push("it is a swarm");
  const size = creature.system?.traits?.size ?? "medium";
  if (SIZES.indexOf(size) > SIZES.indexOf(maxSize(lvl))) out.push(`it is ${size}; your companions can be ${maxSize(lvl)} at most`);
  const cr = Number(creature.system?.attributes?.cr ?? 0);
  if (cr > MAX_CR[lvl - 1]) out.push(`its CR is ${cr}; you can bond CR ${MAX_CR[lvl - 1]} at most`);
  return out;
}

/** The stat block's Hit Dice ("1d4 + 1" -> {count 1, die 4}), from the importer's flag or the description. */
function hitDice(data) {
  const f = data.flags?.["foundry-import"]?.hpFormula
    ?? /Hit Points\s*\d+\s*\((\d+d\d+[^)]*)\)/i.exec(String(data.system?.description?.value ?? "").replace(/<[^>]+>/g, " "))?.[1] ?? "";
  const m = /(\d+)d(\d+)/.exec(f);
  return m ? {count: Number(m[1]), die: Number(m[2])} : {count: 1, die: {tiny: 4, small: 6, medium: 8, large: 10, huge: 12}[data.system?.traits?.size] ?? 8};
}

const OPS = {
  /** Create the companion (a world actor) and the tamer's vessel. */
  async bond(tamerUuid, creatureUuid, releaseUuid = null) {
    const tamer = await fromUuid(tamerUuid), src = await fromUuid(creatureUuid);
    if (!tamer || src?.documentName !== "Actor") throw new Error("That isn't a creature.");
    if (releaseUuid) await OPS.release(releaseUuid);
    const lvl = classLevel(tamer);
    const data = src.toObject();
    delete data._id;
    const cr = Number(data.system?.attributes?.cr ?? 0);
    const creaturePB = data.flags?.["foundry-import"]?.pb ?? Math.max(2, (cr >= 1 ? Math.floor((cr - 1) / 4) + 2 : 2));
    // Lost Traits: spells, summoning, Regeneration/Rejuvenation/Legendary Resistance, legendary,
    // mythic and lair actions
    // (it "retains its spells known" - kept in the flags for the tamer's Spell Swap)
    const lost = [], spellsKnown = [];
    data.items = (data.items ?? []).filter(i => {
      const acts = Object.values(i.system?.activities ?? {});
      const gone = i.type === "spell" || /^(?:regeneration|rejuvenation|legendary resistance|legendary actions?|lair actions?|mythic)/i.test(i.name)
        || acts.some(a => ["cast", "summon"].includes(a.type) || ["legendary", "lair", "mythic"].includes(a.activation?.type));
      if (gone) lost.push(i.name);
      if (i.type === "spell") spellsKnown.push({name: i.name, uuid: i._stats?.compendiumSource ?? null, data: i});
      for (const a of acts) if (a.type === "cast" && a.system?.spell?.uuid) spellsKnown.push({name: null, uuid: a.system.spell.uuid, data: null});
      return !gone;
    });
    // a fixed save DC ("DC 13") becomes "8 + proficiency + <ability>", the ability whose numbers fit
    const baseMod = k => { const a = data.system?.abilities?.[k] ?? {}; return (a.mod ?? 0) - (a.proficient ? creaturePB : 0); };
    for (const it of data.items) for (const a of Object.values(it.system?.activities ?? {})) {
      const dc = a.system?.save?.dc;
      if (dc?.ability !== "custom" || !/^\d+$/.test(String(dc.formula ?? "").trim())) continue;
      const want = Number(dc.formula) - 8 - creaturePB;
      const ab = ABILITIES.find(k => baseMod(k) === want);
      if (ab) { dc.ability = ab; dc.formula = ""; }
    }
    const hd = hitDice(data);
    const [imp, hdGain] = isTamer(tamer) ? (ON_TAMING[lvl - 1]?.[crColumn(cr)] ?? [0, 0]) : [0, 0];
    let folder = game.folders.find(f => f.type === "Actor" && f.name === "Companions");
    folder ??= await Folder.create({name: "Companions", type: "Actor", color: "#5a7d4f"});
    const ownership = {...tamer.ownership};
    Object.assign(data, {folder: folder.id, ownership});
    data.prototypeToken = {...(data.prototypeToken ?? {}), actorLink: true, disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY};
    foundry.utils.setProperty(data, `flags.${MOD}`, {
      tamer: tamer.uuid, source: creatureUuid, sourceName: src.name, bondedAt: lvl, lastLevel: lvl, creaturePB, usePB: false,
      hd, pendingImprovements: imp, pendingHD: hdGain, improvements: [], scores: {}, lost, spellsKnown,
      baseSpeed: foundry.utils.deepClone(data.system?.traits?.movement ?? {})
    });
    const companion = await Actor.create(data);
    const tree = treeFor(companion);
    if (tree && (isTamer(tamer) || spiritForm(tamer, companion) || pactForm(tamer, companion))) {
      const first = tree.improvements.find(i => i.name === tree.bonus) ?? tree.improvements.find(i => i.level === 0);
      if (first) await grantImprovement(companion, first);
      if (pactForm(tamer, companion)) for (let i = 0; i < 3; i++) await rollHitDie(companion, "Pact of the Chain");
      if (isTamer(tamer)) await companion.update({[`flags.${MOD}.bespoke`]: true,
        [`flags.${MOD}.pendingHD`]: hdGain + (tree.bonusHD ?? 2) + BESPOKE_HD.filter(L => L <= lvl).length});
    }
    await tamer.createEmbeddedDocuments("Item", [{
      name: `Vessel: ${companion.name}`, type: "gear", img: "icons/containers/ammunition/orb-glass-blue.webp",
      system: {description: {value: `<p>The vessel @UUID[${companion.uuid}]{${companion.name}} lives in when it isn't summoned. To summon or dismiss it you must be holding this vessel. If it's broken, the creature is released and is no longer your companion.</p>`}},
      flags: {[MOD]: {companion: companion.uuid}}
    }]);
    return companion.uuid;
  },

  /** A creature trapped in a vessel leaves the battlefield. */
  async removeToken(tokenUuid) { const t = await fromUuid(tokenUuid); await t?.delete(); return true; },

  /** Release a companion: it stops being one (the actor stays, unflagged), its vessel goes. */
  async release(companionUuid) {
    const c = await fromUuid(companionUuid);
    const tamer = tamerOf(c);
    if (tamer) {
      const vessels = tamer.items.filter(i => i.flags?.[MOD]?.companion === companionUuid).map(i => i.id);
      if (vessels.length) await tamer.deleteEmbeddedDocuments("Item", vessels);
    }
    await c?.update({[`flags.-=${MOD}`]: null, name: `${c.name} (released)`});
    return true;
  }
};

/* ------------------------------------------------------------------ level-ups */
/** Bring a companion's pending improvements and Hit Dice up to its tamer's level. */
async function catchUp(companion) {
  const tamer = tamerOf(companion), f = companion.flags[MOD];
  if (!tamer || !isTamer(tamer)) return;
  const lvl = classLevel(tamer);
  if (lvl <= (f.lastLevel ?? lvl)) return;
  let imp = 0, hd = 0;
  for (let L = (f.lastLevel ?? lvl) + 1; L <= lvl; L++) { if (L > 1) imp++; if (HD_LEVELS.has(L)) hd++; if (f.bespoke && BESPOKE_HD.includes(L)) hd++; }
  await companion.update({[`flags.${MOD}.lastLevel`]: lvl, [`flags.${MOD}.pendingImprovements`]: (f.pendingImprovements ?? 0) + imp,
                          [`flags.${MOD}.pendingHD`]: (f.pendingHD ?? 0) + hd});
}
Hooks.on("updateItem", (item, changes) => {
  if (item.type !== "class" || !foundry.utils.hasProperty(changes, "system.levels") || !game.users.activeGM?.isSelf) return;
  if ((item.identifier ?? item.system?.identifier?.value) !== TAMER || !item.parent) return;
  for (const c of companionsOf(item.parent)) { c.reset(); catchUp(c); c.sheet?.rendered && c.sheet.render(); }
});

/* ------------------------------------------------------------------ training */
async function rollHitDie(companion, label) {
  const f = companion.flags[MOD];
  const con = Math.max(0, companion.system.abilities?.constitution?.mod ?? 0);
  const roll = await new Roll(`1d${f.hd?.die ?? 8} + ${con}`).evaluate();
  await roll.toMessage({speaker: ChatMessage.getSpeaker({actor: companion}), flavor: `${label}: a new Hit Die (d${f.hd?.die ?? 8})`});
  const hp = companion.system.attributes.hp;
  await companion.update({"system.attributes.hp.max": (companion._source.system.attributes.hp.max ?? hp.max) + roll.total,
                          "system.attributes.hp.value": hp.value + roll.total,
                          [`flags.${MOD}.hd.count`]: (f.hd?.count ?? 1) + 1});
  return roll.total;
}

async function train(companion) {
  const owner = tamerOf(companion);
  if (owner && !isTamer(owner)) return spiritTrain(companion, owner);
  await catchUp(companion);
  const f = companion.flags[MOD], tamer = tamerOf(companion), lvl = classLevel(tamer);
  if ((f.pendingHD ?? 0) > 0) {
    const n = f.pendingHD;
    for (let i = 0; i < n; i++) await rollHitDie(companion, "Training");
    await companion.update({[`flags.${MOD}.pendingHD`]: 0});
  }
  if (!(companion.flags[MOD].pendingImprovements > 0)) return ui.notifications.info(`${companion.name} has no improvements to choose.`);
  const throats = (f.improvements ?? []).filter(i => i.type === "throat").length;
  const saves = ABILITIES.filter(a => !companion._source.system.abilities?.[a]?.proficient);
  const speeds = Object.entries(companion.system.traits?.movement?.types ?? {}).filter(([, v]) => v).map(([k]) => k);
  const opt = (k, ok = true) => `<label class="tsvcmp-opt${ok ? "" : " off"}"><input type="radio" name="type" value="${k}" ${ok ? "" : "disabled"}> <b>${IMPROVEMENTS[k].label}</b><span>${IMPROVEMENTS[k].hint}</span></label>`;
  const content = `<p>${companion.name}: <b>${companion.flags[MOD].pendingImprovements}</b> improvement(s) to choose.</p>
    ${opt("speed", speeds.length > 0)}
    <div class="tsvcmp-sub">Speed <select name="speed">${speeds.map(s => `<option>${s}</option>`).join("")}</select></div>
    ${opt("tough")}${opt("ability")}
    <div class="tsvcmp-sub">Ability <select name="ability">${ABILITIES.map(a => `<option value="${a}">${a}</option>`).join("")}</select>
      current score <input type="number" name="score" min="1" max="30" placeholder="(asked once)"></div>
    ${opt("throat", throats < throatLimit(lvl))}${opt("save", saves.length > 0)}
    <div class="tsvcmp-sub">Save <select name="saveAbility">${saves.map(a => `<option value="${a}">${a}</option>`).join("")}</select></div>
    ${opt("war")}<div class="tsvcmp-sub">Armour or weapons <input type="text" name="war" placeholder="light armour / two weapons"></div>
    ${bespokeOptions(companion, lvl)}`;
  const res = await foundry.applications.api.DialogV2.prompt({window: {title: `Train ${companion.name}`}, content,
    ok: {label: "Apply", callback: (ev, btn) => new foundry.applications.ux.FormDataExtended(btn.form).object}, rejectClose: false});
  if (!res?.type) return;
  const rec = {type: res.type, at: lvl};
  if (res.type.startsWith("b:")) {
    const imp = treeFor(companion)?.improvements.find(i => i.name === res.type.slice(2));
    if (!imp) return;
    rec.type = "bespoke"; rec.detail = await grantImprovement(companion, imp);
    await companion.update({[`flags.${MOD}.improvements`]: [...(f.improvements ?? []), rec],
                            [`flags.${MOD}.pendingImprovements`]: companion.flags[MOD].pendingImprovements - 1});
    return ui.notifications.info(`${companion.name}: ${imp.name}`);
  }
  const src = companion._source.system;
  if (res.type === "speed") {
    const base = Number(f.baseSpeed?.base ?? src.traits.movement.base ?? 30);
    if (res.speed === "walk" || companion.system.traits.movement.types?.[res.speed] === "@base") {
      const cap = Math.ceil(base * 1.5 / 5) * 5;
      const now = Number(src.traits.movement.base ?? base);
      await companion.update({"system.traits.movement.base": Math.min(now + 15, cap)});
      rec.detail = `${res.speed} ${now} -> ${Math.min(now + 15, cap)} ft.`;
    } else {
      const cur = Number(src.traits.movement.types?.[res.speed]) || 0, b0 = Number(f.baseSpeed?.types?.[res.speed]) || cur;
      const cap = Math.ceil(b0 * 1.5 / 5) * 5;
      await companion.update({[`system.traits.movement.types.${res.speed}`]: String(Math.min(cur + 15, cap))});
      rec.detail = `${res.speed} ${cur} -> ${Math.min(cur + 15, cap)} ft.`;
    }
  } else if (res.type === "tough") {
    rec.detail = `+${await rollHitDie(companion, "Toughen Up")} hit points`;
  } else if (res.type === "ability") {
    const k = res.ability, a = src.abilities?.[k] ?? {mod: 0};
    const base = (a.mod ?? 0) - (a.proficient ? f.creaturePB : 0);
    const score = Number(f.scores?.[k] ?? res.score) || (10 + 2 * base);
    if (score >= 20) return ui.notifications.warn(`${k} is already 20.`);
    const next = score + 1, delta = Math.floor((next - 10) / 2) - Math.floor((score - 10) / 2);
    await companion.update({[`system.abilities.${k}.mod`]: (a.mod ?? 0) + delta, [`flags.${MOD}.scores.${k}`]: next});
    rec.detail = `${k} ${score} -> ${next}`;
  } else if (res.type === "throat") {
    const weapons = companion.items.filter(i => i.type === "weapon" && !i.system?.type?.base);
    for (const w of weapons) await w.update({"system.magicalBonus": String((Number(w._source.system.magicalBonus) || 0) + 1)});
    rec.detail = `natural weapons +${throats + 1} (${weapons.map(w => w.name).join(", ") || "none found"})`;
  } else if (res.type === "save") {
    const k = res.saveAbility, a = src.abilities?.[k] ?? {mod: 0};
    await companion.update({[`system.abilities.${k}.proficient`]: true, [`system.abilities.${k}.mod`]: (a.mod ?? 0) + f.creaturePB});
    rec.detail = `${k} saves`;
  } else if (res.type === "war") rec.detail = res.war || "(unspecified)";
  await companion.update({[`flags.${MOD}.improvements`]: [...(f.improvements ?? []), rec],
                          [`flags.${MOD}.pendingImprovements`]: companion.flags[MOD].pendingImprovements - 1});
  ui.notifications.info(`${companion.name}: ${IMPROVEMENTS[res.type].label} - ${rec.detail}`);
}

/** The radio options for a bespoke familiar's own improvements (those it can take at this level). */
function bespokeOptions(companion, lvl) {
  const list = availableImprovements(companion, lvl);
  if (!list.length) return "";
  const esc = foundry.utils.escapeHTML;
  return `<h4 class="tsvcmp-bespoke">${esc(treeFor(companion).key)} improvements</h4>` + list.map(i =>
    `<label class="tsvcmp-opt"><input type="radio" name="type" value="b:${esc(i.name)}"> <b>${esc(i.name)}</b>
      <span>${i.level}th-level tamer${i.requires.length ? `, after ${esc(i.requires.join(", "))}` : ""} · ${esc(i.type)}. ${esc(i.text.length > 260 ? i.text.slice(0, 257) + "..." : i.text)}</span></label>`).join("");
}
/** Spirit Bonded: from 5th level, one of the familiar's 3rd-level improvements. */
const spiritPending = (companion, owner) => (pactForm(owner, companion) || (spiritForm(owner, companion) && charLevel(owner) >= 5))
  && !companion.items.some(i => i.flags?.[MOD]?.bespoke && treeFor(companion)?.improvements.find(x => x.name === i.flags[MOD].bespoke)?.level === 3);
async function spiritTrain(companion, owner) {
  if (!spiritPending(companion, owner)) return ui.notifications.info(`${companion.name} has no improvement to choose${spiritForm(owner, companion) ? " (Spirit Bonded gives a 3rd-level one at 5th level)" : ""}.`);
  const content = `<p>${pactForm(owner, companion) ? "Pact of the Chain" : "Spirit Bonded"}: choose one of ${companion.name}'s 3rd-level improvements.</p>` + bespokeOptions(companion, 3)
    .replace(/<h4[^>]*>.*?<\/h4>/, "");
  const res = await foundry.applications.api.DialogV2.prompt({window: {title: `Spirit Bonded: ${companion.name}`}, content,
    ok: {label: "Apply", callback: (ev, btn) => new foundry.applications.ux.FormDataExtended(btn.form).object}, rejectClose: false});
  const imp = res?.type?.startsWith("b:") && treeFor(companion)?.improvements.find(i => i.name === res.type.slice(2) && i.level === 3);
  if (!imp) return;
  await grantImprovement(companion, imp);
  ui.notifications.info(`${companion.name}: ${imp.name}`);
}

/* ------------------------------------------------------------------ summon / dismiss */
async function summon(companion, {horde = false} = {}) {
  const tamer = tamerOf(companion);
  if (!canvas?.scene) return ui.notifications.warn("Open a scene first.");
  if (isTamer(tamer) && !horde && !tamer.getFlag(MOD, "horde")) {   // a tamer has one companion out at a time
    const out = companionsOf(tamer).filter(c => c !== companion && c.getActiveTokens().length);
    for (const c of out) await dismiss(c, {quiet: true});
  }
  if (companion.getActiveTokens().length) return ui.notifications.info(`${companion.name} is already summoned.`);
  const near = tamer.getActiveTokens()[0];
  const g = canvas.grid.size;
  let pos = {x: canvas.stage.pivot.x, y: canvas.stage.pivot.y};
  if (near) {
    const taken = (x, y) => canvas.tokens.placeables.some(tk => tk.document.x === x && tk.document.y === y);
    const rings = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1], [2, 0], [0, 2], [-2, 0], [0, -2]];
    const w = near.document.width;
    const spot = rings.map(([dx, dy]) => ({x: near.document.x + dx * g * (dx > 0 ? w : 1), y: near.document.y + dy * g * (dy > 0 ? w : 1)}))
      .find(p => !taken(p.x, p.y));
    pos = spot ?? {x: near.document.x + g, y: near.document.y};
  }
  const td = await companion.getTokenDocument({x: pos.x, y: pos.y});
  await canvas.scene.createEmbeddedDocuments("Token", [td.toObject()]);
  if (spiritForm(tamer, companion)) {             // Spirit Bonded: temporary hit points = level, doubled from 5th
    const lv = charLevel(tamer), temp = lv >= 5 ? lv * 2 : lv;
    if (temp > (companion.system.attributes.hp.temp ?? 0)) await companion.update({"system.attributes.hp.temp": temp});
  }
  ChatMessage.create({speaker: ChatMessage.getSpeaker({actor: tamer}), content: `<p>${tamer.name} summons <b>${companion.name}</b> from its vessel.</p>`});
  // Alpha Strike: as part of summoning it, command it to take an action on its turn
  const alpha = feature(tamer, "Alpha Strike");
  if (alpha && !horde && game.combat?.started && usesLeft(alpha) > 0
      && await foundry.applications.api.DialogV2.confirm({window: {title: "Alpha Strike"},
        content: `<p>Command ${companion.name} to take an action on its turn as you summon it? (${usesLeft(alpha)} use(s) left)</p>`})) {
    await spendUse(alpha);
    ChatMessage.create({speaker: ChatMessage.getSpeaker({actor: tamer}), content: `<p><b>Alpha Strike:</b> ${companion.name} will take an action of ${tamer.name}'s choice on its turn.</p>`});
  }
}

/* ------------------------------------------------------------------ the tamer in combat */
// Wilful Blows (tamer 6th level): the companions' attacks are magical when it comes to resistance and
// immunity to nonmagical attacks and damage. Black Flag marks that on each
// damage roll (options.magical, as it does for magical ammunition); its damage application then skips
// the target's resistances/immunities to nonmagical damage
Hooks.on("blackFlag.preRollDamage", rollConfig => {
  const activity = rollConfig?.subject, tamer = tamerOf(activity?.actor);
  if (!isTamer(tamer) || classLevel(tamer) < 6 || activity?.type !== "attack") return;
  for (const r of rollConfig.rolls ?? []) (r.options ??= {}).magical = true;
});

// Psychic Bond (tamer 2nd level, Ryoko's Guide p198): an action lets the tamer use the companion's
// sight and hearing, special senses included, until their next turn starts, while their own eyes and
// ears count as blind and deaf. Its token is selected (the scene shows its vision, with its senses) and the tamer
// gets a Psychic Bond effect with the Blinded and Deafened conditions, removed at the start of the
// tamer's next turn in combat (or by pressing the eye button again). The telepathy within 100 feet
// has nothing to automate.
const psychicEffect = tamer => tamer.effects.find(e => e.flags?.[MOD]?.psychicBond);
async function seeThrough(tamer, companion) {
  const on = psychicEffect(tamer);
  if (on) {                                       // the button again: back to the tamer's own senses
    await on.delete();
    tokenOf(tamer)?.control({releaseOthers: true});
    return;
  }
  const ct = tokenOf(companion), tt = tokenOf(tamer);
  if (!ct) return ui.notifications.warn(`${companion.name} isn't on this scene.`);
  if (tt && distance(tt, ct) > 100) return ui.notifications.warn(`${companion.name} is more than 100 feet away.`);
  if (!ct.document.sight?.enabled) await ct.document.update({"sight.enabled": true});
  const c = game.combat?.started ? game.combat : null;
  await tamer.createEmbeddedDocuments("ActiveEffect", [{name: `Psychic Bond: ${companion.name}`, img: "icons/svg/eye.svg",
    statuses: ["blinded", "deafened"], origin: feature(tamer, "Psychic Bond")?.uuid,
    duration: c ? {value: 1, units: "rounds", expiry: "turnStart"} : {},
    description: `<p>Seeing through ${foundry.utils.escapeHTML(companion.name)}'s eyes and hearing what it hears, with its special senses, until your next turn starts. Your own eyes and ears are blind and deaf meanwhile.</p>`,
    flags: {[MOD]: {psychicBond: companion.uuid, combat: c?.id ?? null, round: c?.round ?? null}}}]);
  ct.control({releaseOthers: true});
  canvas.animatePan({x: ct.center.x, y: ct.center.y});
  ChatMessage.create({speaker: ChatMessage.getSpeaker({actor: tamer}), whisper: ownersOf(tamer),
    content: `<p><b>Psychic Bond</b> (action): ${tamer.name} sees through ${companion.name}'s eyes and hears what it hears until the start of their next turn, and is deaf and blind with regard to their own senses.</p>`});
}
const ownersOf = actor => game.users.filter(u => u.isGM || actor.testUserPermission(u, "OWNER")).map(u => u.id);
// the start of the tamer's next turn ends it
Hooks.on("combatTurnChange", combat => {
  if (!game.users.activeGM?.isSelf) return;
  const actor = combat.combatant?.actor, fx = actor && psychicEffect(actor);
  if (fx) fx.delete();                           // any start of its turn comes after the effect began
});

// Spell Swap (part of Psychic Bond): with the companion summoned, no more than 100 feet away and its
// vessel in the tamer's hand, the tamer knows the companion's spells too, and can aim their own
// self- or touch-range spells at the companion. A bonded creature keeps its spells known (Lost Traits only takes the ability to cast
// them), so while those three things are true its spells are on the tamer's sheet as tamer spells
// (always prepared, cast with the tamer's slots and spellcasting ability, the compendium version of
// each where there is one); they go again when it is dismissed, moves out of range or the vessel is
// lost. Carrying the vessel counts as holding it (Black Flag gear has no "held" state). The
// self/touch part is a whispered reminder when such a spell is cast: target the companion and apply
// from the card.
const swapItems = tamer => tamer.items.filter(i => i.flags?.[MOD]?.spellSwap);
function swapReady(tamer, companion) {
  if (!isTamer(tamer) || !feature(tamer, "Psychic Bond")) return false;
  if (!tamer.items.some(i => i.flags?.[MOD]?.companion === companion.uuid)) return false;      // its vessel
  const tt = tamer.getActiveTokens().find(tk => tk.document.parent), ct = tt && companion.getActiveTokens().find(tk => tk.document.parent === tt.document.parent);
  if (!ct) return false;
  if (tt.document.parent === canvas?.scene) return distance(tt, ct) <= 100;
  const d = Math.hypot(tt.document.x - ct.document.x, tt.document.y - ct.document.y) / (tt.document.parent.grid.size || 100);
  return d * (tt.document.parent.grid.distance || 5) <= 100;
}
/** The spells a companion knows: those kept when it was bonded, or (bonded before that) its source's. */
async function knownSpells(companion) {
  let list = companion.flags[MOD]?.spellsKnown;
  if (!list) {
    const src = await fromUuid(companion.flags[MOD]?.source ?? "").catch(() => null);
    list = [];
    for (const i of src?.items ?? []) {
      if (i.type === "spell") list.push({name: i.name, uuid: i._stats?.compendiumSource ?? null, data: i.toObject()});
      for (const a of i.system?.activities ?? []) if (a.type === "cast" && a.spell?.uuid) list.push({name: null, uuid: a.spell.uuid, data: null});
    }
  }
  const out = new Map();
  for (const s of list) {
    let doc = s.uuid ? await fromUuid(s.uuid).catch(() => null) : null;
    if (doc?.type !== "spell") doc = s.name ? await packSpell(s.name) : null;
    const data = doc ? doc.toObject() : s.data ? plainSpell(foundry.utils.deepClone(s.data)) : null;
    if (!data || data.type !== "spell") continue;
    if (doc) foundry.utils.setProperty(data, "_stats.compendiumSource", doc.uuid);
    out.set(data.name.toLowerCase(), data);
  }
  return [...out.values()];
}
/** The compendium's own copy of a spell (a creature's copy may be "1/day" innate), by name. */
let SPELL_INDEX = null;
async function packSpell(name) {
  if (!SPELL_INDEX) {
    SPELL_INDEX = new Map();
    // the world's own packs first (its house-rule copies), then the rest
    const packs = game.packs.filter(p => p.documentName === "Item").sort((a, b) => (b.metadata.packageType === "world") - (a.metadata.packageType === "world"));
    for (const pack of packs)
      for (const e of await pack.getIndex({fields: ["type"]})) if (e.type === "spell" && !SPELL_INDEX.has(e.name.toLowerCase())) SPELL_INDEX.set(e.name.toLowerCase(), e.uuid);
  }
  const u = SPELL_INDEX.get(String(name).toLowerCase());
  return u ? fromUuid(u).catch(() => null) : null;
}
/** A creature's spell with its own limited uses taken off (the tamer casts it with spell slots). */
function plainSpell(data) {
  delete data.system?.uses;
  for (const a of Object.values(data.system?.activities ?? {})) {
    if (a.uses) a.uses = {spent: 0, max: "", recovery: []};
    if (a.consumption?.targets) a.consumption.targets = a.consumption.targets.filter(t => !["item", "activity"].includes(t.type));
  }
  return data;
}
const syncing = new Map();
async function syncSpellSwap(tamer) {
  if (!tamer || tamer.type !== "pc") return;
  const want = new Map();                          // spell name -> {data, companion}
  for (const c of companionsOf(tamer)) {
    if (!swapReady(tamer, c)) continue;
    for (const d of await knownSpells(c)) if (!want.has(d.name.toLowerCase())) want.set(d.name.toLowerCase(), {data: d, companion: c});
  }
  const have = swapItems(tamer);
  const gone = have.filter(i => want.get(i.name.toLowerCase())?.companion.uuid !== i.flags[MOD].spellSwap).map(i => i.id);
  const own = new Set(tamer.items.filter(i => i.type === "spell" && !i.flags?.[MOD]?.spellSwap).map(i => i.name.toLowerCase()));
  const keep = new Set(have.filter(i => !gone.includes(i.id)).map(i => i.name.toLowerCase()));
  const add = [];
  for (const [k, {data, companion}] of want) {
    if (own.has(k) || keep.has(k)) continue;
    delete data._id; delete data.folder; delete data.sort;
    delete data.system?.uses;
    data.flags = {...(data.flags ?? {}), [MOD]: {spellSwap: companion.uuid},
      "black-flag": {...(data.flags?.["black-flag"] ?? {}), relationship: {enabled: true, mode: "standard", alwaysPrepared: true, prepared: true,
        origin: {identifier: TAMER}}}};
    data.system.description ??= {};
    data.system.description.value = `<p><em>Spell Swap: known by ${foundry.utils.escapeHTML(companion.name)} - yours while it is summoned, within 100 feet and you hold its vessel.</em></p>` + (data.system.description.value ?? "");
    add.push(data);
  }
  if (gone.length) await tamer.deleteEmbeddedDocuments("Item", gone);
  if (add.length) await tamer.createEmbeddedDocuments("Item", add);
  if (gone.length || add.length) ui.notifications.info(`Spell Swap: ${tamer.name} ${[add.length && `gains ${add.map(d => d.name).join(", ")}`, gone.length && `loses ${gone.length} spell(s)`].filter(Boolean).join("; ")}.`);
}
/** One client does the work: the active GM, or with none the first active owner of the tamer. */
function queueSwap(tamer) {
  if (!tamer || !isTamer(tamer)) return;
  const doer = game.users.activeGM ?? game.users.find(u => u.active && tamer.testUserPermission(u, "OWNER"));
  if (!doer?.isSelf) return;
  clearTimeout(syncing.get(tamer.uuid));
  syncing.set(tamer.uuid, setTimeout(() => { syncing.delete(tamer.uuid); runSwap(tamer); }, 300));
}
// one sync at a time per tamer (the first one reads the spell compendium indexes and can be slow)
const swapChain = new Map();
function runSwap(tamer) {
  const next = (swapChain.get(tamer.uuid) ?? Promise.resolve()).then(() => syncSpellSwap(tamer)).catch(err => console.warn(`${MOD} | Spell Swap`, err));
  swapChain.set(tamer.uuid, next);
  return next;
}
const swapTamerOf = actor => actor?.type === "pc" ? actor : tamerOf(actor);
for (const h of ["createToken", "deleteToken"]) Hooks.on(h, tk => queueSwap(swapTamerOf(tk.actor)));
Hooks.on("updateToken", (tk, changes) => { if ("x" in changes || "y" in changes) queueSwap(swapTamerOf(tk.actor)); });
for (const h of ["createItem", "deleteItem"]) Hooks.on(h, item => {
  if (item.parent?.documentName === "Actor" && (item.flags?.[MOD]?.companion || (item.type === "feature" && /^psychic bond$/i.test(item.name)))) queueSwap(item.parent);
});
Hooks.on("blackFlag.postActivateActivity", activity => {
  const tamer = activity?.actor, spell = activity?.item;
  if (spell?.type !== "spell" || !isTamer(tamer) || !["self", "touch"].includes(spell.system?.range?.unit)) return;
  const ready = companionsOf(tamer).filter(c => swapReady(tamer, c));
  if (!ready.length) return;
  ChatMessage.create({speaker: ChatMessage.getSpeaker({actor: tamer}), whisper: ownersOf(tamer),
    content: `<p><b>Spell Swap:</b> ${foundry.utils.escapeHTML(spell.name)} has a range of ${spell.system.range.unit}, so ${ready.map(c => foundry.utils.escapeHTML(c.name)).join(" or ")} can be its target instead: target its token and apply from the card.</p>`});
});

// Multiattack (tamer 5th level): before it, a tamer's companion can't use its Multiattack action
Hooks.on("blackFlag.preActivateActivity", activity => {
  const tamer = tamerOf(activity.actor);
  if (!isTamer(tamer) || !/^multiattack\b/i.test(activity.item?.name ?? "") || classLevel(tamer) >= 5) return;
  ui.notifications.warn(`${activity.actor.name} can't use Multiattack until ${tamer.name} is a 5th-level tamer.`);
  return false;
});

async function bolster(tamer, companion) {
  if (!feature(tamer, "Bolster")) return;
  const tt = tokenOf(tamer), ct = tokenOf(companion);
  if (tt && ct && distance(tt, ct) > 100) return ui.notifications.warn(`${companion.name} is more than 100 feet away.`);
  const slots = Object.entries(tamer.system.spellcasting?.slots ?? {}).filter(([, v]) => (v?.value ?? 0) > 0 && (v.circle ?? 0) > 0);
  if (!slots.length) return ui.notifications.warn(`${tamer.name} has no spell slots left.`);
  const slot = await foundry.applications.api.DialogV2.prompt({window: {title: `Bolster ${companion.name}`},
    content: `<p>Spend a spell slot: ${companion.name} regains 2d4 per circle + ${castMod(tamer)}.</p><p><select name="s">${slots.map(([k, v]) =>
      `<option value="${k}">${v.label ?? k} (${v.value} left)</option>`).join("")}</select></p>`,
    ok: {label: "Bolster", callback: (ev, btn) => btn.form.elements.s.value}, rejectClose: false});
  if (!slot) return;
  const data = tamer.system.spellcasting.slots[slot], circle = data.circle ?? Number(/\d+/.exec(slot)?.[0]) ?? 1;
  const roll = await new Roll(`${2 * circle}d4 + ${castMod(tamer)}`).evaluate();
  await roll.toMessage({speaker: ChatMessage.getSpeaker({actor: tamer}), flavor: `Bolster: ${companion.name} regains hit points (circle ${circle} slot)`});
  await tamer.update({[`system.spellcasting.slots.${slot}.spent`]: (data.spent ?? 0) + 1});
  const hp = companion.system.attributes.hp;
  await companion.update({"system.attributes.hp.value": Math.min(hp.max, hp.value + roll.total)});
}

async function switcheroo(tamer, companion) {
  const f = feature(tamer, "Switcheroo");
  if (!f) return;
  if (usesLeft(f) <= 0) return ui.notifications.warn("No Switcheroo uses left.");
  const tt = tokenOf(tamer), ct = tokenOf(companion);
  if (!tt || !ct) return ui.notifications.warn(`${tamer.name} and ${companion.name} both need to be on this scene.`);
  if (distance(tt, ct) > 100) return ui.notifications.warn(`${companion.name} is more than 100 feet away.`);
  const a = {x: tt.document.x, y: tt.document.y}, b = {x: ct.document.x, y: ct.document.y};
  await canvas.scene.updateEmbeddedDocuments("Token", [{_id: tt.id, ...b}, {_id: ct.id, ...a}], {animate: false, teleport: true});
  await spendUse(f);
  ChatMessage.create({speaker: ChatMessage.getSpeaker({actor: tamer}), content: `<p><b>Switcheroo:</b> ${tamer.name} and ${companion.name} switch places. (If it was a reaction to an attack, the creature now in the targeted space becomes the target.)</p>`});
}

async function summonHorde(tamer) {
  const f = feature(tamer, "Summon the Horde");
  if (!f) return;
  if (usesLeft(f) <= 0) return ui.notifications.warn("Summon the Horde is used up until your next long rest.");
  const list = companionsOf(tamer), out = list.filter(c => tokenOf(c));
  const pick = await foundry.applications.api.DialogV2.prompt({window: {title: "Summon the Horde"},
    content: `<p>Summon companions for 1 minute (at most three out at once):</p>${list.map(c =>
      `<label style="display:block"><input type="checkbox" name="c" value="${c.uuid}" ${tokenOf(c) ? "checked disabled" : ""}> ${foundry.utils.escapeHTML(c.name)}</label>`).join("")}`,
    ok: {label: "Summon", callback: (ev, btn) => [...btn.form.querySelectorAll('input[name="c"]:checked:not(:disabled)')].map(i => i.value)}, rejectClose: false});
  if (!pick?.length) return;
  if (out.length + pick.length > 3) return ui.notifications.warn("At most three companions can be summoned at once.");
  await tamer.setFlag(MOD, "horde", {worldTime: game.time.worldTime, round: game.combat?.round ?? null});
  for (const u of pick) await summon(fromUuidSync(u), {horde: true});
  await spendUse(f);
  ChatMessage.create({speaker: ChatMessage.getSpeaker({actor: tamer}), content: `<p><b>Summon the Horde:</b> ${tamer.name}'s companions answer for 1 minute. As an action each turn, ${tamer.name} can command them all.</p>`});
}
async function endHorde(tamer) {
  const out = companionsOf(tamer).filter(c => tokenOf(c));
  let keep = out[0]?.uuid;
  if (out.length > 1) keep = await foundry.applications.api.DialogV2.prompt({window: {title: "End the Horde"},
    content: `<p>Which companion stays?</p><p><select name="k">${out.map(c => `<option value="${c.uuid}">${foundry.utils.escapeHTML(c.name)}</option>`).join("")}</select></p>`,
    ok: {label: "End", callback: (ev, btn) => btn.form.elements.k.value}, rejectClose: false});
  if (!keep) return;
  for (const c of out) if (c.uuid !== keep) await dismiss(c, {quiet: true});
  await tamer.unsetFlag(MOD, "horde");
  await tamer.createEmbeddedDocuments("ActiveEffect", [{name: "Horde Lethargy", img: "icons/svg/sleep.svg", statuses: ["incapacitated"],
    changes: [{key: "system.traits.movement.base", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "0"}],
    duration: {value: 1, units: "rounds", expiry: "turnEnd"}, description: "<p>Summon the Horde: no moving and no actions until your next turn is over.</p>",
    flags: {[MOD]: {horde: true}}}]);
  ChatMessage.create({speaker: ChatMessage.getSpeaker({actor: tamer}), content: `<p>The horde returns to its vessels; a wave of lethargy sweeps over ${tamer.name}.</p>`});
}
async function dismiss(companion, {quiet = false} = {}) {
  const ids = companion.getActiveTokens().filter(tk => tk.document.parent === canvas.scene).map(tk => tk.id);
  if (ids.length) await canvas.scene.deleteEmbeddedDocuments("Token", ids);
  if (!quiet) ChatMessage.create({speaker: ChatMessage.getSpeaker({actor: tamerOf(companion)}), content: `<p><b>${companion.name}</b> returns to its vessel.</p>`});
}

/* ------------------------------------------------------------------ Soul Bond */
async function soulBondHeal(tamer, companion) {
  const feat = soulBond(tamer);
  if (!feat?.system?.uses?.max) return ui.notifications.warn(`${tamer.name} has no Soul Bond pool.`);
  const left = (feat.system.uses.max ?? 0) - (feat.system.uses.spent ?? 0);
  const hp = companion.system.attributes.hp, missing = hp.max - hp.value;
  const amount = await foundry.applications.api.DialogV2.prompt({window: {title: "Soul Bond"},
    content: `<p>Pool: <b>${left}</b> left. ${companion.name} is missing ${missing} hit points.</p><p><input type="number" name="n" value="${Math.min(left, missing)}" min="1" max="${Math.min(left, missing)}"></p>`,
    ok: {label: "Heal", callback: (ev, btn) => Number(btn.form.elements.n.value)}, rejectClose: false});
  const n = Math.min(Number(amount) || 0, left, missing);
  if (n <= 0) return;
  await companion.update({"system.attributes.hp.value": hp.value + n});
  await feat.update({"system.uses.spent": (feat.system.uses.spent ?? 0) + n});
  ChatMessage.create({speaker: ChatMessage.getSpeaker({actor: tamer}), content: `<p>Soul Bond: ${companion.name} regains <b>${n}</b> hit points (${left - n} left in the pool).</p>`});
}

/* ------------------------------------------------------------------ rests and initiative */
Hooks.on("blackFlag.restCompleted", async (actor, result) => {
  if (result?.type !== "long" || !companionsOf(actor).length || !actor.isOwner) return;
  for (const c of companionsOf(actor)) {
    const hp = c.system.attributes.hp;
    const to = hp.value >= 1 ? hp.max : Math.floor(hp.max / 2);
    if (to !== hp.value && c.isOwner) await c.update({"system.attributes.hp.value": to});
  }
});
// a companion acts right after its tamer
async function follow(combat) {
  if (!game.users.activeGM?.isSelf || !combat) return;
  const updates = [];
  for (const cb of combat.combatants) {
    const tamer = tamerOf(cb.actor);
    if (!tamer) continue;
    const lead = combat.combatants.find(x => x.actor === tamer);
    if (lead?.initiative == null) continue;
    const want = lead.initiative - 0.01;
    if (cb.initiative !== want) updates.push({_id: cb.id, initiative: want});
  }
  if (updates.length) await combat.updateEmbeddedDocuments("Combatant", updates);
}
Hooks.on("updateCombatant", cb => follow(cb.parent));
Hooks.on("createCombatant", cb => follow(cb.parent));

/* ------------------------------------------------------------------ the Companions window */
/** A new tamer's first companion, Pokémon-style: one fire, one grass, one water - Tiny CR 1/8
 *  bespoke familiars (the books' own tamer familiars, each with its improvement tree). Any other
 *  creature is still dropped on the window. */
const STARTERS = [
  {name: "Oventurer", kind: "Fire", uuid: "Compendium.tselverse-art.tselversecreatures.Actor.TSVOventurer0000",
   img: "modules/tselverse-art/art/portraits/oventurer.png", blurb: "A living oven: immune to fire, burns whatever grabs it, and lights itself up."},
  {name: "Hyphan", kind: "Grass", uuid: "Compendium.tselverse-art.tselversecreatures.Actor.TSVHyphan0000000",
   img: "modules/tselverse-art/art/portraits/hyphan.png", blurb: "A climbing fungus: sprays poison and calms a foe with its spores."},
  {name: "Kawawappa", kind: "Water", uuid: "Compendium.tselverse-art.tselversecreatures.Actor.TSVKawawappa0000",
   img: "modules/tselverse-art/art/portraits/kawawappa.png", blurb: "A little kappa: swims, breathes water, and claws hard for its size."}];
class CompanionsApp extends foundry.applications.api.ApplicationV2 {
  constructor(tamer, options = {}) { super(options); this.tamer = tamer; }
  static DEFAULT_OPTIONS = {classes: ["tsvcmp"], window: {title: "Companions", icon: "fa-solid fa-paw", resizable: true},
    position: {width: 560, height: "auto"},
    actions: {summon: CompanionsApp.#act, dismiss: CompanionsApp.#act, train: CompanionsApp.#act, heal: CompanionsApp.#act, pb: CompanionsApp.#act,
              open: CompanionsApp.#act, release: CompanionsApp.#act, bolster: CompanionsApp.#act, swap: CompanionsApp.#act, eyes: CompanionsApp.#act,
              horde: CompanionsApp.#tamerAct, endHorde: CompanionsApp.#tamerAct, throw: CompanionsApp.#tamerAct,
              starter: CompanionsApp.#starter}};
  static async #starter(event, target) {
    const creature = await fromUuid(target.dataset.uuid);
    if (!creature) return ui.notifications.warn("That starter isn't in the compendium.");
    await this.#bondCreature(creature);
  }
  static async #tamerAct(event, target) {
    const a = target.dataset.action;
    if (a === "horde") await summonHorde(this.tamer);
    else if (a === "endHorde") await endHorde(this.tamer);
    else if (a === "throw") await this.#throwVessel();
    this.render();
  }
  get title() { return `Companions: ${this.tamer.name}`; }
  static async #act(event, target) {
    const c = fromUuidSync(target.closest("[data-uuid]").dataset.uuid);
    const a = target.dataset.action;
    if (a === "summon") await summon(c);
    else if (a === "dismiss") await dismiss(c);
    else if (a === "train") await train(c);
    else if (a === "heal") await soulBondHeal(this.tamer, c);
    else if (a === "bolster") await bolster(this.tamer, c);
    else if (a === "swap") await switcheroo(this.tamer, c);
    else if (a === "eyes") await seeThrough(this.tamer, c);
    else if (a === "open") c.sheet.render(true);
    else if (a === "pb") { await c.update({[`flags.${MOD}.usePB`]: !c.flags[MOD].usePB}); c.reset(); }
    else if (a === "release") {
      if (await foundry.applications.api.DialogV2.confirm({window: {title: "Release"}, content: `<p>Release <b>${c.name}</b>? It stops being your companion and its vessel is lost.</p>`}))
        await asGM("release", c.uuid);
    }
    this.render();
  }
  async _renderHTML() {
    const lvl = classLevel(this.tamer), list = companionsOf(this.tamer);
    for (const c of list) await catchUp(c);
    const feat = soulBond(this.tamer);
    const pool = feat?.system?.uses?.max ? `${feat.system.uses.max - (feat.system.uses.spent ?? 0)} / ${feat.system.uses.max}` : "-";
    const rows = list.map(c => {
      const f = c.flags[MOD], hp = c.system.attributes.hp, out = c.getActiveTokens().length > 0;
      const todo = (f.pendingImprovements ?? 0) + (f.pendingHD ?? 0);
      return `<li data-uuid="${c.uuid}"><img src="${c.img}"><div class="nm"><b>${foundry.utils.escapeHTML(c.name)}</b>
        <span>HP ${hp.value}/${hp.max} · PB +${c.system.attributes.proficiency} · ${(f.improvements ?? []).length} improvements${out ? " · <em>summoned</em>" : ""}</span></div>
        <div class="bt">${out ? `<button data-action="dismiss">Dismiss</button>` : `<button data-action="summon">Summon</button>`}
        ${isTamer(this.tamer) ? `<button data-action="train"${todo ? ` class="todo"` : ""}>Train${todo ? ` (${todo})` : ""}</button>` : ""}
        ${!isTamer(this.tamer) && spiritPending(c, this.tamer) ? `<button data-action="train" class="todo" title="Spirit Bonded">Train (1)</button>` : ""}
        ${isTamer(this.tamer) ? "" : `<button data-action="pb" title="Use my proficiency bonus for its attacks, saves and DCs (on/off)">PB ${f.usePB ? "on" : "off"}</button>`}
        ${soulBond(this.tamer) ? `<button data-action="heal" title="Soul Bond">Heal</button>` : ""}
        ${feature(this.tamer, "Bolster") ? `<button data-action="bolster" title="Bolster: spend a spell slot to heal it">Bolster</button>` : ""}
        ${out && feature(this.tamer, "Psychic Bond") ? (psychicEffect(this.tamer) ? `<button data-action="eyes" class="todo" data-tooltip="Return to your own senses (Psychic Bond)"><i class="fa-solid fa-eye-slash"></i></button>` : `<button data-action="eyes" data-tooltip="See through its eyes (Psychic Bond, action)"><i class="fa-solid fa-eye"></i></button>`) : ""}
        ${out && feature(this.tamer, "Switcheroo") ? `<button data-action="swap" data-tooltip="Switch places with it (Switcheroo, ${usesLeft(feature(this.tamer, "Switcheroo"))} left)"><i class="fa-solid fa-right-left"></i></button>` : ""}<button data-action="open" data-tooltip="Open its sheet"><i class="fa-solid fa-book"></i></button>
        <button data-action="release" data-tooltip="Release this companion (asks first)"><i class="fa-solid fa-unlock"></i></button></div></li>`;
    }).join("");
    const head = isTamer(this.tamer)
      ? `Tamer level ${lvl}: <b>${list.length} / ${BONDED[lvl - 1] ?? 0}</b> bonded · up to <b>${maxSize(lvl)}</b>, CR <b>${MAX_CR[lvl - 1] ?? 0}</b> · Soul Bond pool <b>${pool}</b>`
      : `<b>${list.length}</b> companion(s). Your class's own rules decide what you can bond; this keeps it linked to you, summons and dismisses it, heals it on your long rests and puts it right after you in initiative.`;
    const sw = feature(this.tamer, "Summon the Horde"), horde = this.tamer.getFlag(MOD, "horde");
    const tools = isTamer(this.tamer) ? `<p class="tools">
      ${feature(this.tamer, "Tame Creature") ? `<button data-action="throw" title="Throw an empty vessel at your targeted creature (within 30 ft)"><i class="fa-solid fa-bullseye"></i> Throw vessel</button>` : ""}
      ${sw ? (horde ? `<button data-action="endHorde" class="todo">End the Horde</button>` : `<button data-action="horde" ${usesLeft(sw) > 0 ? "" : "disabled"}>Summon the Horde</button>`) : ""}</p>` : "";
    const starters = isTamer(this.tamer) && !list.length ? `<p class="lim">Choose your first companion:</p><div class="starters">${STARTERS.map(s =>
      `<div class="starter ${s.kind.toLowerCase()}"><img src="${s.img}" alt=""><b>${s.name}</b><span class="kind">${s.kind}</span><p>${s.blurb}</p>
       <button data-action="starter" data-uuid="${s.uuid}">Choose ${s.name}</button></div>`).join("")}</div>
      <p class="hint">Or drop any other creature below.</p>` : "";
    return `<p class="lim">${head}</p>${tools}${starters}
      <ul class="cmp">${rows || (starters ? "" : `<li class="none">No companions yet.</li>`)}</ul>
      <div class="drop"><i class="fa-solid fa-paw"></i> Drop a creature here to bond it</div>`;
  }
  _replaceHTML(html, content) {
    content.innerHTML = html;
    const drop = content.querySelector(".drop");
    drop.addEventListener("dragover", ev => { ev.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", ev => { drop.classList.remove("over"); this.#onDrop(ev); });
  }
  async #onDrop(event) {
    event.preventDefault();
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if (data?.type !== "Actor") return ui.notifications.warn("Drop a creature (an actor).");
    const creature = await fromUuid(data.uuid);
    if (creature?.type !== "npc") return ui.notifications.warn("Only creatures can become companions.");
    await this.#bondCreature(creature);
  }
  /** Taming a Creature: throw an empty vessel at the targeted creature. */
  async #throwVessel() {
    const target = [...game.user.targets][0], tt = tokenOf(this.tamer);
    if (!target?.actor) return ui.notifications.warn("Target the creature first (T over its token).");
    if (target.actor === this.tamer || target.actor.type !== "npc") return ui.notifications.warn("Only creatures can be caught in a vessel.");
    if (tt && distance(tt, target) > 30) return ui.notifications.warn(`${target.name} is more than 30 feet away.`);
    const creature = target.actor;
    const dc = this.tamer.system.spellcasting?.origins?.[TAMER]?.dc ?? (8 + (this.tamer.system.attributes?.proficiency ?? 2) + castMod(this.tamer));
    const why = refusals(this.tamer, creature);
    if (why.length) return ChatMessage.create({speaker: ChatMessage.getSpeaker({actor: this.tamer}),
      content: `<p>${this.tamer.name} throws a vessel at ${target.name}. It automatically succeeds on the saving throw (${why.join("; ")}).</p>`});
    const rolls = await creature.rollAbilitySave({ability: "charisma", target: dc}, {configure: false});
    const roll = Array.isArray(rolls) ? rolls[0] : rolls;
    if (!roll) return;
    if (roll.total >= dc) return ChatMessage.create({speaker: ChatMessage.getSpeaker({actor: this.tamer}),
      content: `<p>${target.name} resists the vessel (Charisma save ${roll.total} vs DC ${dc}).</p>`});
    if (await this.#bondCreature(creature, {thrown: true})) {
      await asGM("removeToken", target.document.uuid);
      ChatMessage.create({speaker: ChatMessage.getSpeaker({actor: this.tamer}), content: `<p>${target.name} is trapped in ${this.tamer.name}'s vessel (Charisma save ${roll.total} vs DC ${dc}).</p>`});
    }
  }
  async #bondCreature(creature, {thrown = false} = {}) {
    const why = thrown ? [] : refusals(this.tamer, creature);
    if (why.length) {
      if (!game.user.isGM) return ui.notifications.warn(`${creature.name} can't be bonded: ${why.join("; ")}.`);
      const go = await foundry.applications.api.DialogV2.confirm({window: {title: "Bond anyway?"},
        content: `<p>${creature.name} can't normally be bonded: ${why.join("; ")}.</p><p>Bond it anyway (the optional non-combat taming rule)?</p>`});
      if (!go) return false;
    }
    let release = null;
    const list = companionsOf(this.tamer);
    if (list.length >= (BONDED[classLevel(this.tamer) - 1] ?? 0)) {
      release = await foundry.applications.api.DialogV2.prompt({window: {title: "Bonded to the most you can be"},
        content: `<p>Release one to make room for ${creature.name}:</p><p><select name="r">${list.map(c => `<option value="${c.uuid}">${c.name}</option>`).join("")}</select></p>`,
        ok: {label: "Release and bond", callback: (ev, btn) => btn.form.elements.r.value}, rejectClose: false});
      if (!release) return false;
    }
    try {
      await asGM("bond", this.tamer.uuid, creature.uuid, release);
      ui.notifications.info(`${creature.name} is now ${this.tamer.name}'s companion. Use Train to choose its improvements.`);
    } catch (err) { ui.notifications.error(`Couldn't bond ${creature.name}: ${err.message}`); return false; }
    this.render();
    return true;
  }
}

Hooks.on("getHeaderControlsApplicationV2", (app, controls) => {
  const actor = app.document;
  if (actor?.documentName !== "Actor" || !actor.isOwner) return;
  if (canHaveCompanions(actor)) controls.push({icon: "fa-solid fa-paw", label: "Companions", action: "tselverseCompanions",
    onClick: () => new CompanionsApp(actor).render(true)});
  else if (tamerOf(actor) && isTamer(tamerOf(actor))) controls.push({icon: "fa-solid fa-dumbbell", label: "Train companion", action: "tselverseTrain",
    onClick: () => train(actor)});
});
Hooks.on("updateActor", actor => {
  for (const app of foundry.applications.instances.values())
    if (app instanceof CompanionsApp && (app.tamer === actor || tamerOf(actor) === app.tamer)) app.render();
});

/* ------------------------------------------------------------------ level-up prompt */
/** After a tamer levels up (Black Flag marks that update `blackFlag.levelUp`), the player who did it
 *  is asked to choose: room for another companion (the first one at tamer level 1), and the
 *  improvements and Hit Dice the new level gives each companion. "Choose now" opens the Companions
 *  window, where a creature is dropped to bond it and Train picks improvements. */
Hooks.on("updateActor", (actor, changes, options, userId) => {
  if (!options?.blackFlag?.levelUp || userId !== game.user.id || !isTamer(actor)) return;
  // the class level counts the new progression entry once the update has landed
  setTimeout(() => levelUpPrompt(actor), 250);
});
async function levelUpPrompt(tamer) {
  const lvl = classLevel(tamer);
  if (!lvl) return;
  const list = companionsOf(tamer);
  for (const c of list) await catchUp(c);
  const room = Math.max(0, (BONDED[lvl - 1] ?? 0) - list.length);
  const todo = list.map(c => ({c, n: (c.flags[MOD]?.pendingImprovements ?? 0) + (c.flags[MOD]?.pendingHD ?? 0)})).filter(x => x.n);
  if (!room && !todo.length) return;
  const lines = [];
  if (room) lines.push(list.length
    ? `<p>You can bond <b>${room}</b> more companion${room > 1 ? "s" : ""} (up to ${maxSize(lvl)}, CR ${MAX_CR[lvl - 1] ?? 0}).</p>`
    : `<p>Choose your first companion: a fire, grass or water starter, or any creature up to ${maxSize(lvl)}, CR ${MAX_CR[lvl - 1] ?? 0}.</p>`);
  if (todo.length) lines.push(`<p>To train: ${todo.map(x => `<b>${foundry.utils.escapeHTML(x.c.name)}</b> (${x.n})`).join(", ")}.</p>`);
  const go = await foundry.applications.api.DialogV2.confirm({
    window: {title: `${tamer.name}: tamer level ${lvl}`, icon: "fa-solid fa-paw"},
    content: lines.join("") + `<p class="hint">In the Companions window, drop a creature to bond it, or press Train.</p>`,
    yes: {label: "Choose now", icon: "fa-solid fa-paw"}, no: {label: "Later"}, rejectClose: false});
  if (go) new CompanionsApp(tamer).render(true);
}

/* ------------------------------------------------------------------ Progression tab */
/** The character sheet's Progression tab gets a "Companion" row under each tamer level that opens a
 *  bond slot (1st, 3rd, 7th...): the creature bonded in that slot, or a Choose Creature button that
 *  opens the Companions window. A "Train" row under the latest level lists improvements and Hit Dice
 *  still to choose. */
const tamerLevelAt = actor => {          // character level -> tamer level reached at it
  const c = actor.items.find(i => i.type === "class" && (i.identifier ?? i.system?.identifier?.value) === TAMER);
  const out = {}; let t = 0;
  const lv = actor._source?.system?.progression?.levels ?? {};
  for (const k of Object.keys(lv).map(Number).sort((a, b) => a - b)) if (lv[k]?.class === c?.id) out[k] = ++t;
  return out;
};
const progressionRow = (title, body, warn) => {
  const row = document.createElement("div");
  row.className = "advancement-entry tselverse-companions-row";
  row.innerHTML = `<header><div><figure class="icon"><i class="fa-solid fa-paw" style="font-size:1.1em"></i></figure>
    <h4>${title}${warn ? ` <i class="fa-solid fa-circle-exclamation" style="color:var(--bf-warning-color, #e0a800)" data-tooltip="Not chosen yet"></i>` : ""}</h4></div>
    <div>${body}</div></header>`;
  return row;
};
Hooks.on("renderApplicationV2", (app, element) => {
  const actor = app.document;
  if (actor?.documentName !== "Actor" || actor.type !== "pc" || !isTamer(actor)) return;
  const levels = element.querySelector?.("section.levels");
  if (!levels) return;
  levels.querySelectorAll(".tselverse-companions-row").forEach(r => r.remove());
  const at = tamerLevelAt(actor);
  const list = companionsOf(actor).sort((a, b) => (a._stats?.createdTime ?? 0) - (b._stats?.createdTime ?? 0));
  const open = () => new CompanionsApp(actor).render(true);
  const btn = (label, cls = "") => `<button type="button" class="light-button ${cls}" data-tsc-open>${label}</button>`;
  const top = Math.max(0, ...Object.keys(at).map(Number));
  for (const [charLvl, t] of Object.entries(at)) {
    const flows = levels.querySelector(`.level[data-level="${charLvl}"] .advancement-flows`);
    if (!flows) continue;
    const slot = BONDED[t - 1] ?? 0, before = t > 1 ? BONDED[t - 2] ?? 0 : 0;
    for (let k = before + 1; k <= slot; k++) {
      const c = list[k - 1];
      flows.append(progressionRow(`Companion ${k}`, c
        ? `<button type="button" class="link-button" data-tsc-open>${foundry.utils.escapeHTML(c.name)}</button>`
        : (actor.isOwner ? btn("Choose Creature") : "") + ` <span class="hint">up to ${maxSize(t)}, CR ${MAX_CR[t - 1] ?? 0}</span>`, !c));
    }
    if (Number(charLvl) === top) {
      const todo = list.map(c => ({c, n: (c.flags[MOD]?.pendingImprovements ?? 0) + (c.flags[MOD]?.pendingHD ?? 0)})).filter(x => x.n);
      if (todo.length) flows.append(progressionRow("Train Companions",
        btn(todo.map(x => `${foundry.utils.escapeHTML(x.c.name)} (${x.n})`).join(", ")), true));
    }
  }
  levels.querySelectorAll("[data-tsc-open]").forEach(b => b.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); open(); }));
});

globalThis.TselverseCompanions = {refusals, levelUpPrompt, bond: (tamer, creature) => asGM("bond", tamer.uuid, creature.uuid), train, summon, dismiss, companionsOf, tamerOf, ON_TAMING, BONDED, MAX_CR, profFor,
  treeFor, availableImprovements, grantImprovement, bolster, switcheroo, summonHorde, endHorde, seeThrough, syncSpellSwap: runSwap, knownSpells, swapReady, open: actor => new CompanionsApp(actor).render(true),
  get bespoke() { return BESPOKE; }};
