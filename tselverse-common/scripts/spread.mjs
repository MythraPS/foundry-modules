/**
 * Spread out / bunch up (2026-10-19, for Tonk): a Medium creature whose body can sprawl over a Large space.
 * The token gets a button that switches it between 1x1 and 2x2. Only the space on the map changes: the
 * actor stays Medium for every rule (the GM's ruling: it is flavour, plus the room it blocks).
 * Turned on per actor with flags["tselverse-common"].spread = true.
 */
const MODULE = "tselverse-common";

Hooks.on("renderTokenHUD", (hud, html) => {
  const doc = hud.object?.document;
  if (!doc?.actor?.getFlag(MODULE, "spread") || !doc.isOwner) return;
  const root = html instanceof HTMLElement ? html : html[0];
  const col = root.querySelector(".col.left") ?? root;
  const spread = doc.width > 1;
  const b = document.createElement("button");
  b.type = "button"; b.className = "control-icon";
  b.dataset.tooltip = spread ? "Bunch up (one square)" : "Spread out (2×2 squares)";
  b.innerHTML = `<i class="fa-solid ${spread ? "fa-down-left-and-up-right-to-center" : "fa-up-right-and-down-left-from-center"}" inert></i>`;
  b.addEventListener("click", async () => {
    // the token's size now, not when the HUD was drawn (the HUD isn't redrawn after the first click)
    const n = doc.width > 1 ? 1 : 2;
    await doc.update({ width: n, height: n });
    b.dataset.tooltip = n > 1 ? "Bunch up (one square)" : "Spread out (2×2 squares)";
    b.innerHTML = `<i class="fa-solid ${n > 1 ? "fa-down-left-and-up-right-to-center" : "fa-up-right-and-down-left-from-center"}" inert></i>`;
  });
  col.appendChild(b);
});
