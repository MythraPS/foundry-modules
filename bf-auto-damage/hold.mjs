/**
 * GM review of attacks (2026-10-14).
 *
 * Every attack the GM rolls is rolled for real but held, with its damage: players' clients show neither card
 * (review.mjs). A whispered card lets the GM change the d20 and the damage, or Reroll both; Confirm rewrites the
 * dice to match (so the cards show ordinary-looking dice and totals), posts both cards to everyone, applies the
 * damage to every target the final roll hits and, on a critical hit or failure, draws the crit table (crits.mjs).
 * Discard deletes the lot.
 *
 * Contracts (black-flag.mjs 3.0.078, Foundry 14):
 *  - Black Flag posts roll cards with `ChatMessage.applyMode(data, messageConfig.rollMode)`; "gm" whispers to GMs.
 *  - Roll cards carry flags["black-flag"] = { activity: { uuid }, roll: { type: "attack" | "damage" }, targets }.
 *  - The attack card judges each target live: critical success, or total >= AC without a critical failure.
 */
import { MODULE_ID, esc, gmIds, attackHold, d20Of, activeFace, setFace, retotal, diceInfo, setTotal, release } from "./shared.mjs";
import { d20State, drawCrit } from "./crits.mjs";
export { MODULE_ID };

/** Should this attack be held? The GM rolling it, with holding on. */
export function shouldHold(activity) {
  try { return !!activity?.actor && game.user.isGM && game.settings.get(MODULE_ID, "hold"); }
  catch { return false; }
}

/** The newest roll card of this kind for this activity, posted in the last minute by this user. */
function findCard(activity, type) {
  const now = Date.now();
  return game.messages.contents.slice().reverse().find(m => {
    const f = m.flags?.["black-flag"];
    return f?.activity?.uuid === activity.uuid && f?.roll?.type === type && m.author?.id === game.user.id && now - (m.timestamp ?? 0) < 60000;
  });
}

/** The roll's dice at their un-doubled count, and what a normal and a critical version of it can total. */
function ranges(roll) {
  const { rest } = diceInfo(roll);
  const base = roll.dice.map(d => ({ n: d.options?.baseNumber ?? d.number, faces: d.faces }));
  const n = base.reduce((a, d) => a + d.n, 0), top = base.reduce((a, d) => a + d.n * d.faces, 0);
  return { normal: [rest + n, rest + top], crit: [rest + 2 * n, rest + 2 * top] };
}
/** The same damage rolled again as a critical (dice doubled) or not, when the GM turned a hit into a critical or back. */
async function recast(roll, critical) {
  if (!!roll.options?.isCritical === critical) return roll;
  const formula = roll.terms.map(t => t.faces && Array.isArray(t.results) ? `${t.options?.baseNumber ?? t.number}d${t.faces}`
    : t.operator ?? (t.number ?? t.formula ?? "")).join(" ");
  const options = { ...roll.options, isCritical: critical };
  delete options.configured; delete options.preprocessed;          // or the new roll skips doubling its dice
  const r = new roll.constructor(formula, roll.data, options);
  await r.evaluate();
  return r;
}

