/* Carry: a ship tile takes everything on it along when it is moved or resized. A tile is a ship
 * tile when it sits on the same spot as a tile on another level (the floors of one ship link up
 * by themselves), or when its Carry button (Tile HUD, left column, GM only) is switched on. The
 * button can also switch a stacked tile off. Hold Alt while moving or resizing to change only that
 * tile, e.g. to line a new floor up with the one above. A carried move or resize takes along: tokens standing on it (on every level), walls, lights, sounds, map
 * notes, regions (stairs between levels) and smaller tiles lying inside it. Carry tiles stacked on
 * the same spot - the levels of one ship - move and resize together, so changing either level
 * changes the whole ship. Moves go in whole grid squares so tokens stay on the grid; after a resize
 * tokens snap to the nearest square. Everything else on the scene stays where it is. */
const MOD = "tselverse-common";
const FLAG = "carry";
const OPT = "tselverseCarry";

const rectOf = d => ({ x: d.x, y: d.y, w: d.width, h: d.height });
const inside = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
const insideAny = (rs, x, y) => rs.some(r => inside(r, x, y));
const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
// stacked levels of one ship: carry tiles that cover most of each other
const sameShip = (a, b) => overlap(a, b) >= 0.5 * Math.min(a.w * a.h, b.w * b.h);

// old rects, kept between the pre- and post-update hooks of this client
const before = new Map();
const levelsOf = t => [...(t.levels ?? [])];
// a ship tile: Carry switched on, or stacked on another level's tile (unless switched off)
function isCarry(t) {
  const f = t.getFlag(MOD, FLAG);
  if (f !== undefined && f !== null) return !!f;
  const scene = t.parent; if (!scene || (scene.levels?.size ?? 0) < 2) return false;
  const mine = levelsOf(t), r = rectOf(t);
  return scene.tiles.some(o => o.id !== t.id && o.getFlag(MOD, FLAG) !== false
    && levelsOf(o).some(l => !mine.includes(l)) && sameShip(r, rectOf(o)));
}
const altHeld = () => { try { return game.keyboard.isModifierActive(foundry.helpers.interaction.KeyboardManager.MODIFIER_KEYS.ALT); } catch { return false; } };

// pending changes this tick: tile id -> { scene, old rect, new rect }
const pending = new Map();
let timer = null;

Hooks.on("preUpdateTile", (doc, change, options) => {
  if (options[OPT] || altHeld() || !isCarry(doc)) return;
  const moved = "x" in change || "y" in change, sized = "width" in change || "height" in change;
  if (!moved && !sized) return;
  before.set(doc.id, rectOf(doc));
  // a plain move goes in whole squares, so the tokens it carries stay on the grid
  const g = doc.parent?.grid?.size;
  if (!sized && g && !doc.parent.grid.isGridless) {
    if ("x" in change) change.x = doc.x + Math.round((change.x - doc.x) / g) * g;
    if ("y" in change) change.y = doc.y + Math.round((change.y - doc.y) / g) * g;
  }
});

Hooks.on("updateTile", (doc, change, options, userId) => {
  if (options[OPT] || userId !== game.user.id || !game.user.isGM) return;
  const old = before.get(doc.id); before.delete(doc.id);
  if (!old) return;
  const now = rectOf(doc);
  if (now.x === old.x && now.y === old.y && now.w === old.w && now.h === old.h) return;
  pending.set(doc.id, { scene: doc.parent, old, now });
  clearTimeout(timer);
  timer = setTimeout(flush, 50);   // tiles dragged together arrive as separate updates
});

