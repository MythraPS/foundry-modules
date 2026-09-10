/**
 * Canvas Redo
 *
 * Foundry has no redo. Undo is a pop-only stack --
 *
 *     const event = this.history.pop();          // PlaceablesLayer#undoHistory
 *
 * -- and nothing is kept, so core registers no redo keybinding at all.
 *
 * This module keeps what the undo threw away and replays it through core's own
 * `_onUndoCreate` / `_onUndoUpdate` / `_onUndoDelete`.
 *
 * It works by snapshotting the affected documents immediately before the undo and
 * diffing them immediately after, rather than by reading the history entry. That
 * matters: a history entry is NOT always a complete description of the change.
 * TokenLayer#storeHistory strips every positional field out of the entry --
 *
 *     for ( const key of TokenDocument.MOVEMENT_FIELDS ) delete d[key];
 *
 * (x, y, elevation, width, height, depth, shape, level) and encodes the restore in
 * `options.movement` instead, so a token move records an entry whose `data` says
 * nothing about where the token was. Diffing the documents sidesteps every such
 * layer-specific quirk.
 *
 * Scope is inherited from core's undo and deliberately not widened: canvas placeables
 * only, per layer, cleared on reload and on any new action.
 */

const MODULE = "canvas-redo";

/** Fields that are internal bookkeeping and must never be written back. */
const INTERNAL = new Set(["actorData", "delta"]);
const isInternal = key => INTERNAL.has(key) || (key.startsWith("_") && key !== "_id");

/** Redo stacks, one per layer instance. WeakMap so a torn-down canvas is collectable. */
const stacks = new WeakMap();
const stackFor = layer => {
  let s = stacks.get(layer);
  if (!s) stacks.set(layer, s = []);
  return s;
};

const collectionOf = layer => canvas.scene?.getEmbeddedCollection(layer.constructor.documentName);

/** Current source data for the given ids, as a Map. Missing documents are skipped. */
function snapshot(layer, ids) {
  const collection = collectionOf(layer);
  const out = new Map();
  if (!collection) return out;
  for (const id of ids) {
    const doc = collection.get(id);
    if (doc) out.set(id, doc.toObject());
  }
  return out;
}

function stripInternal(obj) {
  for (const key of Object.keys(obj)) if (isInternal(key)) delete obj[key];
  return obj;
}

/**
 * The operation that reverses the undo that just ran.
 * @param {PlaceablesLayer} layer
 * @param {{type: string, data: object[]}} event - the entry the undo consumed
 * @param {Map<string, object>} before - document sources captured before the undo
 * @returns {{type: string, data: object[], options: object}|null}
 */
function redoEntry(layer, event, before) {
  switch (event.type) {
    // The undo deleted these; redoing re-creates them from the snapshot.
    // Entry type is "delete" because _onUndoDelete is the routine that creates.
    case "create": {
      const data = [...before.values()];
      return data.length ? {type: "delete", data, options: {}} : null;
    }

    // The undo re-created these; redoing deletes them again. _onUndoDelete passes
    // keepId, so the ids survive the round trip.
    case "delete": {
      const data = event.data.map(d => ({_id: d._id})).filter(d => d._id);
      return data.length ? {type: "create", data, options: {}} : null;
    }

    // The undo restored old values; redoing restores whatever was there before it.
    // Diff after-vs-before so only genuinely changed keys are written.
    case "update": {
      const collection = collectionOf(layer);
      const data = [];
      for (const [id, was] of before) {
        const now = collection?.get(id)?.toObject();
        if (!now) continue;
        const change = stripInternal(foundry.utils.diffObject(now, was));
        if (foundry.utils.isEmpty(change)) continue;
        change._id = id;
        data.push(change);
      }
      return data.length ? {type: "update", data, options: {}} : null;
    }
  }
  return null;
}

/** Apply a history-shaped entry through core's own undo routines. */
async function apply(layer, event) {
  switch (event.type) {
    case "create": return layer._onUndoCreate(event);
    case "update": return layer._onUndoUpdate(event);
    case "delete": return layer._onUndoDelete(event);
  }
  return [];
}

/** The ids an entry refers to. */
const idsOf = event => event.data.map(d => d._id).filter(id => id);

/** Ctrl+Y: re-apply the most recently undone operation on the active layer. */
async function redo() {
  if (!canvas?.ready) return false;
  const layer = canvas.activeLayer;
  if (!layer?.history) return false;

  if (game.paused && !game.user.isGM) {
    ui.notifications.warn("GAME.PausedWarning", {localize: true});
    return true;
  }

  const stack = stackFor(layer);
  if (!stack.length) {
    ui.notifications.info(game.i18n.format("CANVASREDO.Empty",
      {type: layer.constructor.documentName}));
    return true;
  }

  const event = stack.pop();
  const before = snapshot(layer, idsOf(event));
  const changed = await apply(layer, event);
  // Hand the reverse back to core's stack so Ctrl+Z steps over this action again.
  const back = redoEntry(layer, event, before);
  if (changed?.length && back) layer.history.push(back);
  return true;
}

Hooks.once("init", () => {
  const PlaceablesLayer = foundry.canvas?.layers?.PlaceablesLayer;
  if (!PlaceablesLayer?.prototype?.undoHistory) {
    console.error(`${MODULE} | PlaceablesLayer#undoHistory not found; redo disabled`);
    return;
  }

  // Capture what an undo throws away.
  const undoHistory = PlaceablesLayer.prototype.undoHistory;
  PlaceablesLayer.prototype.undoHistory = async function() {
    const next = this.history.at(-1);
    const before = next ? snapshot(this, idsOf(next)) : null;
    const changed = await undoHistory.call(this);
    if (!changed?.length || !next) return changed;
    const entry = redoEntry(this, next, before);
    if (entry) stackFor(this).push(entry);
    return changed;
  };

  // A genuinely new action invalidates the redo stack -- replaying it afterwards
  // would write stale values over whatever the new action did. Core's recorders skip
  // isUndo operations, so anything reaching _storeHistory is new by definition.
  // Wrapping the protected method rather than the public storeHistory is deliberate:
  // TokenLayer and RegionLayer both override the public one and call this themselves.
  const storeHistory = PlaceablesLayer.prototype._storeHistory;
  PlaceablesLayer.prototype._storeHistory = function(type, data, options = {}) {
    const result = storeHistory.call(this, type, data, options);
    stackFor(this).length = 0;
    return result;
  };

  game.keybindings.register(MODULE, "redo", {
    name: "CANVASREDO.Keybinding",
    hint: "CANVASREDO.KeybindingHint",
    editable: [
      {key: "KeyY", modifiers: ["Control"]},
      {key: "KeyZ", modifiers: ["Control", "Shift"]}
    ],
    onDown: () => redo(),
    precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
  });

  console.log(`${MODULE} | redo ready (Ctrl+Y / Ctrl+Shift+Z)`);
});

// Stacks are per-layer and per-session; a scene change makes them meaningless.
Hooks.on("canvasReady", () => {
  for (const layer of canvas.layers ?? []) stacks.get(layer)?.splice(0);
});
