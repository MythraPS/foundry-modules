/**
 * Feature icons on sheets follow the compendium (2026-10-19). A feature copied onto a character keeps the icon it
 * had when copied; when the compendium entry later gets its own icon (foundry-import feature-art), the copy still
 * shows the old placeholder (Tonk's purple crossed swords). On load the active GM swaps placeholders for the
 * compendium entry's icon. Only placeholder icons are replaced, so a picture someone chose on purpose stays.
 */
const PLACEHOLDERS = new Set([
  "icons/skills/melee/weapons-crossed-swords-purple.webp",
  "icons/skills/melee/weapons-crossed-swords-yellow.webp",
  "icons/magic/symbols/runes-carved-stone-yellow.webp",
  "icons/magic/symbols/runes-star-orange.webp",
  "icons/svg/item-bag.svg", "icons/svg/mystery-man.svg"
]);
Hooks.once("ready", async () => {
  if (!game.user.isGM || game.users.activeGM?.id !== game.user.id) return;
  for (const a of game.actors) {
    const ups = [];
    for (const i of a.items) {
      if (!["feature", "talent"].includes(i.type) || !PLACEHOLDERS.has(i.img)) continue;
      const su = i._stats?.compendiumSource ?? i.flags?.core?.sourceId; if (!su) continue;
      const src = await fromUuid(su).catch(() => null);
      if (src?.img && src.img !== i.img && !PLACEHOLDERS.has(src.img)) ups.push({ _id: i.id, img: src.img });
    }
    if (ups.length) try { await a.updateEmbeddedDocuments("Item", ups); } catch (e) { console.warn("tselverse-common | feature icons", a.name, e); }
  }
});
