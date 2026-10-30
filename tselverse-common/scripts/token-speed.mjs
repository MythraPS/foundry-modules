/**
 * Token movement speed - how fast a moved token slides to its new place on everyone's screen.
 *
 * Foundry animates a move at CONFIG.Token.movement.defaultSpeed grid squares per second (6). Each
 * client animates on its own, so the GM's choice is a world setting read on every client. Instant
 * makes the slide take no time at all: the token snaps into place. Difficult terrain still slows
 * the slide the way Foundry does it (speed divided by the terrain's difficulty).
 */
const MODULE = "tselverse-common";
const SPEEDS = {normal: 6, fast: 18, veryFast: 36, instant: Number.MAX_VALUE};

const apply = value => { CONFIG.Token.movement.defaultSpeed = SPEEDS[value] ?? SPEEDS.normal; };

Hooks.once("init", () => {
  game.settings.register(MODULE, "tokenSpeed", {
    name: "Token movement speed",
    hint: "How fast tokens slide to where they were moved, for everyone. Instant snaps them into place.",
    scope: "world", config: true, type: String, default: "fast",
    choices: {normal: "Normal (Foundry's own)", fast: "Fast (3x)", veryFast: "Very fast (6x)", instant: "Instant (snap into place)"},
    onChange: apply
  });
});
Hooks.once("setup", () => apply(game.settings.get(MODULE, "tokenSpeed")));