/** Called from the attack hook for a held attack, after its (held) damage was rolled. */
export async function openReview(activity, attackRoll, damageRolls) {
  try {
    const atk = findCard(activity, "attack");
    const dmg = damageRolls?.length ? findCard(activity, "damage") : null;
    if (!atk) return;
    const targets = (atk.flags["black-flag"].targets ?? []).map(t => ({ name: t.name, ac: t.ac, uuid: t.uuid }));
    const die = d20Of(attackRoll);
    const face = die ? activeFace(die) : null;
    const { hi, lo } = d20State(attackRoll);
    const mod = attackRoll.total - (face ?? 0);
    const rows = (dmg?.rolls ?? []).map((r, i) => {
      const { normal, crit } = ranges(r);
      return `<div class="bfad-row" data-normal="${normal.join(",")}" data-crit="${crit.join(",")}"><label>${esc(r.options?.damageType ?? "damage")} <small class="bfad-range"></small></label>
        <input type="number" name="dmg${i}" value="${r.total}"></div>`;
    }).join("");
    const content = `<div class="bfad-review" data-mod="${mod}" data-hi="${hi}" data-lo="${lo}" data-adv="${die?.options?.advantageMode ?? 0}" data-pair="${die?.results?.length > 1 ? 1 : 0}">
      <h4>${esc(activity.actor.name)}: ${esc(activity.item?.name ?? activity.name)}</h4>
      <p><i>Only you can see this. Change or reroll it, then Confirm to show it to everyone.</i></p>
      <div class="bfad-row"><label>d20 <small>(${mod >= 0 ? "+" : "−"}${Math.abs(mod)} = <b class="bfad-total">${attackRoll.total}</b>)</small></label>
        <input type="number" name="face" value="${face ?? ""}" min="1" max="20" ${face == null ? "disabled" : ""}></div>
      <ul class="bfad-targets">${targets.map(t => `<li data-ac="${t.ac}">${esc(t.name)} (AC ${t.ac ?? "?"}): <b></b></li>`).join("")}</ul>
      ${rows || "<p>No damage roll.</p>"}
      <div class="bfad-buttons"><button type="button" data-bfad="reroll">Reroll</button><button type="button" data-bfad="confirm">Confirm</button><button type="button" data-bfad="discard">Discard</button></div>
    </div>`;
    await ChatMessage.create({ content, speaker: { alias: "Roll review" }, whisper: gmIds(),
      flags: { [MODULE_ID]: { review: { activity: activity.uuid, attack: atk.id, damage: dmg?.id ?? null, targets } } } });
  } finally {
    if (attackHold.uuid === activity.uuid) attackHold.uuid = null;
  }
}

const faceState = el => {
  const face = Number(el.querySelector('[name="face"]')?.value);
  return { face, crit: face >= Number(el.dataset.hi ?? 20), fumble: face <= Number(el.dataset.lo ?? 1) };
};

function judge(el) {
  const { face, crit, fumble } = faceState(el);
  const total = face + Number(el.dataset.mod);
  const t = el.querySelector(".bfad-total"); if (t && Number.isFinite(total)) t.textContent = total;
  for (const row of el.querySelectorAll(".bfad-row[data-normal]")) {      // a critical doubles the dice: show what it can total
    const [lo, hi] = row.dataset[crit ? "crit" : "normal"].split(",").map(Number);
    const inp = row.querySelector("input"); inp.min = lo; inp.max = hi;
    row.querySelector(".bfad-range").textContent = `(${lo}–${hi}${crit ? ", critical" : ""})`;
    if (Number(inp.value) < lo) inp.value = lo; if (Number(inp.value) > hi) inp.value = hi;
  }
  for (const li of el.querySelectorAll(".bfad-targets li")) {
    const ac = Number(li.dataset.ac);
    const hit = crit || (!fumble && Number.isFinite(ac) && total >= ac);
    li.querySelector("b").textContent = crit ? "CRITICAL HIT" : fumble ? "critical miss" : hit ? "hit" : "miss";
  }
}

/** A fresh d20 (kept the same way as the original: advantage, disadvantage or one die) and fresh damage to match. */
async function reroll(message, el) {
  const adv = Number(el.dataset.adv), pair = el.dataset.pair === "1";
  const d = await new Roll(pair && adv > 0 ? "2d20kh" : pair && adv < 0 ? "2d20kl" : "1d20").evaluate();
  el.querySelector('[name="face"]').value = d.total;
  await rerollDamage(message, el);
}

/** Fresh damage values for the review card, critical or not as its d20 now says. */
async function rerollDamage(message, el) {
  const info = message.flags[MODULE_ID].review;
  const { crit } = faceState(el);
  el.dataset.crit = crit ? 1 : 0;
  const dmg = info.damage ? game.messages.get(info.damage) : null;
  const kept = [];
  for (const [i, r] of (dmg?.rolls ?? []).entries()) {
    const fresh = await recast(r, crit);
    const again = fresh === r ? await r.reroll() : fresh;
    kept.push(again);
    const inp = el.querySelector(`[name="dmg${i}"]`); if (inp) inp.value = again.total;
  }
  rolled.set(message.id, { crit, rolls: kept });
  judge(el);
}

