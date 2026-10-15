/**
 * What the attack review (hold.mjs), the general roll review (review.mjs) and the crit tables (crits.mjs) share:
 * the module id, the dice editing helpers and the release of a held message.
 *
 * A held message carries flags["bf-auto-damage"].held = { whisper, blind, group, combatant }: who it was meant
 * for before it was held, "attack" if the attack review card handles it, and the combatant whose initiative it is.
 */
export const MODULE_ID = "bf-auto-damage";
export const esc = s => foundry.utils.escapeHTML(String(s ?? ""));
export const gmIds = () => game.users.filter(u => u.isGM).map(u => u.id);

/** The attack being held right now (set from preRollAttack until its review card is up), so its cards join it. */
export const attackHold = { uuid: null };

export const d20Of = roll => roll.terms.find(t => t.faces === 20 && Array.isArray(t.results));
export const activeFace = die => (die.results.find(r => r.active) ?? die.results[0])?.result;
export function setFace(die, face) {
  const r = die.results.find(x => x.active) ?? die.results[0];
  if (r) r.result = face;
  if (die.results.length > 1) {                      // advantage / disadvantage: keep the shown pair believable
    const other = die.results.find(x => x !== r);
    const adv = (die.options?.advantageMode ?? 0);
    if (other && adv > 0 && other.result > face) other.result = Math.max(1, face - 1 - Math.floor(Math.random() * Math.max(1, face - 1)));
    if (other && adv < 0 && other.result < face) other.result = Math.min(20, face + 1 + Math.floor(Math.random() * Math.max(1, 20 - face)));
  }
}
export function retotal(roll) { roll._total = roll._evaluateTotal(); return roll; }

/** Dice-only bounds of a roll, and a new face for every die so the roll totals `want` (clamped to them). */
export function diceInfo(roll) {
  const dice = roll.dice.flatMap(d => d.results.filter(r => r.active !== false).map(r => ({ r, faces: d.faces })));
  const sum = dice.reduce((a, x) => a + x.r.result, 0);
  const rest = roll.total - sum;
  return { dice, rest, min: dice.length + rest, max: dice.reduce((a, x) => a + x.faces, 0) + rest };
}
export function setTotal(roll, want) {
  const { dice, rest, min, max } = diceInfo(roll);
  if (!dice.length) return retotal(roll);
  let left = Math.max(min, Math.min(max, want)) - rest;
  for (const x of dice) { x.r.result = 1; left -= 1; }
  while (left > 0) {                                  // a pip at a time onto a random die, so the faces look rolled
    const room = dice.filter(x => x.r.result < x.faces);
    if (!room.length) break;
    room[Math.floor(Math.random() * room.length)].r.result += 1;
    left -= 1;
  }
  return retotal(roll);
}

/** A detached copy of a message's roll, safe to change. */
export const copyRoll = r => Roll.fromData(foundry.utils.deepClone(r.toJSON()));

/**
 * Show a held message to the people it was meant for: post it again as a new message, now, with `rolls` in place
 * of its own if given, and delete the held one. Posting anew (rather than un-whispering it) puts it at the bottom
 * of everyone's chat with the dice sound, like any roll. A held initiative roll also sets the combatant's initiative.
 */
export async function release(message, { rolls } = {}) {
  const held = message.flags?.[MODULE_ID]?.held ?? {};
  const data = message.toObject();
  delete data._id;
  data.whisper = held.whisper ?? [];
  data.blind = !!held.blind;
  data.timestamp = Date.now();
  if (rolls) data.rolls = rolls.map(r => JSON.stringify(r.toJSON()));
  delete data.flags[MODULE_ID].held;
  data.flags[MODULE_ID].released = true;
  const created = await ChatMessage.implementation.create(data);
  await message.delete();
  if (held.combatant) {
    const c = fromUuidSync(held.combatant);
    const total = (rolls ?? message.rolls)[0]?.total;
    if (c && Number.isFinite(total)) await c.update({ initiative: total });
  }
  return created;
}
