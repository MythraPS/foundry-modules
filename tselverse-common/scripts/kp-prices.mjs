/**
 * Prices for the Kobold Press module's magic items (2026-10-20). The module ships them unpriced; these
 * were worked out by the Tales of the Valiant rules (Player's Guide p. 160-161, Player's Guide 2's steps,
 * kept inside each rarity's range) by foundry-import's price tool. Written into the compendium, so they show
 * in the compendium browser and shops. If a module update wipes them, the GM's browser puts them back on load.
 * Only items still without a price are touched.
 */
const MODULE = "tselverse-common";
const PACK = "koboldpressogl-bf.koboldpressitems";

Hooks.once("ready", async () => {
  // Any GM, not only the "active" one: the vault-export login (Import Checker) can be the active GM
  // and leaves before this finishes. The writes are identical, so two GMs running it is harmless.
  if (!game.user.isGM) return;
  const pack = game.packs.get(PACK);
  if (!pack) return;
  try {
    const prices = await (await fetch(foundry.utils.getRoute(`modules/${MODULE}/data/kp-prices.json`))).json();
    const idx = await pack.getIndex({fields: ["system.price"]});
    const updates = idx.filter(e => prices[e._id] && !e.system?.price?.value)
      .map(e => ({_id: e._id, "system.price.value": prices[e._id], "system.price.denomination": "gp"}));
    if (!updates.length) return;
    const wasLocked = pack.locked;
    if (wasLocked) await pack.configure({locked: false});
    try {
      for (let i = 0; i < updates.length; i += 200) await Item.implementation.updateDocuments(updates.slice(i, i + 200), {pack: PACK});
    } finally { if (wasLocked) await pack.configure({locked: true}); }
    console.log(`${MODULE} | priced ${updates.length} Kobold Press items`);
  } catch (e) { console.warn(`${MODULE} | Kobold Press prices`, e); }
});

/**
 * House-rule rarities for Kobold Press items (2026-10-22 item review): items far stronger or weaker
 * than their printed rarity are moved to the rarity that fits, priced again at that rarity. Each entry
 * keeps the book's rarity ("book"). Applied every load, so a module update can't undo it.
 */
Hooks.once("ready", async () => {
  // Any GM, not only the "active" one: the vault-export login (Import Checker) can be the active GM
  // and leaves before this finishes. The writes are identical, so two GMs running it is harmless.
  if (!game.user.isGM) return;
  const pack = game.packs.get(PACK);
  if (!pack) return;
  try {
    const want = await (await fetch(foundry.utils.getRoute(`modules/${MODULE}/data/kp-rarities.json`))).json();
    const idx = await pack.getIndex({fields: ["system.rarity", "system.price"]});
    const updates = idx.filter(e => want[e._id] && (e.system?.rarity !== want[e._id].rarity
        || (e.system?.price?.value || null) !== (want[e._id].price || null)))   // priceless: Foundry stores 0, the list null
      .map(e => ({_id: e._id, "system.rarity": want[e._id].rarity,
                  "system.price.value": want[e._id].price, "system.price.denomination": "gp"}));
    if (!updates.length) return;
    const wasLocked = pack.locked;
    if (wasLocked) await pack.configure({locked: false});
    try { await Item.implementation.updateDocuments(updates, {pack: PACK}); }
    finally { if (wasLocked) await pack.configure({locked: true}); }
    console.log(`${MODULE} | set house-rule rarity on ${updates.length} Kobold Press items`);
  } catch (e) { console.warn(`${MODULE} | Kobold Press rarities`, e); }
});
