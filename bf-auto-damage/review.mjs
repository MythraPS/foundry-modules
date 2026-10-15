/**
 * GM review of every roll the GM makes (2026-10-14).
 *
 * Any roll message the GM posts for others to see (attacks, damage, saves, checks, initiative, table draws) is held:
 * it goes to the GM only, players' clients don't show it at all (not even "rolled privately"), and a panel under it
 * offers Reroll, Confirm and Discard, with the result editable. Confirm posts it to its intended audience as a new
 * message; Discard deletes it. Rolls the GM already made private (GM-only or blind) pass through untouched.
 *
 * Attacks have their own combined review card (hold.mjs); their attack and damage cards are held here but carry
 * group "attack", so no panel is added to them.
 *
 * Initiative: Combat#rollInitiative (Foundry 14) writes the combatants' initiative before it posts the messages.
 * While the GM's call runs and holding is on, that write is blanked here, so the tracker shows no number until the
 * roll is confirmed; release() then writes the confirmed total.
 */
import { MODULE_ID, esc, gmIds, attackHold, d20Of, activeFace, setFace, retotal, diceInfo, setTotal, copyRoll, release } from "./shared.mjs";

const holding = () => game.user.isGM && game.settings.get(MODULE_ID, "hold");
const heldOf = m => m?.flags?.[MODULE_ID]?.held;
const tableOf = m => { const id = m.flags?.core?.RollTable; return id ? game.tables.get(id) : null; };

/* -------------------------------------------- */
/*  Hiding held messages from players           */
/* -------------------------------------------- */

Hooks.once("setup", () => {
  // A whispered roll is normally "visible" to everyone as "Gamemaster rolled privately"; a held one is not.
  const cls = CONFIG.ChatMessage.documentClass;
  let proto = cls.prototype, desc;
  while (proto && !(desc = Object.getOwnPropertyDescriptor(proto, "visible"))) proto = Object.getPrototypeOf(proto);
  if (desc?.get) Object.defineProperty(cls.prototype, "visible", {
    configurable: true,
    get() { return (!game.user?.isGM && heldOf(this)) ? false : desc.get.call(this); }
  });

  // Initiative written while the GM rolls it
  const cproto = CONFIG.Combat.documentClass.prototype;
  const roll = cproto.rollInitiative;
  cproto.rollInitiative = async function(...args) {
    rollingInit++;
    try { return await roll.apply(this, args); } finally { rollingInit--; }
  };
});

let rollingInit = 0;
const pendingInit = new Set();
Hooks.on("preUpdateCombatant", (combatant, changes, options, userId) => {
  if (!rollingInit || userId !== game.user.id || !holding() || typeof changes.initiative !== "number") return;
  pendingInit.add(combatant.uuid);
  changes.initiative = null;
});

/** The combatant whose blanked initiative this message carries. */
function initCombatant(msg) {
  if (!msg.flags?.core?.initiativeRoll) return null;
  const { token, actor } = msg.speaker ?? {};
  for (const uuid of pendingInit) {
    const c = fromUuidSync(uuid);
    if (c && ((token && c.tokenId === token) || (!token && c.actorId === actor))) { pendingInit.delete(uuid); return c; }
  }
  return null;
}

/* -------------------------------------------- */
/*  Holding                                     */
/* -------------------------------------------- */

Hooks.on("preCreateChatMessage", (msg, data, options, userId) => {
  if (userId !== game.user.id || !holding() || !msg.isRoll) return;
  const f = msg.flags?.[MODULE_ID];
  if (f?.released || f?.held || f?.review) return;
  const combatant = initCombatant(msg);
  const group = attackHold.uuid && msg.flags?.["black-flag"]?.activity?.uuid === attackHold.uuid ? "attack" : null;
  const gms = gmIds();
  const alreadyPrivate = msg.whisper.length && msg.whisper.every(id => gms.includes(id));
  if (alreadyPrivate && !group) {                    // a private roll stays as it is; its initiative goes straight in
    if (combatant) setTimeout(() => combatant.update({ initiative: msg.rolls[0]?.total ?? null }), 0);
    return;
  }
  const held = group ? { whisper: [], blind: false, group } : { whisper: [...msg._source.whisper], blind: !!msg.blind, group: null };
  if (combatant) held.combatant = combatant.uuid;
  msg.updateSource({ whisper: gms, blind: false, [`flags.${MODULE_ID}.held`]: held });
});

/* -------------------------------------------- */
/*  The review panel                            */
/* -------------------------------------------- */

/** What the GM edits for each roll: the d20's face on a d20 roll, else the total. */
function fields(message) {
  const table = tableOf(message);
  return message.rolls.map((r, i) => {
    const die = !table && d20Of(r);
    if (die && r.dice.length === 1) {
      const face = activeFace(die);
      return { i, kind: "face", value: face, min: 1, max: 20, label: "d20", note: `${r.total - face >= 0 ? "+" : "−"}${Math.abs(r.total - face)}` };
    }
    const { min, max } = diceInfo(r);
    return { i, kind: "total", value: r.total, min, max, label: table ? `${r.formula}` : (r.options?.flavor || r.formula), note: `${min}–${max}` };
  });
}

