/**
 * Hide another module's entries that a newer printing replaces.
 *
 * The Kobold Press module carries the 2018 Creature Codex; the Revised edition is imported into
 * Tselverse Creatures. Listing both would show every Codex creature twice, once with old stats.
 * data/superseded.json - { "<pack id>": { "<entry id>": "<what replaces it>" } } - takes the old
 * ones out of the pack's index, which is what the compendium window and the Compendium Browser
 * list from. Nothing is deleted: the documents stay in the pack, links and world copies that
 * point at them still open, and a module update can't bring the duplicates back.
 */
const MODULE = "tselverse-common";
let HIDE = {};

const prune = pack => { for (const id of Object.keys(HIDE[pack?.collection] ?? {})) pack.index.delete(id); };
const pruneAll = () => { if (game.packs) for (const id of Object.keys(HIDE)) prune(game.packs.get(id)); };

// the list is read as the module loads; whichever finishes last - the read or the world's own
// compendium lists - does the pruning, so the order they finish in doesn't matter
const loaded = fetch(`modules/${MODULE}/data/superseded.json`, { cache: "no-cache" })
  .then(r => r.ok ? r.json() : {})
  .then(j => { HIDE = j ?? {}; pruneAll(); })
  .catch(e => console.warn(`${MODULE} | superseded.json not read`, e));

Hooks.once("init", () => {
  const CC = foundry.documents.collections?.CompendiumCollection ?? CompendiumCollection;
  const getIndex = CC.prototype.getIndex;
  CC.prototype.getIndex = async function(...args) {
    const index = await getIndex.apply(this, args);
    await loaded;
    prune(this);
    return index;
  };
});
Hooks.once("setup", pruneAll);
Hooks.once("ready", pruneAll);

// Foundry only applies a module's compendium-art mapping to entries it finds in the pack index, so
// the hidden ones above would keep their placeholder picture wherever they still turn up (old links,
// world copies). Once the world is ready, their mapped pictures are registered here instead.
Hooks.once("ready", async () => {
  if (!game.compendiumArt?.enabled) return;
  for (const mod of game.modules) {
    const cfg = mod.active && mod.flags?.compendiumArtMappings?.[game.system.id];
    if (!cfg?.mapping) continue;
    let map;
    try { const r = await fetch(cfg.mapping, { cache: "no-cache" }); if (!r.ok) continue; map = await r.json(); }
    catch (e) { continue; }
    for (const [packId, ids] of Object.entries(HIDE)) {
      const pack = game.packs.get(packId);
      if (!pack || pack.documentName !== "Actor") continue;
      for (const id of Object.keys(ids)) {
        const info = map?.[packId]?.[id];
        if (!info) continue;
        const uuid = pack.getUuid(id);
        if (game.compendiumArt.has(uuid)) continue;
        const img = info.img ?? info.actor;
        game.compendiumArt.set(uuid, { img, actor: img, token: info.token ?? img, ...(cfg.credit ? { credit: cfg.credit } : {}) });
      }
    }
  }
});
