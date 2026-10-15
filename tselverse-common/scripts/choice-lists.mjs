/**
 * Pick from a list where Black Flag only takes a drop.
 *
 * Some "choose a feature" advancements carry no options at all and rely on the player dragging one
 * in from a compendium: Human's Ambitious ("one talent of your choice"), Jack of All Trades, Epic
 * Boon. Their configuration is an empty `pool` with `allowDrops` on, so the Select dialog shows
 * nothing but "Drop a talent here". For those, `choices()` now offers every compendium item the
 * advancement itself would accept (type, feature category/type, source) - the same test a drop
 * goes through. Prerequisites are left to the dialog, which already disables what the character
 * can't take; the search / list / book bar on it comes from tselverse-spells (tidyOptionPicker).
 */
const MODULE = "tselverse-common";

/** Candidate documents per kind ("talent", "feature|class|epicBoon"), fetched once per session. */
const cache = new Map();
const kindKey = ({ type, restriction = {} }) =>
  type === "feature" ? `feature|${restriction.category ?? ""}|${restriction.type ?? ""}` : type ?? "";

/** Compendium items of a kind. Uses the index every client already holds to pick the packs and
 *  ids, so only matching documents are fetched. The first fetch after a server restart is slow
 *  (~20 s for the 3000-entry tov-extras pack, measured), hence the warm-up after login below. */
function candidates(config) {
  const key = kindKey(config);
  if (cache.has(key)) return cache.get(key);
  const { type, restriction = {} } = config;
  const job = (async () => {
    const lists = await Promise.all(game.packs.filter(p => p.documentName === "Item" && p.visible).map(async pack => {
      const index = pack.indexed ? pack.index : await pack.getIndex();
      if (!index.some(e => !type || e.type === type)) return [];
      // features: let the server match the category, or every class feature would be sent
      if (type === "feature" && restriction.category) return pack.getDocuments({ type,
        system: { type: { category: restriction.category, ...(restriction.type ? { value: restriction.type } : {}) } } });
      return pack.getDocuments({ _id__in: index.filter(e => !type || e.type === type).map(e => e._id) });
    }));
    return lists.flat();
  })();
  job.catch(() => cache.delete(key));
  cache.set(key, job);
  return job;
}

/** Every compendium item an empty-pool advancement would accept, sorted by name. */
async function openChoices(adv) {
  const out = []; const seen = new Set();
  for (const doc of await candidates(adv.configuration)) {
    if (seen.has(doc.name) || adv.selectionLimitReached(doc)) continue;
    let ok = false;
    try { ok = adv._validateItemType(doc, { strict: false }); } catch { ok = false; }
    if (!ok) continue;
    seen.add(doc.name); out.push(doc);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
}

// Fetch the talent list quietly after login, so the first Select Talent opens at once.
Hooks.once("ready", () => setTimeout(() => candidates({ type: "talent" }).catch(() => {}), 3000));

Hooks.once("init", () => {
  const Adv = CONFIG.Advancement?.types?.chooseFeatures?.documentClass;
  if (!Adv?.prototype?.choices) { console.warn(`${MODULE} | chooseFeatures advancement not found - empty choices stay drop-only`); return; }
  const original = Adv.prototype.choices;
  Adv.prototype.choices = async function() {
    const pool = Object.values(this.configuration.pool ?? {});
    if (pool.length || !this.configuration.allowDrops) return original.call(this);
    return openChoices(this);
  };
});
