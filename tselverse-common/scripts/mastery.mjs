/**
 * Weapon masteries (D&D 2024) beside Black Flag's weapon options - a house rule.
 *
 * Tales of the Valiant has weapon options (Bash, Trip...: anyone proficient, in place of the
 * attack's damage); the 2024 rules give each weapon a mastery (on top of a hit's damage, only for a
 * character with a Weapon Mastery feature - the Dancer has one). Both are used here:
 *  - each mastery is added to Black Flag's weapon-option list, so it shows (and can be ticked) on
 *    a weapon's Details tab next to Bash and Trip;
 *  - every weapon gets its SRD 5.2.1 mastery by its base weapon (a +1 rapier is a
 *    rapier: Vex), Complete Dancer's weapons theirs by name; a mastery ticked by hand replaces it;
 *  - the mastery's rule is shown under the weapon's description and in its tooltip.
 * Nothing is written into items: the default is applied while the weapon is prepared, so turning
 * the setting off removes it everywhere.
 */
const MODULE = "tselverse-common";

import BOOK_TEXT from "./mastery-text.mjs"; // Complete Dancer's rules text, kept per world; empty in the public copy

// Cleave to Vex: the mastery properties of the SRD 5.2.1.
// This work includes material from the System Reference Document 5.2.1 ("SRD 5.2.1") by Wizards of the
// Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative
// Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.
export const MASTERIES = {
  cleave: ["Cleave", "If you hit a creature with a melee attack roll using this weapon, you can make a melee attack roll with the weapon against a second creature within 5 feet of the first that is also within your reach. On a hit, the second creature takes the weapon's damage, but don't add your ability modifier to that damage unless that modifier is negative. You can make this extra attack only once per turn."],
  graze: ["Graze", "If your attack roll with this weapon misses a creature, you can deal damage to that creature equal to the ability modifier you used to make the attack roll. This damage is the same type dealt by the weapon, and the damage can be increased only by increasing the ability modifier."],
  nick: ["Nick", "When you make the extra attack of the Light property, you can make it as part of the Attack action instead of as a Bonus Action. You can make this extra attack only once per turn."],
  push: ["Push", "If you hit a creature with this weapon, you can push the creature up to 10 feet straight away from yourself if it is Large or smaller."],
  sap: ["Sap", "If you hit a creature with this weapon, that creature has Disadvantage on its next attack roll before the start of your next turn."],
  slow: ["Slow", "If you hit a creature with this weapon and deal damage to it, you can reduce its Speed by 10 feet until the start of your next turn. If the creature is hit more than once by weapons that have this property, the Speed reduction doesn't exceed 10 feet."],
  topple: ["Topple", "If you hit a creature with this weapon, you can force the creature to make a Constitution saving throw (DC 8 plus the ability modifier used to make the attack roll and your Proficiency Bonus). On a failed save, the creature has the Prone condition."],
  vex: ["Vex", "If you hit a creature with this weapon and deal damage to the creature, you have Advantage on your next attack roll against that creature before the end of your next turn."],
  // Complete Dancer (Mage Hand Press)
  parry: ["Parry", BOOK_TEXT.parry ?? "Complete Dancer (Mage Hand Press) weapon mastery: see the book for its rule."],
  shift: ["Shift", BOOK_TEXT.shift ?? "Complete Dancer (Mage Hand Press) weapon mastery: see the book for its rule."]
};

// SRD 5.2.1 weapons table (Mastery column), by Black Flag base weapon key
const BY_BASE = {
  club: "slow", dagger: "nick", greatclub: "push", handaxe: "vex", javelin: "slow", lightHammer: "nick", mace: "sap",
  quarterstaff: "topple", sickle: "nick", spear: "sap", dart: "vex", lightCrossbow: "slow", shortbow: "vex", sling: "slow",
  battleaxe: "topple", flail: "sap", glaive: "graze", greataxe: "cleave", greatsword: "graze", halberd: "cleave",
  lance: "topple", longsword: "sap", maul: "topple", morningstar: "sap", pike: "push", rapier: "vex", scimitar: "nick",
  shortsword: "vex", trident: "topple", warhammer: "push", warPick: "sap", whip: "slow", blowgun: "vex",
  handCrossbow: "vex", heavyCrossbow: "push", longbow: "slow", musket: "slow", pistol: "vex"
  // (Black Flag's scythe isn't in the 2024 table: no default)
};
// Complete Dancer's weapons table, by name
const BY_NAME = {
  "battle fan": "parry", "cestus": "shift", "claw gauntlet": "shift", "punching dagger": "shift", "stiletto": "vex",
  "training sword": "sap", "parrying dagger": "parry", "rope dart": "topple", "shuriken": "vex", "chakram": "vex"
};