/** The damage rolls behind the numbers a Reroll put in the card, by review message id: kept as rolled if unchanged. */
const rolled = new Map();

async function confirm(message, el) {
  const info = message.flags[MODULE_ID].review;
  const atk = game.messages.get(info.attack), dmg = info.damage ? game.messages.get(info.damage) : null;
  if (!atk) { ui.notifications.warn("The attack card is gone."); return message.delete(); }
  const face = Number(el.querySelector('[name="face"]')?.value);
  const aRoll = atk.rolls[0];
  const die = d20Of(aRoll);
  if (die && face >= 1 && face <= 20) { setFace(die, face); retotal(aRoll); }
  await release(atk, { rolls: atk.rolls });

  // judged from the face just set (the roll's own critical getters can still hold the old die's answer)
  const { crit, fumble } = d20State(aRoll);
  const hits = info.targets.filter(t => crit || (Number.isFinite(t.ac) && aRoll.total >= t.ac && !fumble));
  if (dmg) {
    if (info.targets.length && !hits.length) await dmg.delete();   // a miss: nobody ever sees the damage
    else {
      const rolls = [];
      const last = rolled.get(message.id);
      rolled.delete(message.id);
      for (const [i, r] of dmg.rolls.entries()) {
        const fresh = last?.crit === crit && last.rolls[i] ? last.rolls[i] : await recast(r, crit);
        const want = Number(el.querySelector(`[name="dmg${i}"]`)?.value ?? fresh.total);
        rolls.push(fresh.total === want ? fresh : setTotal(fresh, want));   // untouched numbers keep their real dice
      }
      await release(dmg, { rolls });
      if (hits.length && game.settings.get(MODULE_ID, "autoApply")) {
        const damages = BlackFlag.dice.aggregateDamageRolls(rolls, { respectProperties: true })
          .map(r => ({ magical: r.options.magical === true, rollType: "damage", type: r.options.damageType, value: r.total }));
        for (const t of hits) {
          const actor = fromUuidSync(t.uuid);
          if (actor?.applyDamage) await actor.applyDamage(damages, { multiplier: 1 });
        }
      }
    }
  }
  await message.delete();
  if (crit || fumble) {
    const activity = info.activity ? fromUuidSync(info.activity) : null;
    if (activity) await drawCrit(activity, crit);
  }
}

async function discard(message) {
  const info = message.flags[MODULE_ID].review;
  for (const id of [info.attack, info.damage]) if (id) await game.messages.get(id)?.delete();
  await message.delete();
}

Hooks.on("renderChatMessageHTML", (message, html) => {
  if (!message.flags?.[MODULE_ID]?.review) return;
  const el = html.querySelector(".bfad-review"); if (!el) return;
  if (!game.user.isGM) { html.style.display = "none"; return; }
  judge(el);
  el.dataset.crit = faceState(el).crit ? 1 : 0;
  el.querySelector('[name="face"]')?.addEventListener("input", async () => {
    // a hit turned critical (or back) doubles (or halves) the dice: roll its damage again to match
    if ((faceState(el).crit ? 1 : 0) !== Number(el.dataset.crit)) await rerollDamage(message, el);
    else judge(el);
  });
  const lock = () => el.querySelectorAll("button").forEach(b => b.disabled = true);
  el.querySelector('[data-bfad="reroll"]')?.addEventListener("click", async ev => {
    const btn = ev.currentTarget; btn.disabled = true;
    try { await reroll(message, el); } finally { btn.disabled = false; }
  });
  el.querySelector('[data-bfad="confirm"]')?.addEventListener("click", () => { lock(); confirm(message, el); });
  el.querySelector('[data-bfad="discard"]')?.addEventListener("click", () => { lock(); discard(message); });
});
