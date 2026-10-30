/**
 * Stairs ask only when you stop on them.
 *
 * Foundry's "Change Level" stairs ask "move up / move down?" as soon as a token's middle passes over them,
 * and pause the move there, even when the token is only walking past. Here the question is skipped when the
 * move goes on and ends off the stairs. A move that ends on the stairs asks as before.
 */
Hooks.once("setup", () => {
  const type = CONFIG.RegionBehavior?.dataModels?.changeLevel;
  const key = CONST.REGION_EVENTS?.TOKEN_MOVE_IN;
  const original = type?.events?.[key];
  if (!original) return console.warn("tselverse-common | stairs-stop: Foundry's Change Level behavior not found");
  type.events[key] = async function (event) {
    try {
      // mid-move, "destination" is where Foundry paused; where the move is headed is the last pending waypoint
      const movement = event.data?.movement, token = event.data?.token, end = movement?.pending?.waypoints?.at(-1);
      if (end && token?.getMovementOrigin) {
        const point = token.getMovementOrigin(end);
        if (!this.region.polygonTree.testPoint(point, -0.75)) return;   // just passing through
      }
    } catch (err) { console.warn("tselverse-common | stairs-stop:", err); }
    return original.call(this, event);
  };
});