function panel(message) {
  const rows = fields(message).map(f => `<label class="bfad-gm-row"><span>${esc(f.label)} <small>(${esc(f.note)})</small></span>
    <input type="number" data-i="${f.i}" data-kind="${f.kind}" data-was="${f.value}" value="${f.value}" min="${f.min}" max="${f.max}"></label>`).join("");
  const others = game.messages.filter(m => heldOf(m) && !heldOf(m).group).length;
  const init = heldOf(message).combatant ? `<p class="bfad-gm-note">Initiative: the tracker shows it once you confirm.</p>` : "";
  return `<div class="bfad-gm">
    <p class="bfad-gm-note">Held: only you can see this roll.</p>${init}
    ${rows}
    <div class="bfad-gm-buttons">
      <button type="button" data-bfad-gm="reroll"><i class="fa-solid fa-dice"></i> Reroll</button>
      <button type="button" data-bfad-gm="confirm"><i class="fa-solid fa-check"></i> Confirm</button>
      <button type="button" data-bfad-gm="discard"><i class="fa-solid fa-trash"></i> Discard</button>
    </div>
    ${others > 1 ? `<button type="button" class="bfad-gm-all" data-bfad-gm="all">Confirm all ${others} held rolls</button>` : ""}
  </div>`;
}

/** The message's rolls with the GM's edits applied, or null if nothing changed. */
function edited(message, el) {
  const inputs = [...el.querySelectorAll(".bfad-gm input[data-i]")];
  if (!inputs.some(x => Number(x.value) !== Number(x.dataset.was))) return null;
  return message.rolls.map((r, i) => {
    const x = inputs.find(n => Number(n.dataset.i) === i);
    if (!x || Number(x.value) === Number(x.dataset.was)) return r;
    const c = copyRoll(r);
    if (x.dataset.kind === "face") { setFace(d20Of(c), Math.max(1, Math.min(20, Number(x.value)))); return retotal(c); }
    return setTotal(c, Number(x.value));
  });
}

/** A held table draw posted again for a given roll (a fresh one if none), still held; the old one deleted. */
async function redraw(message, table, roll) {
  let results;
  if (roll) results = table.getResultsForRoll(roll.total);
  else ({ roll, results } = await table.roll());
  const created = await table.toMessage(results, { roll, messageData: {
    speaker: message.speaker, whisper: gmIds(), flags: { [MODULE_ID]: { held: heldOf(message) } } } });
  await message.delete();
  return created;
}

async function reroll(message) {
  const table = tableOf(message);
  if (table) return redraw(message, table);
  const rolls = [];
  for (const r of message.rolls) rolls.push(await r.reroll());
  await message.update({ rolls: rolls.map(r => JSON.stringify(r.toJSON())) });
}

async function confirm(message, el) {
  const rolls = el ? edited(message, el) : null;
  const table = tableOf(message);
  if (rolls && table) return release(await redraw(message, table, rolls[0]));
  return release(message, rolls ? { rolls } : {});
}

Hooks.on("renderChatMessageHTML", (message, html) => {
  const held = heldOf(message);
  if (!held || held.group || !game.user.isGM) return;
  html.classList.add("bfad-held");
  html.insertAdjacentHTML("beforeend", panel(message));
  const busy = fn => async ev => {
    for (const b of html.querySelectorAll(".bfad-gm button")) b.disabled = true;
    try { await fn(); } catch (err) { console.error(`${MODULE_ID} | roll review`, err); ui.notifications.error("Roll review failed; see the console."); }
  };
  const on = (key, fn) => html.querySelector(`[data-bfad-gm="${key}"]`)?.addEventListener("click", busy(fn));
  on("reroll", () => reroll(message));
  on("confirm", () => confirm(message, html));
  on("discard", () => message.delete());
  on("all", async () => {
    const all = game.messages.filter(m => heldOf(m) && !heldOf(m).group).sort((a, b) => a.timestamp - b.timestamp);
    for (const m of all) await confirm(m, m === message ? html : document.querySelector(`.chat-message[data-message-id="${m.id}"]`));
  });
});

Hooks.once("ready", () => {
  if (!game.user.isGM) return;
  const style = document.createElement("style");
  style.textContent = `
    .chat-message.bfad-held { outline: 2px dashed var(--color-warm-2, #c9593f); outline-offset: -2px; }
    .bfad-gm { margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--color-border, #999); font-size: var(--font-size-12, 12px); }
    .bfad-gm-note { margin: 0 0 4px; font-style: italic; opacity: .8; }
    .bfad-gm-row { display: flex; align-items: center; gap: 6px; margin: 2px 0; }
    .bfad-gm-row span { flex: 1; }
    .bfad-gm-row input { width: 4.5em; flex: none; }
    .bfad-gm-buttons { display: flex; gap: 4px; margin-top: 4px; }
    .bfad-gm-buttons button, .bfad-gm-all { flex: 1; line-height: 24px; padding: 0 4px; font-size: inherit; }
    .bfad-gm-all { width: 100%; margin-top: 4px; }`;
  document.head.append(style);
});
