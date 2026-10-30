/**
 * House conditions for Black Flag.
 *
 * - Poisoned is called Weakened. Same rules (disadvantage on attack rolls and ability checks).
 * - Stunned is replaced by Dazed: the creature can't take reactions, and on its turn it can
 *   move or take one action, not both, and can't take a bonus action. It is NOT incapacitated
 *   and doesn't auto-fail STR and DEX saves.
 *
 * Status ids stay "poisoned" and "stunned", so every book, effect and immunity that uses them
 * keeps working and simply shows the new name and rules. Text in descriptions, journals and chat
 * is changed as it is shown, in text only (never in links or image paths).
 *
 * "Poisoned" before a thing ("poisoned dagger", "poisoned food") means coated in poison and is
 * left alone. "Stunt" is never touched.
 */
const THINGS = /^\s+(daggers?|blades?|weapons?|arrows?|bolts?|darts?|needles?|spears?|sickles?|spines?|spikes?|stings?|stingers?|bites?|claws?|fangs?|food|drinks?|wine|water|wells?|fountains?|dinner|meals?|blood|land|earth|souls?|minds?|overminds?|volley|wounds?|bark|ammunition)\b/i;

const DAZED_NOTE = "A dazed creature can't take reactions. On its turn it can move or take one action, not both, and can't take a bonus action.";
const WEAKENED_NOTE = "A weakened creature has disadvantage on attack rolls and ability checks.";

function matchCase(found, word) {
  if (found === found.toUpperCase()) return word.toUpperCase();
  if (found[0] === found[0].toUpperCase()) return word[0].toUpperCase() + word.slice(1);
  return word;
}

const STUN = { stun: "daze", stuns: "dazes", stunned: "dazed", stunning: "dazing" };

/** Swap the condition words in plain text. */
export function houseText(text) {
  if (!text || !/poisoned|stun(?!t)/i.test(text)) return text;
  return text
    .replace(/\bpoisoned\b/gi, (found, offset, all) =>
      THINGS.test(all.slice(offset + found.length)) ? found : matchCase(found, "weakened"))
    .replace(/\b(stun|stuns|stunned|stunning)\b/gi, found => matchCase(found, STUN[found.toLowerCase()]));
}

/** Swap the condition words in HTML, touching text nodes only. */
export function houseHTML(html) {
  if (typeof html !== "string" || !/poisoned|stun(?!t)/i.test(html)) return html;
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  const walk = document.createTreeWalker(tpl.content, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) n.nodeValue = houseText(n.nodeValue);
  return tpl.innerHTML;
}

function relabel() {
  const c = game.i18n.translations?.BF?.Condition;
  if (c?.Poisoned) Object.assign(c.Poisoned, { Label: "Weakened", Note: WEAKENED_NOTE });
  if (c?.Stunned) Object.assign(c.Stunned, { Label: "Dazed", Note: DAZED_NOTE });
  // Black Flag names the statuses in its own i18nInit hook, which runs before this one
  for (const s of CONFIG.statusEffects ?? []) {
    if (s.id === "poisoned") s.name = "Weakened";
    if (s.id === "stunned") { s.name = "Dazed"; s.statuses = []; }
  }
}

Hooks.once("init", () => {
  const notes = CONFIG.BlackFlag?.statusEffectRollNotes;
  if (notes) notes.stunned = [{ filter: [{ k: "type", v: "attack" }], rollMode: 0, text: "BF.Condition.Stunned.Note" }];
  const st = CONFIG.BlackFlag?.statusEffects?.stunned;
  if (st) st.statuses = [];
});

Hooks.once("i18nInit", relabel);
Hooks.once("setup", () => {
  relabel();
  const TE = CONFIG.ux?.TextEditor ?? foundry.applications.ux.TextEditor.implementation;
  const enrich = TE.enrichHTML;
  TE.enrichHTML = async function (...args) {
    return houseHTML(await enrich.apply(this, args));
  };
});
