/**
 * Critical hit and failure tables (2026-10-14).
 *
 * On a critical hit or a critical failure of an attack roll, draws from the matching house table. The six tables
 * are world RollTables built from the vault notes by foundry-import's oneoff/crit_tables.py and found here by their
 * flag (flags["bf-auto-damage"].crit), so renaming or moving them changes nothing.
 *
 *  - Player characters: Table 1/2 for weapon attacks, Table 3/4 for spell attacks.
 *  - Everything else (monsters, NPCs): Table 5/6, for weapons and spells alike.
 *
 * A player's draw happens on their own client and shows at once. The GM's draws pass through the roll review like
 * any other GM roll (review.mjs), and a held attack draws only once the GM has confirmed it (hold.mjs).
 */
import { MODULE_ID } from "./hold.mjs";

/** The d20 a challenge roll was judged on, and its critical thresholds. */
export function d20State(roll) {
  const die = roll?.terms?.find(t => t.faces === 20 && Array.isArray(t.results));
  const face = die ? (die.results.find(r => r.active) ?? die.results[0])?.result : null;
  const hi = roll?.options?.criticalSuccess ?? die?.options?.criticalSuccess ?? 20;
  const lo = roll?.options?.criticalFailure ?? die?.options?.criticalFailure ?? 1;
  return { face, crit: face != null && face >= hi, fumble: face != null && face <= lo, hi, lo };
}

/** Which table an attack by this activity draws from, or null. */
export function critTable(activity, success) {
  const actor = activity?.actor;
  if (!actor) return null;
  const spell = activity.attack?.type?.classification === "spell" || activity.isSpell;
  const key = actor.hasPlayerOwner ? `${spell ? "spell" : "weapon"}-${success ? "hit" : "fail"}` : `monster-${success ? "hit" : "fail"}`;
  return game.tables.find(t => t.getFlag(MODULE_ID, "crit") === key) ?? null;
}

/** Draw the table for a critical hit (success true) or failure (false), spoken as the attacker. */
export async function drawCrit(activity, success) {
  try {
    if (!game.settings.get(MODULE_ID, "crits")) return;
    const table = critTable(activity, success);
    if (!table) return;
    const { roll, results } = await table.roll();
    const speaker = ChatMessage.implementation.getSpeaker({ actor: activity.actor });
    await table.toMessage(results, { roll, messageData: { speaker } });
  } catch (err) {
    console.error(`${MODULE_ID} | critical table draw failed`, err);
  }
}