const optKey = m => `mastery${m[0].toUpperCase()}${m.slice(1)}`;
const KEYS = Object.fromEntries(Object.keys(MASTERIES).map(m => [optKey(m), m]));
const enabled = () => { try { return game.settings.get(MODULE, "masteries"); } catch { return true; } };

/** The weapon's mastery: one ticked by hand, else its default. */
export function masteryOf(system) {
  const src = system?._source?.options ?? [];
  const ticked = [...src].map(k => KEYS[k]).find(Boolean);
  if (ticked) return ticked;
  const base = system?.type?.base;
  return BY_BASE[base] ?? BY_NAME[String(system?.parent?.name ?? "").toLowerCase()] ?? null;
}

/*
 * Which weapons a character can use the mastery of (2026-10-14, user: "same with any class that gets weapon
 * masteries"). A feature or talent grants a number of weapon kinds, read from its own text ("the mastery
 * properties of two kinds of weapons of your choice": Weapon Mastery of the Dancer, Gadgeteer and Jaeger; one for
 * Martial Training and the Weapon Master talent; two kinds of ship weapons for the Artillerist). The kinds chosen
 * are kept on the actor (flags.tselverse-common.masteryKinds): a base weapon key ("longsword") or, for a weapon
 * with no base (blasters, trick weapons), "name:" and its name. The chooser opens when such a feature is gained
 * and from the feature's sheet; the books let the choice change after a Long Rest, so it can always be reopened.
 */
const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
export function grantOf(item) {
  if (!["feature", "talent"].includes(item?.type)) return 0;
  const t = String(item.system?.description?.value ?? "").replace(/<[^>]+>/g, " ");
  const m = t.match(/mastery propert(?:y|ies) of (one|two|three|four|five|six) (?:kinds? of )?(?:simple or martial |ship )?weapons?\b/i);
  return m ? WORDS[m[1].toLowerCase()] : 0;
}
/*
 * House rule (2026-10-14, user: yes to giving the Tales of the Valiant martial classes the 2024 Weapon Mastery):
 * the number of weapon kinds by class level, from the SRD 5.2.1 class tables. A multiclassed
 * character uses the best of its classes (the 2024 rules don't let Weapon Mastery stack across classes).
 * The feature itself is an item flagged tselverse-common.classMastery, added to the actor (ensureClassMastery).
 */
const CLASS_MASTERY = { barbarian: [[1, 2], [4, 3], [10, 4]], fighter: [[1, 3], [4, 4], [10, 5], [16, 6]],
  paladin: [[1, 2]], ranger: [[1, 2]], rogue: [[1, 2]] };
export function classMastery(actor) {
  const classes = actor?.system?.progression?.classes ?? {};
  let best = 0;
  for (const [id, steps] of Object.entries(CLASS_MASTERY)) {
    const lv = classes[id]?.levels ?? 0;
    for (const [at, n] of steps) if (lv >= at) best = Math.max(best, n);
  }
  return best;
}
const isClassMasteryItem = i => !!i?.flags?.[MODULE]?.classMastery;
export const masteryAllowance = actor => {
  const items = actor?.items?.contents ?? [];
  // a Weapon Mastery class feature from a book (Jaeger...) and this house rule don't stack either: the better one
  const feature = Math.max(classMastery(actor), ...items.filter(i => /^weapon mastery$/i.test(i.name) && !isClassMasteryItem(i)).map(grantOf), 0);
  const extra = items.filter(i => !/^weapon mastery$/i.test(i.name)).reduce((n, i) => n + grantOf(i), 0);
  return feature + extra;
};

