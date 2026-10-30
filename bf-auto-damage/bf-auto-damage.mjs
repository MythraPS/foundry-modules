/**
 * Auto Damage on Hit for Black Flag (Tales of the Valiant).
 *
 * Everything here reuses Black Flag's own contracts, read from black-flag.mjs 3.0.078:
 *  - `blackFlag.postRollAttack(rolls, { subject })` fires on the rolling client after the
 *    attack card is created; `subject` is the AttackActivity.
 *  - The attack card marks a target hit with
 *      `roll.isCriticalSuccess || (roll.total >= target.ac && !roll.isCriticalFailure)`
 *    against `BlackFlag.utils.getTargetDescriptors()` ({ name, img, uuid, ac }).
 *  - `activity.rollDamage(config, dialog, message)` rolls and posts the damage card;
 *    `dialog.configure: false` skips the prompt. Critical damage is `roll.options.isCritical`,
 *    set before the rolls are constructed, via `blackFlag.preRollDamage`.
 *  - The damage card's Apply tray builds its list with
 *    `aggregateDamageRolls(rolls, { respectProperties: true })` and calls
 *    `applyDamage(damages, { multiplier })`; resistances are handled inside applyDamage.
 */

import { MODULE_ID, shouldHold, openReview } from "./hold.mjs";
import { attackHold } from "./shared.mjs";
import { d20State, drawCrit } from "./crits.mjs";
import "./review.mjs";
import "./menu.mjs";
import "./mode.mjs";

const SOCKET = `module.${MODULE_ID}`;

// The active GM applies damage that players' hits deal to creatures the players don't own.
Hooks.once("ready", () => {
  game.socket.on(SOCKET, async (msg) => {
    if (msg?.type !== "applyDamage" || game.users.activeGM?.id !== game.user.id) return;
    if (!game.settings.get(MODULE_ID, "enabled") || !game.settings.get(MODULE_ID, "autoApply")) return;
    try {
      const actor = await fromUuid(msg.actor);
      if (actor?.applyDamage) await actor.applyDamage(msg.damages, { multiplier: 1 });
    } catch (err) { console.error(`${MODULE_ID} | applying a player's damage failed`, err); }
  });
});

Hooks.once("init", () => {
  const reg = (key, name, def) => game.settings.register(MODULE_ID, key, {
    name: `BFAD.Settings.${name}.Name`, hint: `BFAD.Settings.${name}.Hint`,
    scope: "world", config: true, type: Boolean, default: def
  });
  reg("enabled", "Enabled", true);
  reg("autoApply", "AutoApply", true);
  reg("noTarget", "NoTarget", true);
  reg("hold", "Hold", true);
  reg("crits", "Crits", true);
});

/**
 * Damage rolls this module started, keyed by activity uuid -> { critical }.
 *
 * AttackActivity#rollDamage(config, dialog, message) does NOT use its `dialog` argument:
 * it builds `dialogConfig` fresh from `{ options: {...} }`, and BasicRoll.build then sets
 * `dialog.configure ??= true`, so passing `{ configure: false }` still opened the damage
 * dialog and the roll waited for a click (measured live 2026-09-15). The same object is
 * handed to `blackFlag.preRollDamage` before build, so the prompt is suppressed there, and
 * only for rolls this module initiated - a manual damage click still gets its dialog.
 */
const pending = new Map();

/** Attacks being held for the GM's review, by activity uuid (see hold.mjs). */
const held = new Set();

Hooks.on("blackFlag.preRollAttack", (rollConfig, dialogConfig, messageConfig) => {
  const activity = rollConfig?.subject;
  if (!activity || !shouldHold(activity)) return;
  held.add(activity.uuid);
  attackHold.uuid = activity.uuid;                    // its attack and damage cards join the review (review.mjs)
  if (messageConfig) messageConfig.rollMode = "gm";
});

Hooks.on("blackFlag.preRollDamage", (rollConfig, dialogConfig, messageConfig) => {
  const activity = rollConfig?.subject;
  const job = activity && pending.get(activity.uuid);
  if (!job) return;
  pending.delete(activity.uuid);
  if (dialogConfig) dialogConfig.configure = false;
  if (job.held && messageConfig) messageConfig.rollMode = "gm";
  if (job.critical) {
    for (const r of rollConfig.rolls ?? []) {
      r.options ??= {};
      r.options.isCritical = true;
    }
  }
});

/** Crit tables for attacks that aren't held; a held attack draws when the GM confirms it (hold.mjs). */
Hooks.on("blackFlag.postRollAttack", (rolls, { subject: activity } = {}) => {
  if (!activity || activity.type !== "attack" || shouldHold(activity)) return;
  const { crit, fumble } = d20State(rolls?.[0]);
  if (crit || fumble) drawCrit(activity, crit);
});

Hooks.on("blackFlag.postRollAttack", async (rolls, { subject: activity } = {}) => {
  try {
    const roll = rolls?.[0];
    if (!roll || !activity || activity.type !== "attack") return;

    if (held.delete(activity.uuid)) {                 // held for review: roll the damage too, privately
      let damageRolls;
      if (game.settings.get(MODULE_ID, "enabled") && typeof activity.rollDamage === "function") {
        pending.set(activity.uuid, { critical: !!roll.isCriticalSuccess, held: true });
        try { damageRolls = await activity.rollDamage({}, { configure: false }, {}); }
        finally { pending.delete(activity.uuid); }
      }
      return openReview(activity, roll, damageRolls);
    }

    if (!game.settings.get(MODULE_ID, "enabled")) return;
    if (typeof activity.rollDamage !== "function") return;

    const targets = BlackFlag.utils.getTargetDescriptors();
    let hits;
    if (targets.length) {
      hits = targets.filter(t => roll.isCriticalSuccess
        || (Number.isFinite(t.ac) && roll.total >= t.ac && !roll.isCriticalFailure));
      if (!hits.length) return;                       // every target missed
    } else {
      if (!game.settings.get(MODULE_ID, "noTarget")) return;
      if (roll.isCriticalFailure) return;             // a natural fumble can't hit anything
      hits = [];
    }

    pending.set(activity.uuid, { critical: !!roll.isCriticalSuccess });
    let damageRolls;
    try {
      damageRolls = await activity.rollDamage({}, { configure: false }, {});
    } finally {
      pending.delete(activity.uuid);
    }
    if (!damageRolls?.length || !hits.length) return;
    if (!game.settings.get(MODULE_ID, "autoApply")) return;

    const damages = BlackFlag.dice.aggregateDamageRolls(damageRolls, { respectProperties: true })
      .map(r => ({
        magical: r.options.magical === true,
        rollType: "damage",
        type: r.options.damageType,
        value: r.total
      }));

    for (const t of hits) {
      const actor = fromUuidSync(t.uuid);
      if (!actor?.applyDamage) continue;
      if (!actor.isOwner) {
        // A player hitting a creature they don't own: the GM's client applies it (players can't
        // change other actors' hit points). Only when no GM is online does the player hear about it.
        if (game.users.activeGM) game.socket.emit(SOCKET, { type: "applyDamage", actor: t.uuid, damages });
        else ui.notifications.info(game.i18n.format("BFAD.Notify.NoGM", { name: t.name }));
        continue;
      }
      await actor.applyDamage(damages, { multiplier: 1 });
    }
  } catch (err) {
    console.error(`${MODULE_ID} | auto damage failed`, err);
  }
});
