/**
 * Black Flag Area Targets
 *
 * Two gaps, both in the system rather than in the content:
 *
 * 1. Placing an area template does not target anything. Black Flag creates the Region
 *    and fires `blackFlag.postCreateMeasuredTemplate`, then stops.
 *
 * 2. The save / check / damage buttons on a chat card act on the tokens you have
 *    SELECTED, not the ones you have targeted:
 *
 *      getActionTargets() {
 *        let targets = canvas.tokens.controlled.filter(t => t.actor);
 *        if (!targets.length && game.user.character) targets = ...getActiveTokens();
 *        // TODO: Alternatively fetch targeted tokens
 *
 *    So a 60-foot cone over five enemies still rolls one save, for whatever you had
 *    clicked. This module closes that TODO.
 *
 * Containment is computed with RegionDocument#testPoint against each token's centre
 * rather than read from `region.tokens`, because that Set is maintained by the
 * movement system as tokens enter and leave and is not guaranteed to be populated on
 * a region that was created a moment ago.
 */

const MODULE = "bf-area-targets";

const setting = key => {
  try { return game.settings.get(MODULE, key); } catch { return true; }
};

/** Tokens on the current scene whose centre lies inside any of the given regions. */
function tokensInside(regions) {
  const found = new Set();
  for (const region of regions) {
    if (typeof region?.testPoint !== "function") continue;
    for (const token of canvas.tokens?.placeables ?? []) {
      const doc = token.document;
      if (!doc || found.has(token)) continue;
      const centre = doc.getCenterPoint?.() ?? {x: token.center?.x, y: token.center?.y};
      if (centre?.x === undefined) continue;
      // Elevation matters for cylinders and for regions with a height band.
      if (region.testPoint({x: centre.x, y: centre.y, elevation: doc.elevation ?? 0})) found.add(token);
    }
  }
  return [...found];
}

