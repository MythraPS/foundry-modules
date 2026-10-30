/* A dice count written as arithmetic, "(2 + floor((@progression.level + 1) / 6))d10" (2d10, one
 * more die at 5th, 11th and 17th level), showed on cards as "(2 + floor((3 + 1) / 6))d10":
 * Black Flag's simplifyFormula gives up on any formula with * or / that still holds dice. Once the
 * data is filled in, the bracket before the "d" is plain arithmetic, so work it out there and the
 * card reads "2d10". The roll is the same either way. Only brackets that hold numbers, + - * / and
 * floor/ceil/round/min/max/abs/trunc are touched; anything else is left as it was. */
const FNS = /\b(?:floor|ceil|round|min|max|abs|trunc)\b/g;
// a bracket (up to three levels deep) that is directly followed by a die: "(…)d10"
const COUNT = /\(((?:[^()]|\((?:[^()]|\([^()]*\))*\))*)\)(?=d\d)/g;

function workOutCounts(formula) {
  if (typeof formula !== "string" || !formula.includes(")d")) return formula;
  return formula.replace(COUNT, (whole, expr) => {
    if (!/^[\d\s+\-*/().,]*$/.test(expr.replace(FNS, ""))) return whole;
    try {
      const n = foundry.dice.Roll.safeEval(expr);
      return Number.isFinite(n) ? String(Math.max(0, Math.floor(n))) : whole;
    } catch { return whole; }
  });
}

Hooks.once("init", () => {
  const Roll = foundry.dice.Roll;
  const original = Roll.replaceFormulaData;
  if (typeof original !== "function") return console.warn("tselverse-common | Roll.replaceFormulaData not found - dice counts stay as written");
  Roll.replaceFormulaData = function (formula, data, options, _r) {
    const out = original.call(this, formula, data, options, _r);
    return _r ? out : workOutCounts(out);
  };
});
