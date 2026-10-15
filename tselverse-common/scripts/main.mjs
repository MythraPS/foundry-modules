import "./tile-size.mjs";
/**
 * Everyone Speaks Common - a house rule for Black Flag.
 *
 * Both the PC and the NPC data model build their language list in `prepareLanguages()` (the
 * LanguagesTemplate mixin), called from prepareDerivedData after every other source of
 * languages - advancements, effects - has been applied. Common is added to the prepared Set just
 * before that, so it shows on the sheet and counts anywhere the system checks languages, and
 * nothing is ever written into the actor: switch the setting off and it is gone.
 *
 * NPCs: "almost every NPC". One that speaks at least one language gains Common; one with no
 * language ("—"), one that can't speak ("understands Common but can't speak", the cantSpeak tag),
 * one that already knows all languages, and one with only telepathy are left alone. Imported
 * stat blocks often keep their languages as text ("Abyssal, Infernal, telepathy 120 ft."), so the
 * text is read too.
 */
import "./mastery.mjs";   // weapon masteries beside weapon options (its own file)
import "./consume-ref.mjs"; // "identifier:dance" consumption targets (its own file)
import "./trick-forms.mjs"; // per-form attack abilities for trick weapons (its own file)
import "./choice-lists.mjs"; // pick-from-a-list for drop-only feature/talent choices (its own file)
import "./book-names.mjs"; // one name per book in source lines and book filters (its own file)
import "./superseded.mjs"; // hide module entries a newer printing replaces (its own file)
const MODULE = "tselverse-common";
// a module's language file is read at world start; until then show the English
const _t = (key, english) => { const s = game.i18n?.localize(key); return s && s !== key ? s : english; };
const setting = (key, fallback) => { try { return game.settings.get(MODULE, key); } catch { return fallback; } };

const NONE = /^\s*[—–-]?\s*$/;
const CANT = /can[’']?t speak|cannot speak|doesn[’']?t speak|does not speak|\bunderstands?\b/i;
const ALL = /^\s*(all|all languages)\b/i;
const TELEPATHY_ONLY = /^\s*telepathy\b[^,]*$/i;

/** Should this actor get Common? */
export function needsCommon(actor, languages) {
  const value = languages?.value;
  if (!(value instanceof Set) || value.has("common") || value.has("ALL")) return false;
  const custom = [...(languages.custom ?? [])].map(String);
  if (custom.some(c => /\bcommon\b/i.test(c) && !CANT.test(c))) return false;    // "Common, Infernal" as text
  if (actor.type === "pc") return setting("pcs", true);
  if (actor.type !== "npc" || !setting("npcs", true)) return false;
  if ([...(languages.tags ?? [])].includes("cantSpeak")) return false;
  if (custom.some(c => ALL.test(c) || CANT.test(c))) return false;
  const speaks = value.size > 0 || custom.some(c => !NONE.test(c) && !TELEPATHY_ONLY.test(c));
  return speaks;
}

Hooks.once("init", () => {
  game.settings.register(MODULE, "pcs", {
    name: _t("TSVCOMMON.Settings.PCs.Name", "Every player character speaks Common"),
    hint: _t("TSVCOMMON.Settings.PCs.Hint", "Adds Common to every player character's languages."),
    scope: "world", config: true, type: Boolean, default: true, requiresReload: true
  });
  game.settings.register(MODULE, "npcs", {
    name: _t("TSVCOMMON.Settings.NPCs.Name", "NPCs that speak a language also speak Common"),
    hint: _t("TSVCOMMON.Settings.NPCs.Hint", "Adds Common to any NPC that speaks at least one language."),
    scope: "world", config: true, type: Boolean, default: true, requiresReload: true
  });
  const patched = new Set();
  for (const type of ["pc", "npc"]) {
    const proto = CONFIG.Actor.dataModels?.[type]?.prototype;
    // both models may share the mixin's method: wrap each prototype that owns it once
    let owner = proto;
    while (owner && !Object.prototype.hasOwnProperty.call(owner, "prepareLanguages")) owner = Object.getPrototypeOf(owner);
    if (!owner) { console.warn(`${MODULE} | no prepareLanguages on the ${type} model - rule not applied`); continue; }
    if (patched.has(owner)) continue;
    patched.add(owner);
    const original = owner.prepareLanguages;
    owner.prepareLanguages = function (...args) {
      try {
        const languages = this.proficiencies?.languages;
        restoreLostLanguages(this.parent, languages);
        dropRepeatedLanguages(languages);
        if (needsCommon(this.parent, languages)) languages.value.add("common");
      } catch (err) { console.warn(`${MODULE} | could not add Common`, err); }
      return original.apply(this, args);
    };
  }
});


