/**
 * Action Type Labels for Black Flag NPC stat blocks.
 *
 * Black Flag 3.0.078 renders stat-block abilities from
 * templates/actor/parts/stat-block-actions.hbs inside <blackFlag-actions>:
 *   div.features.passive  > div.feature > span.controls > a   (passive traits)
 *   div.features.<type>   > div.feature > span.controls > a   (type = action, bonus,
 *                                                              reaction, free, legendary,
 *                                                              lair, other)
 * The section class IS the activation type the system used to file the ability
 * (NPCSheet#_prepareActions), so the label always matches where it is listed.
 * Display only - no document is changed.
 */

const MODULE = "action-labels";
const TYPES = ["passive", "action", "bonus", "reaction", "free", "legendary", "lair", "other"];

Hooks.once("init", () => {
  game.settings.register(MODULE, "style", {
    name: "ACTLBL.Settings.Style.Name", hint: "ACTLBL.Settings.Style.Hint",
    scope: "client", config: true, type: String, default: "short",
    choices: { short: "ACTLBL.Settings.Style.Short", long: "ACTLBL.Settings.Style.Long", off: "ACTLBL.Settings.Style.Off" },
    onChange: () => { for (const app of foundry.applications.instances.values()) if (app.element?.querySelector?.("blackflag-actions")) app.render(); }
  });
});

function label(type, style) {
  const key = `ACTLBL.${style === "long" ? "Long" : "Short"}.${type}`;
  const text = game.i18n.localize(key);
  return text === key ? "" : text;
}

function decorate(root) {
  const style = game.settings.get(MODULE, "style");
  for (const section of root.querySelectorAll("blackflag-actions div.features")) {
    const type = TYPES.find(t => section.classList.contains(t));
    for (const link of section.querySelectorAll(":scope > div.feature > span.controls > a")) {
      link.parentElement.querySelector(":scope > .actlbl-tag")?.remove();
      if (style === "off" || !type) continue;
      const text = label(type, style);
      if (!text) continue;
      const tag = document.createElement("span");
      tag.className = `actlbl-tag actlbl-${type}`;
      tag.textContent = style === "long" ? `(${text})` : `[${text}]`;
      tag.dataset.tooltip = game.i18n.localize(`ACTLBL.Long.${type}`);
      link.after(tag);
    }
  }
}

Hooks.on("renderApplicationV2", (app, element) => {
  const root = element instanceof HTMLElement ? element : app.element;
  if (root?.querySelector?.("blackflag-actions")) decorate(root);
});

Hooks.once("ready", () => { game.modules.get(MODULE).api = { decorate }; });
