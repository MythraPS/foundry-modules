/* The Texture Browser's "Asset Grid Size" starts at 140 px, Czepeku's square size, so a ship map dragged onto a
 * scene comes out at the scene's grid without resizing it. Foundry keeps whatever you type there only until a
 * reload; this puts 140 back after each one (change the box for other makers' maps as usual). */
const CZEPEKU_SQUARE = 140;
Hooks.once("ready", () => {
  for (const cls of [foundry.applications.apps.FilePicker, foundry.applications.apps.FilePicker.implementation]) {
    if (cls && !cls.LAST_TILE_SIZE) cls.LAST_TILE_SIZE = CZEPEKU_SQUARE;
  }
});
