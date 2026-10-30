/**
 * Easier Foundry for players (2026-10-23, "I want Foundry to be easy and foolproof to use").
 * Players only — the GM's screen is unchanged. Switch off in Configure Settings > Tselverse Common.
 *  - hides the sidebar tabs players never use: Cards, Macros, Roll Tables
 *  - never shows MapForge's "Welcome to MapForge! Let's Create!" pop-up (a GM map tool) to players
 */
const MODULE = "tselverse-common";
const HIDE_TABS = ["cards", "macros", "tables"];

Hooks.once("init", () => {
  game.settings.register(MODULE, "simplePlayerUI", {
    name: "Simpler screen for players",
    hint: "Players don't see the Cards, Macros and Roll Tables tabs, or MapForge's welcome pop-up. Your own screen is unchanged.",
    scope: "world", config: true, type: Boolean, default: true,
    onChange: () => apply(),
  });
});

function apply() {
  const on = !game.user.isGM && game.settings.get(MODULE, "simplePlayerUI");
  document.body.classList.toggle("tsv-simple-player", on);
}

Hooks.once("setup", () => {
  if (game.user.isGM || !game.settings.get(MODULE, "simplePlayerUI")) return;
  // MapForge shows its welcome once per version per browser; mark this version as already seen.
  const mf = game.modules.get("mapforge");
  if (mf?.active && game.settings.settings.has("mapforge.welcomeMessageSeen")) {
    game.settings.set("mapforge", "welcomeMessageSeen", mf.version).catch(() => {});
  }
});

Hooks.once("ready", () => {
  const css = HIDE_TABS.map(t => `body.tsv-simple-player #sidebar [data-tab="${t}"]`).join(",\n") + " { display: none !important; }";
  const style = document.createElement("style");
  style.id = "tsv-simple-player-style";
  style.textContent = css;
  document.head.append(style);
  apply();
});