/**
 * Languages a compendium stored under the wrong name. The Kobold Press module's monsters keep theirs
 * in `languages.values`; Black Flag's field is `value`, so it drops them and the sheet shows none
 * (Abaasy: Common and Giant). The compendium index still carries the raw field, so it is read once
 * and put back while the creature is prepared - for the compendium's own documents and for copies
 * made from them. Nothing is written: a module update that fixes its data makes this a no-op.
 */
const lostLanguages = new Map();            // compendium uuid -> language keys

function restoreLostLanguages(actor, languages) {
  if (!lostLanguages.size || !(languages?.value instanceof Set) || languages.value.size) return;
  const uuid = actor?.pack ? actor.uuid : (actor?._stats?.compendiumSource ?? actor?.flags?.core?.sourceId);
  for (const key of lostLanguages.get(uuid) ?? []) languages.value.add(key);
}

/** "Void Speech" written as text beside the Void Speech language (a Kobold Press copy whose text and
 *  restored key both survive) is listed once. Only the prepared list changes. */
function dropRepeatedLanguages(languages) {
  if (!(languages?.value instanceof Set) || !languages.value.size || !languages.custom?.length) return;
  const norm = t => String(t).toLowerCase().replace(/[^a-z]/g, "");
  const have = new Set();
  for (const k of languages.value) {
    have.add(norm(k));
    const label = CONFIG.BlackFlag?.languages?.[k]?.label;
    if (label) have.add(norm(game.i18n.localize(label)));
  }
  const kept = [...languages.custom].filter(c => !have.has(norm(c)));
  if (kept.length !== languages.custom.length) languages.custom = kept;
}

Hooks.once("ready", async () => {
  if (!setting("restoreLost", true)) return;
  const known = new Set(Object.keys(CONFIG.BlackFlag?.languages ?? {}));
  const flat = o => Object.entries(o ?? {}).flatMap(([k, v]) => [k, ...flat(v.children)]);
  for (const k of flat(CONFIG.BlackFlag?.languages)) known.add(k);
  for (const pack of game.packs.filter(p => p.documentName === "Actor")) {
    let index;
    try { index = await pack.getIndex({fields: ["system.proficiencies.languages.values"]}); } catch { continue; }
    for (const e of index) {
      const keys = (e.system?.proficiencies?.languages?.values ?? []).filter(k => known.has(k));
      if (keys.length) lostLanguages.set(e.uuid, keys);
    }
  }
  if (!lostLanguages.size) return;
  console.log(`${MODULE} | ${lostLanguages.size} compendium creatures had their languages under the wrong field - restored on their sheets`);
  // creatures prepared before the index was read: once more, now with their languages
  for (const actor of game.actors) {
    const src = actor._stats?.compendiumSource ?? actor.flags?.core?.sourceId;
    if (src && lostLanguages.has(src)) { actor.reset(); actor.sheet?.rendered && actor.sheet.render(); }
  }
  for (const token of canvas?.tokens?.placeables ?? []) {
    const a = token.actor;
    if (a?.isToken && lostLanguages.has(a._stats?.compendiumSource ?? a.flags?.core?.sourceId)) a.reset();
  }
});

Hooks.once("init", () => {
  game.settings.register(MODULE, "restoreLost", {
    name: _t("TSVCOMMON.Settings.RestoreLost.Name", "Show compendium creatures' lost languages"),
    hint: _t("TSVCOMMON.Settings.RestoreLost.Hint", "The Kobold Press monsters store their languages where Black Flag doesn't look, so their sheets list none. Ticked, the languages are read from the compendium and shown."),
    scope: "world", config: true, type: Boolean, default: true, requiresReload: true
  });
});