async function flush() {
  const changes = [...pending.values()]; const changedIds = new Set(pending.keys()); pending.clear();
  if (!changes.length) return;
  const { scene, old: o, now: n } = changes[0];
  const sx = o.w ? n.w / o.w : 1, sy = o.h ? n.h / o.h : 1;
  const resized = sx !== 1 || sy !== 1;
  // where a point of the old ship lands on the new one
  const map = (x, y) => [n.x + (x - o.x) * sx, n.y + (y - o.y) * sy];
  const g = scene.grid.size, gridless = scene.grid.isGridless;
  const snap = v => (gridless ? Math.round(v) : Math.round(v / g) * g);

  // the whole ship: the changed carry tiles plus every carry tile stacked with them
  const rects = changes.map(c => c.old);
  const tileUps = [];
  for (const t of scene.tiles) {
    if (changedIds.has(t.id)) continue;
    const r = rectOf(t);
    const level = t.getFlag(MOD, FLAG) !== false && rects.some(q => sameShip(q, r)) && isCarry(t);
    const prop = rects.some(q => r.x >= q.x && r.y >= q.y && r.x + r.w <= q.x + q.w && r.y + r.h <= q.y + q.h);
    if (level) rects.push(r);
    if (!level && !prop) continue;
    const [x, y] = map(t.x, t.y);
    tileUps.push(resized ? { _id: t.id, x, y, width: t.width * sx, height: t.height * sy } : { _id: t.id, x, y });
  }
  const at = (x, y) => insideAny(rects, x, y);

  const tokenUps = [];
  for (const t of scene.tokens) {
    const w = t.width * g, h = t.height * g;
    const cx = t.x + w / 2, cy = t.y + h / 2;
    if (!at(cx, cy)) continue;
    const [nx, ny] = map(cx, cy);
    tokenUps.push({ _id: t.id, x: resized ? snap(nx - w / 2) : nx - w / 2, y: resized ? snap(ny - h / 2) : ny - h / 2 });
  }
  const wallUps = scene.walls.filter(w => at(w.c[0], w.c[1]) && at(w.c[2], w.c[3]))
    .map(w => ({ _id: w.id, c: [...map(w.c[0], w.c[1]), ...map(w.c[2], w.c[3])] }));
  const pointUps = coll => coll.filter(d => at(d.x, d.y)).map(d => { const [x, y] = map(d.x, d.y); return { _id: d.id, x, y }; });
  const regionUps = [];
  for (const reg of scene.regions) {
    const pts = [];
    for (const s of reg.shapes) {
      if (Array.isArray(s.points)) for (let i = 0; i < s.points.length; i += 2) pts.push([s.points[i], s.points[i + 1]]);
      else if (s.width != null) pts.push([s.x, s.y], [s.x + s.width, s.y + s.height]);
      else pts.push([s.x, s.y]);
    }
    if (!pts.length || !pts.every(([x, y]) => at(x, y))) continue;
    regionUps.push({ _id: reg.id, shapes: reg.shapes.map(s => {
      const d = s.toObject ? s.toObject() : foundry.utils.deepClone(s);
      if (Array.isArray(d.points)) d.points = d.points.map((v, i) => (i % 2 ? map(d.points[i - 1], v)[1] : map(v, d.points[i + 1])[0]));
      else {
        [d.x, d.y] = map(d.x, d.y);
        if (d.width != null) { d.width *= sx; d.height *= sy; }
        else if (d.radiusX != null) { d.radiusX *= sx; d.radiusY *= sy; }
        else if (d.radius != null) d.radius *= Math.min(sx, sy);
      }
      return d;
    }) });
  }
  const opts = { [OPT]: true };
  try {
    if (tileUps.length) await scene.updateEmbeddedDocuments("Tile", tileUps, opts);
    if (tokenUps.length) await scene.updateEmbeddedDocuments("Token", tokenUps, opts);
    if (wallUps.length) await scene.updateEmbeddedDocuments("Wall", wallUps, opts);
    for (const [name, coll] of [["AmbientLight", scene.lights], ["AmbientSound", scene.sounds], ["Note", scene.notes]]) {
      const ups = pointUps(coll); if (ups.length) await scene.updateEmbeddedDocuments(name, ups, opts);
    }
    if (regionUps.length) await scene.updateEmbeddedDocuments("Region", regionUps, opts);
  } catch (err) { console.error(`${MOD} | carry failed`, err); ui.notifications.warn("Carry: some things on the tile couldn't be moved (see console)."); }
}

Hooks.on("renderTileHUD", (hud, element) => {
  if (!game.user.isGM) return;
  const root = element instanceof HTMLElement ? element : element?.[0];
  const col = root?.querySelector(".col.left");
  const doc = hud.document ?? hud.object?.document;
  if (!col || !doc) return;
  col.querySelectorAll(".tsv-carry").forEach(n => n.remove());
  const on = isCarry(doc), auto = on && doc.getFlag(MOD, FLAG) == null;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "control-icon tsv-carry" + (on ? " active" : "");
  btn.dataset.tooltip = auto ? "Carry is ON by itself (this tile is a floor stacked with another level): moving or resizing it takes the ship's other floors and everything on board along. Hold Alt to move only this tile. Click to switch off."
    : on ? "Carry is ON: moving or resizing this tile takes the tokens, walls, lights and stairs on it along (and its other levels). Hold Alt to move only this tile. Click to turn off."
    : "Carry: make this tile take the tokens, walls, lights and stairs on it along when it moves or is resized.";
  btn.innerHTML = `<i class="fa-solid fa-ship" inert></i>`;
  btn.addEventListener("click", async ev => {
    ev.preventDefault();
    await doc.setFlag(MOD, FLAG, !on);
    hud.render?.();
  });
  col.append(btn);
});
