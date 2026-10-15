/**
 * Attack abilities per attack, for weapons with more than one form.
 *
 * Black Flag picks a weapon attack's ability from the weapon itself (Finesse: STR or DEX; ranged:
 * DEX). A trick weapon from Steinhardt's Guide is a Battleaxe one moment and a Pepperbox the next,
 * so each of its form buttons names the abilities that form allows in its flags
 * (`flags["tselverse-common"].abilities`), and the higher of them is used, as for Finesse.
 */
const MODULE = "tselverse-common";

Hooks.once("init", () => {
  const Model = CONFIG.BlackFlag?._activityTypes?.attack?.documentClass?.metadata?.dataModel;
  const desc = Model && Object.getOwnPropertyDescriptor(Model.prototype, "availableAbilities");
  if (!desc?.get) { console.warn(`${MODULE} | Black Flag attack abilities not found - trick weapon forms use the weapon's`); return; }
  Object.defineProperty(Model.prototype, "availableAbilities", {
    configurable: true,
    get() {
      const own = this.parent?.flags?.[MODULE]?.abilities;
      return Array.isArray(own) && own.length ? new Set(own) : desc.get.call(this);
    }
  });
});