/**
 * References into the D&D 5e system's compendiums. The Kobold Press module was converted from dnd5e
 * and still points 58 summons, linked items and spells at "Compendium.dnd5e..." (Find Steed's Elk,
 * Create Undead's Ghoul, a dragon's Potion of Healing, Hold Person...), which don't exist in a Black
 * Flag world: summoning failed with "Actor cannot be found". data/dnd5e-uuids.json maps 49 of them
 * to the same creature, item or spell in Black Flag's, Kobold Press's or this world's compendiums
 * (ToV renames checked by circle and text: Hold Person -> Hold, Dominate Monster -> Greater
 * Dominate...). Lookups through the global fromUuid / fromUuidSync - which Black Flag uses - are
 * redirected. The spell creatures no compendium has (Mage Hand, Unseen Servant, Arcane Hand and Eye, Dancing
 * Lights, Stirge) point at simple world actors in the "Summoned Creatures" folder. Left unmapped,
 * with no equivalent: Eldritch Blast, True Strike,
 * Hunter's Mark, Dominate Beast and a few more.
 */
const dnd5eMap = new Map();
Hooks.once("init", async () => {
  try {
    const data = await (await fetch(`modules/${MODULE}/data/dnd5e-uuids.json`)).json();
    for (const [from, to] of Object.entries(data)) dnd5eMap.set(from, to);
  } catch (err) { console.warn(`${MODULE} | dnd5e reference map not loaded`, err); return; }
  const remap = uuid => (typeof uuid === "string" && uuid.startsWith("Compendium.dnd5e.") && dnd5eMap.get(uuid)) || uuid;
  const async0 = globalThis.fromUuid, sync0 = globalThis.fromUuidSync;
  if (async0) globalThis.fromUuid = function (uuid, ...rest) { return async0.call(this, remap(uuid), ...rest); };
  if (sync0) globalThis.fromUuidSync = function (uuid, ...rest) { return sync0.call(this, remap(uuid), ...rest); };
});

/**
 * Text links to things that aren't there. Black Flag's own monster pack links 19 summons to a Kobold
 * Press "ToV Monster Vault" module this world doesn't have ("uses the statistics of an
 * @UUID[Compendium.kp-tov-monster-vault...]{awakened tree}"), and the Kobold Press module links some
 * of its own creatures under ids that no longer exist. Every description goes through
 * TextEditor.enrichHTML before it is shown, so there - before the link is made - a link whose pack or
 * entry is missing is pointed at the compendium entry named in its label, if one exists. Nothing is
 * written to any pack.
 */
const linkNames = new Map();          // "actor:awakened tree" -> uuid
Hooks.once("ready", async () => {
  for (const pack of game.packs.filter(p => ["Actor", "Item"].includes(p.documentName))) {
    let index; try { index = await pack.getIndex(); } catch { continue; }
    for (const e of index) {
      const k = `${pack.documentName.toLowerCase()}:${e.name.toLowerCase().replace(/[’']/g, "'")}`;
      if (!linkNames.has(k) || pack.collection.startsWith("black-flag.")) linkNames.set(k, e.uuid);
    }
  }
  const TE = foundry.applications.ux.TextEditor.implementation;
  const enrich0 = TE.enrichHTML;
  TE.enrichHTML = function (content, options) {
    if (typeof content === "string" && content.includes("@UUID[Compendium.")) content = repairLinks(content);
    return enrich0.call(this, content, options);
  };
});

function repairLinks(html) {
  return html.replace(/@UUID\[(Compendium\.([\w-]+\.[\w-]+)\.(Actor|Item)\.(\w{16}))\]\{([^}]+)\}/g, (all, uuid, coll, type, id, label) => {
    const pack = game.packs.get(coll);
    if (pack && pack.index.has(id)) return all;                     // fine as it is
    if (uuid.startsWith("Compendium.dnd5e.") && dnd5eMap.has(uuid)) return `@UUID[${dnd5eMap.get(uuid)}]{${label}}`;
    const name = label.toLowerCase().replace(/[’']/g, "'").replace(/^(an?|the)\s+/, "");
    const hit = linkNames.get(`${type.toLowerCase()}:${name}`) ?? linkNames.get(`${type.toLowerCase()}:${name.replace(/s$/, "")}`);
    return hit ? `@UUID[${hit}]{${label}}` : all;
  });
}
