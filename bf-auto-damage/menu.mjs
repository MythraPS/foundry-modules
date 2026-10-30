/**
 * Right-click a chat card -> Apply Damage / Apply as Healing / Apply Half Damage / Apply Double
 * Damage, onto the selected tokens (or, with none selected, the targeted ones). Takes over from
 * the "Damage Context Menu" module (bf-damage-menu 1.0.1, the same four entries): Black Flag
 * damage cards apply each roll with its own damage type, so resistances count; any other roll
 * (/r 4d6) applies its total as untyped damage. A player's click on a creature they don't own is
 * applied by the active GM, like an automatic hit.
 */
import { MODULE_ID } from "./hold.mjs";

const SOCKET = `module.${MODULE_ID}`;
const ENTRIES = [
  ["BFAD.Menu.Apply", "fa-solid fa-heart-crack", 1],
  ["BFAD.Menu.Healing", "fa-solid fa-heart-circle-plus", -1],
  ["BFAD.Menu.Half", "fa-solid fa-heart-circle-minus", 0.5],
  ["BFAD.Menu.Double", "fa-solid fa-skull", 2]
];

/** The damage parts a card carries, in the shape Actor#applyDamage takes. */
export function cardDamages(message) {
  try {
    const rolls = message?.rolls ?? [];
    if (!rolls.length) return [];
    const DamageRoll = CONFIG.Dice?.DamageRoll;
    const dmg = DamageRoll ? rolls.filter(r => r instanceof DamageRoll) : [];
    if (dmg.length) return dmg.map(r => ({ magical: r.options.magical === true,
      rollType: message.getFlag("black-flag", "roll.type") ?? "damage", type: r.options.damageType, value: r.total }));
    const plain = rolls.filter(r => r instanceof Roll && typeof r.total === "number");
    if (!plain.length) return [];
    return [{ magical: false, rollType: "damage", type: undefined, value: plain.reduce((s, r) => s + r.total, 0) }];
  } catch { return []; }
}

const tokensToHit = () => {
  const sel = canvas.tokens?.controlled ?? [];
  return sel.length ? sel : [...(game.user.targets ?? [])];
};

async function applyFrom(li, multiplier) {
  const message = game.messages.get(li?.dataset?.messageId);
  const damages = cardDamages(message);
  if (!damages.length) return;
  for (const token of tokensToHit()) {
    const actor = token.actor;
    if (!actor?.applyDamage) continue;
    if (actor.isOwner) { await actor.applyDamage(damages, { multiplier, isDelta: true }); continue; }
    if (game.users.activeGM) game.socket.emit(SOCKET, { type: "applyMenu", actor: actor.uuid, damages, multiplier });
    else ui.notifications.info(game.i18n.format("BFAD.Notify.NoGM", { name: token.name }));
  }
}

const usable = li => tokensToHit().length > 0 && cardDamages(game.messages.get(li?.dataset?.messageId)).length > 0;

Hooks.on("getChatMessageContextOptions", (app, options) => {
  for (const [label, icon, multiplier] of ENTRIES) {
    const entry = { icon: `<i class="${icon}"></i>`, group: "damage" };
    if (game.release?.generation >= 14) Object.assign(entry, { label, visible: li => usable(li), onClick: (event, li) => applyFrom(li, multiplier) });
    else Object.assign(entry, { name: label, condition: li => usable(li), callback: li => applyFrom(li, multiplier) });
    options.push(entry);
  }
});

// the active GM applies a player's menu click on a creature the player doesn't own
Hooks.once("ready", () => {
  game.socket.on(SOCKET, async (msg) => {
    if (msg?.type !== "applyMenu" || game.users.activeGM?.id !== game.user.id) return;
    const multiplier = [1, -1, 0.5, 2].includes(msg.multiplier) ? msg.multiplier : 1;
    try {
      const actor = await fromUuid(msg.actor);
      if (actor?.applyDamage) await actor.applyDamage(msg.damages, { multiplier, isDelta: true });
    } catch (err) { console.error(`${MODULE_ID} | applying a player's menu damage failed`, err); }
  });
});
