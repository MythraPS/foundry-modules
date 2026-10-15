/**
 * Undo Damage for Black Flag (Tales of the Valiant).
 *
 * Foundry's undo (Ctrl+Z) is canvas-only: `PlaceablesLayer#undoHistory` pops an entry
 * recorded by the placeable layers, and document field changes such as hit points are
 * never in that history. This module keeps its own stack of hit point changes.
 *
 * Verified in Foundry 14.367: `KeyboardManager##executeKeybind` runs matching keybinds in
 * precedence order and stops at the first that returns a truthy value, so a PRIORITY
 * Ctrl+Z that returns false when its stack is empty falls straight through to core's
 * undo (and to canvas-redo's Ctrl+Y, which is registered at NORMAL).
 */

const MODULE = "hp-undo";
const HP = "system.attributes.hp";
const FIELDS = ["value", "temp", "tempMax", "damage"];

const undoStack = [];
const redoStack = [];

const depth = () => game.settings.get(MODULE, "depth");
const say = (key, data) => {
  if (game.settings.get(MODULE, "notify")) ui.notifications.info(game.i18n.format(`HPUNDO.${key}`, data));
};

/** Snapshot of the hit point fields a change is about to touch. */
function pick(source, changed) {
  const out = {};
  for (const f of FIELDS) {
    const after = foundry.utils.getProperty(changed, `${HP}.${f}`);
    if (after === undefined) continue;
    out[f] = { before: foundry.utils.getProperty(source, `${HP}.${f}`), after };
  }
  return foundry.utils.isEmpty(out) ? null : out;
}

function buildUpdate(entry, which) {
  const update = {};
  for (const [f, v] of Object.entries(entry.fields)) update[`${HP}.${f}`] = v[which];
  return update;
}

async function applyEntry(entry, which) {
  const actor = await fromUuid(entry.uuid);
  if (!actor?.update) { ui.notifications.warn(game.i18n.localize("HPUNDO.Gone")); return null; }
  await actor.update(buildUpdate(entry, which), { [MODULE]: true });
  return actor;
}

Hooks.once("init", () => {
  game.settings.register(MODULE, "depth", {
    name: "HPUNDO.Settings.Depth.Name", hint: "HPUNDO.Settings.Depth.Hint",
    scope: "client", config: true, type: Number, default: 50, range: { min: 5, max: 200, step: 5 }
  });
  game.settings.register(MODULE, "notify", {
    name: "HPUNDO.Settings.Notify.Name", hint: "HPUNDO.Settings.Notify.Hint",
    scope: "client", config: true, type: Boolean, default: true
  });

  game.keybindings.register(MODULE, "undo", {
    name: "HPUNDO.Keybind.Undo",
    editable: [{ key: "KeyZ", modifiers: ["Control"] }],
    onDown: () => undo(),
    precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY
  });
  game.keybindings.register(MODULE, "redo", {
    name: "HPUNDO.Keybind.Redo",
    editable: [
      { key: "KeyY", modifiers: ["Control"] },
      { key: "KeyZ", modifiers: ["Control", "Shift"] }
    ],
    onDown: () => redo(),
    precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY
  });
});

/** Record the values a hit point change replaces. */
Hooks.on("preUpdateActor", (actor, changed, options) => {
  if (options?.[MODULE]) return;                       // our own undo/redo write
  const fields = pick(actor._source, changed);
  if (!fields) return;
  options[`${MODULE}Fields`] = fields;
});

Hooks.on("updateActor", (actor, changed, options, userId) => {
  if (userId !== game.user.id) return;                 // only the client that made the change
  const fields = options?.[`${MODULE}Fields`];
  if (!fields) return;
  undoStack.push({ uuid: actor.uuid, name: actor.name, fields });
  while (undoStack.length > depth()) undoStack.shift();
  redoStack.length = 0;                                // a new change invalidates the redo chain
});

/** @returns {boolean} true when a hit point change was undone, so the keypress is consumed. */
function undo() {
  if (!undoStack.length) return false;
  const entry = undoStack.pop();
  applyEntry(entry, "before").then(actor => {
    if (!actor) return;
    redoStack.push(entry);
    say("Undone", { name: entry.name, hp: actor.system.attributes.hp.value });
  });
  return true;
}

/** @returns {boolean} true when a hit point change was redone. */
function redo() {
  if (!redoStack.length) return false;
  const entry = redoStack.pop();
  applyEntry(entry, "after").then(actor => {
    if (!actor) return;
    undoStack.push(entry);
    say("Redone", { name: entry.name, hp: actor.system.attributes.hp.value });
  });
  return true;
}

Hooks.once("ready", () => {
  game.modules.get(MODULE).api = { undo, redo, undoStack, redoStack };
  console.log(`${MODULE} | hit point undo ready (Ctrl+Z / Ctrl+Y)`);
});
