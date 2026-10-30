/* Players' image picker starts in "player-uploads". Foundry won't upload into the top folder,
 * and a new character's default picture opens the picker there, so the upload button was greyed out. */
Hooks.once("ready", () => {
  if (game.user.isGM) return;
  const FP = foundry.applications.apps.FilePicker;
  for (const C of new Set([FP, FP.implementation])) if (!C.LAST_BROWSED_DIRECTORY) C.LAST_BROWSED_DIRECTORY = "player-uploads";
});
