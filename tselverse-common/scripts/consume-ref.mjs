/**
 * Item-uses consumption by identifier - for compendium features that spend ANOTHER feature's uses.
 *
 * Black Flag's "item uses" consumption names its target by the embedded item's id, which a
 * compendium entry can't know (the Sorcerer's Font of Magic only ever touches itself). A target
 * written "identifier:dance" is resolved, when the activity is used or its cost is shown, to the
 * character's item with that identifier - e.g. the Dancer's Grand Finale, which gets its own use
 * back by spending 2 Dance uses.
 */
const MODULE = "tselverse-common";
const PREFIX = "identifier:";

/** `this` (a ConsumptionTargetData) with the identifier target swapped for the real item id. */
function resolved(target) {
  if (typeof target.target !== "string" || !target.target.startsWith(PREFIX)) return target;
  const ident = target.target.slice(PREFIX.length);
  const item = target.actor?.items?.find(i => i.system?.identifier?.value === ident);
  // (no such item: an id that can't match, so Black Flag reports it missing rather than using this item)
  return Object.create(target, { target: { value: item?.id ?? `missing-${ident}`, enumerable: true } });
}

Hooks.once("init", () => {
  const cfg = CONFIG.BlackFlag?.consumptionTypes?.item;
  if (!cfg?.consume) { console.warn(`${MODULE} | Black Flag item-uses consumption not found - identifier targets off`); return; }
  const consume = cfg.consume, labels = cfg.consumptionLabels;
  cfg.consume = function (...args) { return consume.apply(resolved(this), args); };
  if (labels) cfg.consumptionLabels = function (...args) { return labels.apply(resolved(this), args); };
});
