/**
 * Dead Tokens.
 *
 * Foundry marks a dead creature with a small status icon in the corner of the token and
 * changes nothing else. This module makes the whole token read as dead:
 *   - the artwork is faded and (optionally) drained of colour,
 *   - the skull is drawn across the whole token, using core's own overlay rendering
 *     (an ActiveEffect carrying `flags.core.overlay` is drawn large - Token#_drawEffects),
 *   - the token is drawn underneath living tokens.
 *
 * Draw order, verified in Foundry 14.367: primary canvas objects sort by `sortLayer`
 * first, then elevation, then `sort` (PrimaryCanvasGroup.SORT_LAYERS.TOKENS = 700), and
 * `Token#_refreshState` reassigns mesh.sortLayer on every refresh - so the value is set
 * again after each refresh rather than once.
 */

const MODULE = "dead-tokens";
const DEAD = "dead";

const setting = key => game.settings.get(MODULE, key);
const isDead = token => !!token?.actor?.statuses?.has(DEAD);

/** A creature that is dead by hit points: 0 or less, and it has a hit point track. */
function atZeroHP(actor) {
  const hp = actor?.system?.attributes?.hp;
  if (!hp || !Number.isFinite(hp.max) || hp.max <= 0) return false;
  return (Number(hp.value) || 0) <= 0;
}

// Black Flag actor types: pc, npc, lair, siege, vehicle
const isNPC = actor => actor?.type !== "pc";

Hooks.once("init", () => {
  const reg = (key, type, def, extra = {}) => game.settings.register(MODULE, key, {
    name: `DEADTOK.Settings.${key[0].toUpperCase()}${key.slice(1)}.Name`,
    hint: `DEADTOK.Settings.${key[0].toUpperCase()}${key.slice(1)}.Hint`,
    scope: "world", config: true, type, default: def, ...extra
  });
  reg("fade", Number, 0.5, { range: { min: 0.1, max: 1, step: 0.05 } });
  reg("grey", Boolean, true);
  reg("below", Boolean, true);
  reg("overlay", Boolean, true);
  reg("auto", Boolean, true);
  reg("npcOnly", Boolean, true);
  reg("revive", Boolean, true);
});

/* ------------------------------------------------------------------ appearance */

const greyFilter = () => {
  const f = new PIXI.ColorMatrixFilter();
  f.desaturate();
  return f;
};

function applyLook(token) {
  const mesh = token?.mesh;
  if (!mesh) return;
  const dead = isDead(token);
  if (dead) {
    mesh.alpha = mesh.alpha * setting("fade");
    if (setting("below")) mesh.sortLayer = (canvas.primary?.constructor?.SORT_LAYERS?.TOKENS ?? 700) - 1;
    if (setting("grey")) {
      mesh.filters ??= [];
      if (!mesh.filters.some(f => f[MODULE])) {
        const f = greyFilter();
        f[MODULE] = true;
        mesh.filters = [...mesh.filters, f];
      }
    }
  } else if (mesh.filters?.some(f => f[MODULE])) {
    mesh.filters = mesh.filters.filter(f => !f[MODULE]);
    if (!mesh.filters.length) mesh.filters = null;
  }
}

Hooks.on("refreshToken", applyLook);

/* ------------------------------------------------------------------ overlay skull */

/** Draw any `dead` effect across the whole token rather than as a corner icon. */
async function ensureOverlay(effect) {
  if (!setting("overlay") || !game.user.isGM) return;
  if (!effect?.statuses?.has(DEAD) || effect.flags?.core?.overlay) return;
  await effect.update({ "flags.core.overlay": true });
}

Hooks.on("createActiveEffect", effect => ensureOverlay(effect));
Hooks.on("updateActiveEffect", effect => ensureOverlay(effect));

/** Redraw the affected tokens when the dead status is added or removed. */
function refreshFor(actor) {
  for (const token of actor?.getActiveTokens?.() ?? []) {
    token.renderFlags.set({ refreshMesh: true, refreshState: true });
  }
}
Hooks.on("createActiveEffect", effect => { if (effect.statuses?.has(DEAD)) refreshFor(effect.parent); });
Hooks.on("deleteActiveEffect", effect => { if (effect.statuses?.has(DEAD)) refreshFor(effect.parent); });

/* ------------------------------------------------------------------ automatic marking */

Hooks.on("updateActor", async (actor, changed, options, userId) => {
  if (!game.user.isGM || userId !== game.user.id) return;
  if (!setting("auto")) return;
  if (foundry.utils.getProperty(changed, "system.attributes.hp") === undefined) return;
  if (setting("npcOnly") && !isNPC(actor)) return;

  const dead = actor.statuses?.has(DEAD);
  if (atZeroHP(actor) && !dead) {
    // CONFIG.specialStatusEffects.DEFEATED is "dead", so Combatant#isDefeated follows
    // from the status itself - no need to write the combatant's own `defeated` field.
    await actor.toggleStatusEffect(DEAD, { active: true, overlay: setting("overlay") });
  } else if (!atZeroHP(actor) && dead && setting("revive")) {
    await actor.toggleStatusEffect(DEAD, { active: false });
    // clear a defeated flag that was set by hand, so the combatant is not stuck defeated
    for (const c of game.combat?.combatants ?? []) {
      if (c.defeated && c.actor?.id === actor.id) await c.update({ defeated: false });
    }
  }
});

Hooks.once("ready", () => {
  game.modules.get(MODULE).api = { applyLook, isDead, atZeroHP };
  console.log(`${MODULE} | dead token styling ready`);
});
