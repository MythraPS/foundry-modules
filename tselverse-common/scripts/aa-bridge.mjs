/**
 * Automated Animations for Black Flag.
 *
 * Automated Animations finds the used item in a chat card's flags or data attributes, and Black Flag's activation
 * cards keep it somewhere else (flags["black-flag"].item.uuid), so using an attack or spell played nothing. This
 * hands each activation card's item, token and targets to Automated Animations directly. Only the person who used
 * the item starts it; Sequencer shows it to everyone.
 */
const MODULE = "tselverse-common";

Hooks.once("init", () => {
  game.settings.register(MODULE, "aaBridge", {
    name: "Animations for Black Flag items",
    hint: "Play Automated Animations when an attack, spell or feature is used. Automated Animations can't find the item on Black Flag's chat cards by itself.",
    scope: "world", config: true, type: Boolean, default: true
  });
});

function tokenFor(msg) {
  if (msg.speaker?.scene && msg.speaker.scene !== canvas.scene?.id) return null;
  const byId = msg.speaker?.token ? canvas.tokens?.get(msg.speaker.token) : null;
  if (byId) return byId;
  const actor = msg.speaker?.actor ? game.actors.get(msg.speaker.actor) : null;
  return actor?.getActiveTokens?.(true)?.[0] ?? null;
}

Hooks.on("createChatMessage", async (msg, _options, userId) => {
  try {
    if (userId !== game.user.id || msg.type !== "activation") return;
    if (!game.settings.get(MODULE, "aaBridge")) return;
    if (!game.modules.get("autoanimations")?.active || typeof globalThis.AutomatedAnimations?.playAnimation !== "function") return;
    const flags = msg.flags?.["black-flag"];
    if (!flags?.item?.uuid || !canvas?.ready) return;
    const token = tokenFor(msg);
    if (!token) return;
    const item = await fromUuid(flags.item.uuid);
    if (!item) return;
    // a target's uuid is its token actor's ("Scene.x.Token.y.Actor.z"); the token is everything before ".Actor."
    let targets = (flags.targets ?? []).map(t => {
      const tokenUuid = t?.uuid?.split(".Actor.")[0];
      return tokenUuid ? fromUuidSync(tokenUuid)?.object : null;
    }).filter(Boolean);
    if (!targets.length) targets = Array.from(game.user.targets);
    await AutomatedAnimations.playAnimation(token, item, { targets });
  } catch (err) {
    console.warn("tselverse-common | Automated Animations bridge:", err);
  }
});