const CM_TEXT = `<p><em>House rule: the 2024 Weapon Mastery for the Tales of the Valiant martial classes.</em></p>
<p>Your training with weapons allows you to use the mastery properties of some kinds of Simple or Martial weapons of your choice (see each weapon's tooltip). Whenever you finish a Long Rest, you can change one of those choices. The number of kinds grows with your level:</p>
<ul><li><b>Barbarian:</b> 2 (3 at 4th level, 4 at 10th)</li><li><b>Fighter:</b> 3 (4 at 4th level, 5 at 10th, 6 at 16th)</li><li><b>Paladin, Ranger, Rogue:</b> 2</li></ul>
<p>With more than one of these classes, use the best number; it doesn't add up.</p>`;
/** Give an actor with one of the classes the Weapon Mastery feature, once. */
export async function ensureClassMastery(actor) {
  if (!actor?.isOwner || actor.type !== "pc" || !classMastery(actor)) return;
  if (actor.items.some(isClassMasteryItem)) return;
  await actor.createEmbeddedDocuments("Item", [{ name: "Weapon Mastery", type: "feature",
    img: "icons/skills/melee/weapons-crossed-swords-yellow.webp",
    system: { description: { value: CM_TEXT }, identifier: { value: "weapon-mastery" } },
    flags: { [MODULE]: { classMastery: true } } }]);
}
export const chosenKinds = actor => actor?.getFlag?.(MODULE, "masteryKinds") ?? [];
export const kindOf = item => item?.system?.type?.base || `name:${String(item?.name ?? "").toLowerCase()}`;
const hasWeaponMastery = actor => masteryAllowance(actor) > 0;

function kindLabel(k, actor) {
  if (k.startsWith("name:")) return actor?.items?.find(i => kindOf(i) === k)?.name ?? k.slice(5);
  for (const cat of Object.values(CONFIG.BlackFlag?.weapons ?? {})) {
    const c = cat.children?.[k]; if (c) return game.i18n.localize(c.label ?? c);
  }
  return k;
}

/** The chooser: every Simple and Martial weapon kind, plus the actor's own weapons that have no base kind. */
export async function chooseMasteries(actor) {
  const n = masteryAllowance(actor);
  if (!n) return ui.notifications.warn(`${actor.name} has no feature that grants weapon masteries.`);
  const chosen = new Set(chosenKinds(actor));
  const box = (k, label) => `<label style="display:inline-flex;align-items:center;gap:4px;width:32%;margin:1px 0"><input type="checkbox" name="k" value="${k}" ${chosen.has(k) ? "checked" : ""}>${foundry.utils.escapeHTML(label)}</label>`;
  let html = `<p>${actor.name} can use the mastery properties of <b>${n}</b> kind${n > 1 ? "s" : ""} of weapon. You can change them after a Long Rest.</p>`;
  for (const [ck, cat] of Object.entries(CONFIG.BlackFlag?.weapons ?? {})) {
    if (ck === "natural" || !cat.children) continue;
    html += `<h4 style="margin:6px 0 2px">${game.i18n.localize(cat.label ?? ck)}</h4><div>` +
      Object.entries(cat.children).map(([k, c]) => box(k, game.i18n.localize(c.label ?? c))).join("") + `</div>`;
  }
  const own = [...new Map(actor.items.filter(i => i.type === "weapon" && !i.system?.type?.base).map(i => [kindOf(i), i.name])).entries()];
  if (own.length) html += `<h4 style="margin:6px 0 2px">${actor.name}'s other weapons</h4><div>` + own.map(([k, nm]) => box(k, nm)).join("") + `</div>`;
  const picked = await foundry.applications.api.DialogV2.prompt({
    window: { title: `Weapon masteries: ${actor.name}` }, position: { width: 560 }, content: html,
    ok: { label: "Save", callback: (ev, button) => [...button.form.querySelectorAll('input[name="k"]:checked')].map(i => i.value) },
    rejectClose: false
  });
  if (!picked) return;
  if (picked.length > n) ui.notifications.warn(`Only ${n} allowed - the first ${n} were kept.`);
  await actor.setFlag(MODULE, "masteryKinds", picked.slice(0, n));
  ui.notifications.info(`${actor.name}: weapon masteries ${picked.slice(0, n).map(k => kindLabel(k, actor)).join(", ") || "none"}.`);
}
globalThis.TselverseMastery = { choose: chooseMasteries, allowance: masteryAllowance, chosen: chosenKinds, classMastery: (...a) => classMastery(...a), ensure: (...a) => ensureClassMastery(...a) };