Hooks.once("init", () => {
  game.settings.register(MODULE, "autoTarget", {
    name: "BFAREATARGETS.SettingAutoTargetName",
    hint: "BFAREATARGETS.SettingAutoTargetHint",
    scope: "client", config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE, "clearOnTurn", {
    name: "BFAREATARGETS.SettingClearName",
    hint: "BFAREATARGETS.SettingClearHint",
    scope: "world", config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE, "useTargets", {
    name: "BFAREATARGETS.SettingUseTargetsName",
    hint: "BFAREATARGETS.SettingUseTargetsHint",
    scope: "client", config: true, type: Boolean, default: true
  });
  // Keybindings must be registered during init; registering in "ready" throws
  // "You cannot register a Keybinding after the init hook" and Alt+Delete never worked.
  game.keybindings.register(MODULE, "clearTemplates", {
    name: "BFAREATARGETS.KeybindClear",
    hint: "BFAREATARGETS.KeybindClearHint",
    editable: [{key: "Delete", modifiers: ["Alt"]}],
    onDown: () => { clearTemplates(); return true; },
    restricted: true
  });
});

Hooks.once("ready", () => {
  // (2) Prefer targeted tokens over selected ones, which is the system's own TODO.
  // getActionTargets lives on the base Activity class. Reach it by walking up from
  // any registered activity type rather than guessing an export path.
  let holder = null;
  for (const cfg of Object.values(CONFIG.Activity?.types ?? {})) {
    let proto = cfg?.documentClass?.prototype;
    while (proto && proto !== Object.prototype) {
      if (Object.hasOwn(proto, "getActionTargets")) { holder = proto; break; }
      proto = Object.getPrototypeOf(proto);
    }
    if (holder) break;
  }
  if (!holder) {
    console.error(`${MODULE} | getActionTargets not found; targets will not be used for saves`);
  } else {
    const original = holder.getActionTargets;
    holder.getActionTargets = function() {
      if (setting("useTargets")) {
        const targeted = [...(game.user.targets ?? [])].filter(t => t.actor);
        if (targeted.length) return targeted;
      }
      return original.call(this);
    };
    console.log(`${MODULE} | saves and checks will use targeted tokens`);
  }

  // (3) Save and check links ([[/save]], [[/check]], [[/skill]]) ignore targets.
  // Black Flag wires each link with its own click listener (handleRoll -> rollCheckSave),
  // which rolls for canvas.tokens.controlled only (getSelectedTokens) and sets
  // `target.disabled = true` while it runs, so nothing later in the event sees the click.
  // Measured 2026-09-17: with the Tormenauk only TARGETED, clicking Shifting Form's save
  // did nothing. Handle the click in the capture phase instead - before that listener -
  // when there are targets, and leave the selected-token behaviour untouched otherwise.
  const LINK_ACTIONS = new Set(["ability-save", "ability-check", "skill", "tool"]);
  document.addEventListener("click", event => {
    const link = event.target?.closest?.(".roll-link");
    const group = link?.closest?.(".roll-link-group") ?? null;
    if (!link) return;
    const dataset = {...(group?.dataset ?? {}), ...link.dataset};
    if (!LINK_ACTIONS.has(dataset.rollAction) || !setting("useTargets")) return;
    const targeted = [...(game.user.targets ?? [])].filter(t => t.actor);
    if (!targeted.length) return;                        // no targets: Black Flag's own behaviour
    event.preventDefault();
    event.stopImmediatePropagation();
    const {rollAction, dc, action: _a, tooltip: _t, ...data} = dataset;
    (async () => {
      for (const actor of new Set(targeted.map(t => t.actor))) {
        const config = {event, ...data};
        if (config.ability === "spellcasting") config.ability = actor.system.spellcasting?.ability;
        if (dc) config.target = Number(dc);
        await actor.roll(rollAction, config);
      }
    })();
  }, true);
  console.log(`${MODULE} | save and check links roll for targeted tokens when there are any`);


});

/**
 * Every ability template on the current scene.
 *
 * Black Flag asks for `"flags.core.MeasuredTemplate": true` when it creates these, but
 * that dotted key does not survive document creation -- the stored regions carry no
 * such flag -- so its own marker is unusable. We stamp our own on creation instead and
 * fall back to the name it gives them, `<Activity> [<User>]`, for regions placed
 * before this module existed.
 */
function abilityTemplates() {
  return (canvas.scene?.regions ?? []).filter(r =>
    r.getFlag?.(MODULE, "ability") || /\s\[[^\]]+\]$/.test(r.name ?? ""));
}

async function clearTemplates({announce = true} = {}) {
  const ids = abilityTemplates().map(r => r.id);
  if (!ids.length) {
    if (announce) ui.notifications.info(game.i18n.localize("BFAREATARGETS.NoneToClear"));
    return 0;
  }
  await canvas.scene.deleteEmbeddedDocuments("Region", ids);
  if (announce) ui.notifications.info(game.i18n.format("BFAREATARGETS.Cleared", {count: ids.length}));
  return ids.length;
}

// The area lasts for the action that made it. Combat moving on is the natural end.
Hooks.on("updateCombat", (combat, changed) => {
  if (!game.user.isGM || !game.settings.get(MODULE, "clearOnTurn")) return;
  if (!("turn" in changed) && !("round" in changed)) return;
  clearTemplates({announce: false});
});
Hooks.on("deleteCombat", () => {
  if (!game.user.isGM || !game.settings.get(MODULE, "clearOnTurn")) return;
  clearTemplates({announce: false});
});

// (1) Target everything inside a template the moment it is placed.
Hooks.on("blackFlag.postCreateMeasuredTemplate", async (activity, templates) => {
  if (!setting("autoTarget")) return;
  const regions = await templates;                 // the system passes the pending promise
  const list = Array.isArray(regions) ? regions : [regions];
  const regionDocs = list.filter(r => r);
  // Stamp a marker we can find later; Black Flag's own does not persist.
  for (const r of regionDocs) await r.setFlag?.(MODULE, "ability", true);
  const tokens = tokensInside(regionDocs);
  // V14 API: TokenLayer#setTargets. `game.user.updateTokenTargets` no longer exists.
  canvas.tokens.setTargets(tokens.map(t => t.id), {mode: "replace"});
  ui.notifications.info(tokens.length
    ? game.i18n.format("BFAREATARGETS.Targeted", {count: tokens.length})
    : game.i18n.localize("BFAREATARGETS.None"));
});

/* -------------------------------------------------------------------------------------- */
/* Cubes (and walls) never placed.
 *
 * Black Flag maps a cube to the "ray" template, and TemplatePlacement#createShapeData
 * builds a ray as a LINE: `{ length: size, width: baseSizes.width * gridMultiplier }`. A
 * cube carries no width - Black Flag's own Thunderwave has none - so width comes out NaN,
 * Foundry's LineShapeData rejects it ("width: must be a number"), and the chat card's
 * Place Template button only shows a warning. Walls hit the same path.
 *
 * `blackFlag.preCreateMeasuredTemplate` runs just before that, with the shapes still
 * editable, so the missing width is filled in there:
 *   - cube: width = its size. A line of length S and width S is an S x S square with the
 *     origin on the middle of one edge, which is exactly a cube seen from above.
 *   - anything else without one (walls): one grid square.
 */
Hooks.on("blackFlag.preCreateMeasuredTemplate", (activity, config) => {
  const kind = activity?.target?.template?.type;
  for (const shape of config?.shapes ?? []) {
    if (shape?.type !== "ray" || Number.isFinite(shape.width)) continue;
    shape.width = kind === "cube" && Number.isFinite(shape.size)
      ? shape.size
      : canvas?.scene?.grid?.distance ?? 5;
  }
});
