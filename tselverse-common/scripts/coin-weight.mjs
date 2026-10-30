/** House rule: coins weigh nothing (they sit in the printvault's pocket dimension). */
Hooks.once("init", () => {
  const Model = CONFIG.Item.dataModels?.currency;
  if (!Model) return;
  const base = Model.prototype.prepareBaseData;
  Model.prototype.prepareBaseData = function(...args) {
    base?.apply(this, args);
    if (this.weight) this.weight.value = 0;
  };
});
