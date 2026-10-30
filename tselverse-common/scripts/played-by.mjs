/**
 * "Played by" on player character sheets: the names of the (non-GM) users who own the character,
 * shown small at the bottom of the name box. Nothing is stored; it follows the actor's ownership.
 */
const CSS = `/* "Played by" line inside the PC sheet's name box (played-by.mjs) */
.black-flag.pc.sheet .sheet-header .tsv-name-box { flex: 1 0 50%; position: relative; display: flex; min-width: 0; }
.black-flag.pc.sheet .sheet-header .tsv-name-box > .document-name { flex: 1 1 auto; min-width: 0; }
.black-flag.pc.sheet .tsv-played-by {
  position: absolute; left: 0; right: 0; bottom: 4px; text-align: center;
  font-family: var(--font-body, sans-serif); font-size: 11px; line-height: 1;
  color: var(--bf-text-color-blue); opacity: 0.8; pointer-events: none;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
`;
Hooks.once("init", () => { const s = document.createElement("style"); s.id = "tsv-played-by-css"; s.textContent = CSS; document.head.append(s); });

Hooks.on("renderPCSheet", (app, element) => {
  const root = element instanceof HTMLElement ? element : element?.[0];
  const nameEl = root?.querySelector(".sheet-header .document-name");
  const actor = app.document ?? app.actor;
  if (!nameEl || !actor) return;
  root.querySelectorAll(".tsv-played-by").forEach(n => n.remove());
  const players = game.users.filter(u => !u.isGM && actor.testUserPermission(u, "OWNER")).map(u => u.name);
  if (!players.length) return;
  let box = nameEl.parentElement;
  if (!box.classList.contains("tsv-name-box")) {
    box = document.createElement("div");
    box.className = "tsv-name-box";
    nameEl.replaceWith(box);
    box.append(nameEl);
  }
  const tag = document.createElement("span");
  tag.className = "tsv-played-by";
  tag.textContent = `Played by ${players.join(", ")}`;
  box.append(tag);
});
// a user's name changing, or a user being added, also changes the line
Hooks.on("updateUser", () => { for (const a of foundry.applications.instances.values()) if (a.constructor.name === "PCSheet" && a.rendered) a.render(); });
