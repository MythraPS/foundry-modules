/* 3D dice start off: a new account gets Dice So Nice's "Dice visibility" set to "Hide all".
 * Anyone can turn them on in Configure Settings > Dice So Nice > 3D Dice Settings. */
Hooks.on("createUser", async (user, options, userId) => {
  if (userId !== game.user.id || !game.modules.get("dice-so-nice")?.active) return;
  if (user.getFlag("dice-so-nice", "settings")?.visibility) return;
  await user.setFlag("dice-so-nice", "settings", { visibility: "none" });
});