// a class that grants Weapon Mastery (house rule): add the feature
Hooks.on("createItem", (item, options, userId) => {
  if (!enabled() || userId !== game.user.id || !(item.parent instanceof Actor)) return;
  // no chooser popping up by itself (user, 2026-10-14): the sheet's Weapon Mastery box opens it
  if (item.type === "class") setTimeout(() => ensureClassMastery(item.parent), 1500);
});
// a level gained in one of the classes (the class item is updated, not created) - and characters made before this
Hooks.on("updateActor", (actor, changes, options, userId) => {
  if (enabled() && userId === game.user.id && foundry.utils.hasProperty(changes, "system.progression")) setTimeout(() => ensureClassMastery(actor), 1500);
});
Hooks.once("ready", () => {
  if (!enabled()) return;
  for (const a of game.actors) if (a.isOwner && (game.user.isGM ? !a.hasPlayerOwner || !game.users.some(u => u.active && !u.isGM && a.testUserPermission(u, "OWNER")) : true)) ensureClassMastery(a);
});

// the granting feature's sheet: the chosen kinds and a button to change them
Hooks.on("renderApplicationV2", (app, element) => {
  if (!enabled()) return;
  const item = app.document;
  if (!(item instanceof Item) || !item.actor || !(grantOf(item) || isClassMasteryItem(item))) return;
  const root = element instanceof HTMLElement ? element : element?.[0];
  const area = root?.querySelector(".description-area") ?? root?.querySelector(".editor") ?? null;
  if (!area) return;
  area.parentElement.querySelector(".tsvc-mastery-pick")?.remove();
  const actor = item.actor, n = masteryAllowance(actor), ch = chosenKinds(actor);
  area.insertAdjacentHTML("afterend", `<div class="tsvc-mastery-pick" style="border-left:3px solid var(--bf-color-accent,#8a6d3b);padding:4px 8px;margin:6px 0">
    <p style="margin:0 0 4px"><strong>Mastery weapons (${ch.length}/${n}):</strong> ${ch.length ? ch.map(k => foundry.utils.escapeHTML(kindLabel(k, actor))).join(", ") : "<em>none chosen yet</em>"}</p>
    <button type="button" class="tsvc-mastery-choose" style="width:auto;padding:0 10px">Choose weapons</button></div>`);
  area.parentElement.querySelector(".tsvc-mastery-choose")?.addEventListener("click", () => chooseMasteries(actor));
});

function masteryHtml(system) {
  const m = masteryOf(system);
  if (!m) return "";
  const [name, text] = MASTERIES[m];
  const actor = system.parent?.actor;
  let who = " Usable only by a character with a Weapon Mastery feature.";
  if (actor) {
    const n = masteryAllowance(actor), ch = chosenKinds(actor);
    if (!n) who = " Usable only by a character with Weapon Mastery.";
    else if (ch.includes(kindOf(system.parent))) who = " One of your chosen mastery weapons: you can use it.";
    else if (ch.length < n) who = ` Not one of your mastery weapons - you have ${n - ch.length} left to choose (on your Weapon Mastery feature).`;
    else who = ` Not one of your ${n} chosen mastery weapons.`;
  }
  return `<div class="tsvc-mastery" style="border-left: 3px solid var(--bf-color-accent, #8a6d3b); padding: 2px 8px; margin: 6px 0;"><p><strong>Mastery: ${name}.</strong> ${text}<em>${who}</em></p></div>`;
}

Hooks.once("init", () => {
  game.settings.register(MODULE, "masteries", {
    name: "Weapon masteries (2024) beside weapon options",
    hint: "Every weapon also has its 2024 (SRD 5.2.1) mastery (Complete Dancer's weapons theirs), shown with its weapon options, under its description and in its tooltip. A character uses only the masteries of the weapon kinds chosen for their Weapon Mastery (or similar) feature.",
    scope: "world", config: true, type: Boolean, default: true, requiresReload: true
  });
  if (!enabled()) return;
  const opts = CONFIG.BlackFlag?.weaponOptions;
  const Model = CONFIG.Item.dataModels?.weapon;
  if (!opts || !Model) { console.warn(`${MODULE} | Black Flag weapon options not found - masteries not added`); return; }
  for (const [m, [name]] of Object.entries(MASTERIES)) opts[optKey(m)] = { label: `Mastery: ${name}` };
  const proto = Model.prototype;

  // prepared data: the default mastery joins the weapon's options (source untouched)
  const prep = proto.prepareDerivedData;
  proto.prepareDerivedData = function (...args) {
    const r = prep.apply(this, args);
    try {
      const m = masteryOf(this);
      if (m && this.options instanceof Set) this.options.add(optKey(m));
    } catch (e) { console.warn(`${MODULE} | mastery`, e); }
    return r;
  };

  // Details tab: the default shows ticked, marked as the default
  const sheet = proto.getSheetData;
  proto.getSheetData = async function (context, ...rest) {
    const r = await sheet.call(this, context, ...rest);
    const ticked = [...(context.source?.options ?? [])].some(k => KEYS[k]);
    const m = masteryOf(this);
    if (m && !ticked && context.options?.[optKey(m)]) {
      context.options[optKey(m)].selected = true;
      context.options[optKey(m)].label += " (default)";
    }
    return r;
  };

  // tooltip: the rule under the description, and a tag
  const tip = proto.getTooltipData;
  proto.getTooltipData = async function (...args) {
    const ctx = await tip.apply(this, args);
    const html = masteryHtml(this);
    if (html) {
      ctx.description = (ctx.description ?? "") + html;
      ctx.tags = [...(ctx.tags ?? []), { key: "mastery", label: `Mastery: ${MASTERIES[masteryOf(this)][0]}` }];
    }
    return ctx;
  };
});

// the weapon sheet: the rule under the description
Hooks.on("renderApplicationV2", (app, element) => {
  if (!enabled()) return;
  const item = app.document;
  if (!(item instanceof Item) || item.type !== "weapon") return;
  const root = element instanceof HTMLElement ? element : element?.[0];
  const area = root?.querySelector(".description-area");
  if (!area) return;
  area.parentElement.querySelector(".tsvc-mastery")?.remove();
  const html = masteryHtml(item.system);
  if (html) area.insertAdjacentHTML("afterend", html);
});

/*
 * The character sheet: a Weapon Mastery box beside the Intellect one (Progression view) and in the column with
 * skills and tools (main view), showing chosen/allowed; clicking it opens the chooser. Built like
 * tselverse-intellect's boxes (its tsvip-progression / tsvip-main styles), but without its "tsvip" class, which
 * that module clears from the sheet on every render.
 */
Hooks.on("renderApplicationV2", (app, element) => {
  try {
    if (!enabled()) return;
    const root = element instanceof HTMLElement ? element : app.element;
    const actor = app.document ?? app.actor;
    if (!root || actor?.documentName !== "Actor" || actor.type !== "pc") return;
    const n = masteryAllowance(actor);
    root.querySelectorAll("fieldset.tsvc-mbox").forEach(f => f.remove());
    if (!n) return;
    const ch = chosenKinds(actor);
    const esc = foundry.utils.escapeHTML;
    const names = ch.map(k => esc(kindLabel(k, actor))).join(", ");
    const over = ch.length > n ? " tsvip-over" : "";
    const state = ch.length < n ? `Choose ${n - ch.length} weapon${n - ch.length > 1 ? "s" : ""}` : "Change weapons";
    const prog = document.createElement("fieldset");
    prog.className = "tsvc-mbox tsvip-progression";
    prog.innerHTML = `<legend>Weapon Mastery</legend>
      <figure class="icon"><i class="fa-solid fa-swords" inert></i></figure>
      <span><button type="button" class="link-button tsvc-mopen" data-tooltip="The weapon kinds whose mastery properties this character can use">${state}</button>
      ${ch.length ? `<span class="subclass tsvip-picks">${names}</span>` : ""}</span>
      <span class="levels tsvip-count${over}">${ch.length}/${n}</span>`;
    const main = document.createElement("fieldset");
    main.className = "tsvc-mbox tsvip-main";
    main.innerHTML = `<legend style="display:flex;align-items:center;gap:6px">Weapon Mastery
      <button type="button" class="link-button tsvc-mopen" aria-label="Choose weapons" data-tooltip="Choose weapon masteries"><i class="fa-solid fa-cog" inert></i></button>
      <span class="tsvip-count${over}" style="margin-left:auto">${ch.length}/${n}</span></legend>
      ${ch.length ? `<ul class="tsvip-list">${ch.map(k => `<li>${esc(kindLabel(k, actor))}</li>`).join("")}</ul>`
                  : `<p class="tsvip-empty">${n} to choose</p>`}`;
    const spots = [[root.querySelector("section.details fieldset.background")?.parentElement, prog],
      [root.querySelector("fieldset.vehicles")?.parentElement ?? root.querySelector("fieldset.skills")?.parentElement, main]];
    for (const [col, box] of spots) {
      if (!col) continue;
      for (const b of box.querySelectorAll(".tsvc-mopen")) {
        if (actor.isOwner) b.addEventListener("click", () => chooseMasteries(actor));
        else b.replaceWith(...b.childNodes);
      }
      col.append(box);
    }
  } catch (err) { console.error(`${MODULE} | weapon mastery box`, err); }
});
