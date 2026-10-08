/**
 * Facing Arrow
 *
 * Two Foundry settings are easy to confuse, and the split is what makes this work:
 *
 *   core "tokenAutoRotate"  (world, default true)
 *       On a drag/keyboard move, writes the movement direction into
 *       TokenDocument#rotation:
 *           rotation = toDegrees(ray.angle) - 90        (token.mjs #rotateInMovementDirection)
 *
 *   TokenDocument#lockRotation  (per token)
 *       Decides only whether the ARTWORK turns:
 *           this.mesh.angle = this.document.lockRotation ? 0 : this.document.rotation;
 *                                                          (token.mjs Token#_refreshRotation)
 *
 * So facing keeps being recorded even with the art locked. This module locks every
 * token's art and draws the recorded rotation as an arrow on the ring instead.
 *
 * The arrow direction is derived by inverting Foundry's own formula rather than
 * assuming which way token art "faces" at rotation 0:
 *
 *     rayAngle = rotation + 90        ->   (cos rayAngle, sin rayAngle)
 *
 * which is the actual movement vector in canvas coordinates (y grows downward).
 */

const ID = "tselverse-facing";
const ARROW = "__tsvFacingArrow";

const setting = k => game.settings.get(ID, k);

/* -------------------------------------------- */
/*  Settings                                    */
/* -------------------------------------------- */

Hooks.once("init", () => {
  game.settings.register(ID, "lockArt", {
    name: "TSVFACING.LockArtN", hint: "TSVFACING.LockArtL",
    scope: "world", config: true, default: true, type: Boolean,
    onChange: v => { if ( v && game.user.isGM ) lockAll(); }
  });
  game.settings.register(ID, "showArrow", {
    name: "TSVFACING.ShowArrowN", hint: "TSVFACING.ShowArrowL",
    scope: "world", config: true, default: true, type: Boolean,
    // Must redraw, not just refresh: drawArrow() creates nothing while the setting
    // is off, so a plain refresh could never bring the arrow back.
    onChange: () => canvas?.tokens?.placeables.forEach(t => { drawArrow(t); refreshArrow(t); })
  });
  game.settings.register(ID, "colorMode", {
    name: "TSVFACING.ColorModeN", hint: "TSVFACING.ColorModeL",
    scope: "world", config: true, default: "border", type: String,
    choices: {
      border: "TSVFACING.ColorModeBorder",
      artwork: "TSVFACING.ColorModeArtwork",
      custom: "TSVFACING.ColorModeCustom"
    },
    onChange: () => canvas?.tokens?.placeables.forEach(t => refreshArrow(t))
  });
  game.settings.register(ID, "color", {
    name: "TSVFACING.ColorN", hint: "TSVFACING.ColorL",
    scope: "world", config: true, default: "#ffd166", type: String,
    onChange: () => canvas?.tokens?.placeables.forEach(t => refreshArrow(t))
  });
  game.settings.register(ID, "size", {
    name: "TSVFACING.SizeN", hint: "TSVFACING.SizeL",
    scope: "world", config: true, default: 0.07, type: Number,
    range: { min: 0.03, max: 0.60, step: 0.01 },
    onChange: () => canvas?.tokens?.placeables.forEach(t => { drawArrow(t); refreshArrow(t); })
  });
  game.settings.register(ID, "placement", {
    name: "TSVFACING.PlacementN", hint: "TSVFACING.PlacementL",
    scope: "world", config: true, default: "square", type: String,
    choices: {
      artwork: "TSVFACING.PlacementArtwork",
      square:  "TSVFACING.PlacementSquare",
      fixed:   "TSVFACING.PlacementFixed"
    },
    onChange: () => canvas?.tokens?.placeables.forEach(t => refreshArrow(t))
  });
  game.settings.register(ID, "tipGap", {
    name: "TSVFACING.TipGapN", hint: "TSVFACING.TipGapL",
    scope: "world", config: true, default: 0.00, type: Number,
    range: { min: -0.50, max: 0.50, step: 0.01 },
    onChange: () => canvas?.tokens?.placeables.forEach(t => refreshArrow(t))
  });
  game.settings.register(ID, "margin", {
    name: "TSVFACING.MarginN", hint: "TSVFACING.MarginL",
    scope: "world", config: true, default: 0.00, type: Number,
    range: { min: 0.00, max: 0.50, step: 0.02 },
    onChange: () => canvas?.tokens?.placeables.forEach(t => refreshArrow(t))
  });
  game.settings.register(ID, "distance", {
    name: "TSVFACING.DistanceN", hint: "TSVFACING.DistanceL",
    scope: "world", config: true, default: 0.82, type: Number,
    range: { min: 0.30, max: 1.40, step: 0.02 },
    onChange: () => canvas?.tokens?.placeables.forEach(t => refreshArrow(t))
  });
  game.settings.register(ID, "migrated", {
    scope: "world", config: false, default: false, type: Boolean
  });
  game.settings.register(ID, "ownedOnly", {
    name: "TSVFACING.HostileOnlyN", hint: "TSVFACING.HostileOnlyL",
    scope: "world", config: true, default: false, type: Boolean,
    onChange: () => canvas?.tokens?.placeables.forEach(t => refreshArrow(t))
  });

  // Per-frame rotation. Token#_onAnimationUpdate receives the *animated* rotation
  // every frame, which is the only place the in-between values exist. Foundry's own
  // refreshRotation flag is gated on `!lockRotation` (token.mjs Token#_onUpdate), so
  // with the art locked no refresh fires on rotation at all -- hence this wrap
  // rather than a refreshToken hook.
  const proto = foundry.canvas.placeables.Token.prototype;
  const original = proto._onAnimationUpdate;
  proto._onAnimationUpdate = function(changed, context) {
    const r = original.call(this, changed, context);
    if ( "rotation" in changed ) refreshArrow(this, changed.rotation);
    return r;
  };
});

/* -------------------------------------------- */
/*  Keep the artwork upright                    */
/* -------------------------------------------- */

// New tokens: lock the art as they are created, so nothing has to be fixed later.
Hooks.on("preCreateToken", (doc, data, options, userId) => {
  if ( !setting("lockArt") ) return;
  if ( doc.lockRotation ) return;
  doc.updateSource({ lockRotation: true });
});

/* -------------------------------------------- */
/*  The arrow                                   */
/* -------------------------------------------- */

/** Half the token's on-canvas size, i.e. the radius of its square. */
function ringRadius(token) {
  return Math.min(token.w, token.h) / 2;
}

/**
 * How far the artwork actually reaches, as a fraction of the token's half-size.
 *
 * A single fixed distance cannot suit every token: art produced by
 * `foundry-import crop` is a disc inset to SUBJECT_FRAC (0.62) to leave ring room,
 * while Black Flag's own token art and most PC portraits fill the whole frame. At a
 * flat 0.82 the arrow sits just outside the first and buried inside the second.
 *
 * Measured as the largest max(|dx|,|dy|) over opaque pixels -- the alpha bounding
 * box -- NOT the radial distance, which would report ~1.41 for any full-frame art
 * because of its corners.
 *
 * Cached per texture path; the answer only depends on the image.
 * @param {Token} token
 * @returns {number|null} null when the texture is not readable yet
 */
const artExtentCache = new Map();

function artExtent(token) {
  const src = token.document?.texture?.src;
  if ( !src ) return null;
  if ( artExtentCache.has(src) ) return artExtentCache.get(src);

  const source = token.mesh?.texture?.baseTexture?.resource?.source;
  if ( !source ) return null;                       // not loaded yet - try again later

  try {
    const N = 64;                                   // plenty for a placement decision
    const c = document.createElement("canvas");
    c.width = c.height = N;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, N, N);
    const data = ctx.getImageData(0, 0, N, N).data;
    let extent = 0;
    for ( let y = 0; y < N; y++ ) {
      for ( let x = 0; x < N; x++ ) {
        if ( data[((y * N) + x) * 4 + 3] < 24 ) continue;
        const dx = Math.abs(((x + 0.5) / N) * 2 - 1);
        const dy = Math.abs(((y + 0.5) / N) * 2 - 1);
        const e = Math.max(dx, dy);
        if ( e > extent ) extent = e;
      }
    }
    if ( extent <= 0 ) return null;                 // fully transparent - ignore
    artExtentCache.set(src, extent);
    return extent;
  }
  catch { return null; }                            // tainted or unreadable canvas
}

/**
 * Average colour of the outer band of the artwork -- a token's baked-in ring.
 *
 * Many token packs (and Black Flag's own art) draw a coloured ring into the image
 * itself, which has nothing to do with disposition, so Token#_getBorderColor never
 * matches it. Sampling the band from `lo` to the artwork's edge does.
 *
 * NOTE this is opt-in, not automatic. I measured whether the band's variance could
 * tell "has a ring" from "plain art" and it cannot: Black Flag's rings score a
 * standard deviation near 50 (their band includes highlights and gaps) which is
 * HIGHER than several ringless tokens. Art with no ring therefore returns whatever
 * colour its silhouette happens to have at the edge, which is why the mode is a
 * choice rather than a guess.
 *
 * Cached per texture path.
 * @param {Token} token
 * @returns {number|null}
 */
const artColorCache = new Map();

function artEdgeColor(token) {
  const src = token.document?.texture?.src;
  if ( !src ) return null;
  if ( artColorCache.has(src) ) return artColorCache.get(src);

  const source = token.mesh?.texture?.baseTexture?.resource?.source;
  if ( !source ) return null;

  try {
    const N = 64;
    const c = document.createElement("canvas");
    c.width = c.height = N;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, N, N);
    const data = ctx.getImageData(0, 0, N, N).data;

    let extent = 0;
    const px = [];
    for ( let y = 0; y < N; y++ ) {
      for ( let x = 0; x < N; x++ ) {
        const i = ((y * N) + x) * 4;
        if ( data[i + 3] < 200 ) continue;
        const e = Math.max(Math.abs(((x + 0.5) / N) * 2 - 1),
                           Math.abs(((y + 0.5) / N) * 2 - 1));
        if ( e > extent ) extent = e;
        px.push([e, data[i], data[i + 1], data[i + 2]]);
      }
    }
    if ( !extent ) return null;

    const lo = extent * 0.88;
    let r = 0, g = 0, b = 0, n = 0;
    for ( const [e, pr, pg, pb] of px ) {
      if ( e < lo ) continue;
      r += pr; g += pg; b += pb; n++;
    }
    if ( n < 8 ) return null;
    const colour = (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n);
    artColorCache.set(src, colour);
    return colour;
  }
  catch { return null; }
}

/**
 * Distance from the token centre to the arrow's ORIGIN, in pixels.
 *
 * The arrow's rear points sit at local x = -0.35 * len, so anchoring the origin at
 * the artwork's edge leaves the whole shape floating outside it. Push the origin out
 * by that much so the BASE rests on the edge and the arrow reads as attached.
 * @param {Token} token
 * @returns {number}
 */
function arrowDistance(token) {
  const R = ringRadius(token);
  const len = R * setting("size");               // origin -> TIP of the arrow
  const baseOffset = len * 0.35;                 // origin -> rear of the arrow
  const mode = setting("placement");
  // The token's picture - and its ring - are drawn at the texture scale: a placed token at 0.9
  // (Felid Dragon, 2026-10-02) shows a smaller disc, and an arrow placed for the full square or
  // the full-size picture floats away from it.
  const scale = Math.abs(token.document?.texture?.scaleX ?? 1) || 1;
  // ...but never past the token's own square: an enlarged picture (tselverse-portraits draws its
  // inset ring-less tokens 1.62x so the disc fills the square) must not push the arrow outside it
  const boxScale = Math.min(scale, 1);

  // "square": position the arrow's POINT relative to the edge of the token's own
  // square, measured as if facing a cardinal direction -- the square's edge is R
  // from centre due north/east/south/west. tipGap 0 puts the point exactly on that
  // edge, positive pushes it outside, negative pulls it inside. On a diagonal the
  // corner is further away (R * sqrt2), which is why the setting is defined on the
  // cardinal axis: the arrow keeps a constant distance from centre at every angle
  // rather than tracking the square's outline.
  if ( mode === "square" ) return (R * boxScale * (1 + setting("tipGap"))) - len;

  if ( mode === "artwork" ) {
    const extent = artExtent(token);
    if ( extent !== null ) return (R * (extent * scale + setting("margin"))) + baseOffset;
  }
  return (R * boxScale * setting("distance")) + baseOffset;
}

function drawArrow(token) {
  if ( token[ARROW] ) {
    token.removeChild(token[ARROW]);
    token[ARROW].destroy();
    token[ARROW] = null;
  }
  if ( !setting("showArrow") ) return;

  const R = ringRadius(token);
  const len = R * setting("size");          // along the facing direction
  const half = len * 0.62;                  // half the base width

  // Drawn pointing along +X. The parent container is rotated to the facing angle,
  // so the shape itself never needs to know which way is "forward".
  const path = g => {
    g.moveTo(len, 0);
    g.lineTo(-len * 0.35, -half);
    g.lineTo(-len * 0.10, 0);
    g.lineTo(-len * 0.35, half);
    g.closePath();
  };

  // Fill is drawn WHITE and recoloured with .tint, so following the border colour
  // costs a tint assignment per refresh instead of rebuilding the geometry every
  // time the token is selected or its disposition changes.
  const fill = new PIXI.Graphics();
  fill.beginFill(0xffffff, 1);
  path(fill);
  fill.endFill();

  // Outline is a separate child so the tint above never touches it.
  //
  // Three things here all matter, and getting any of them wrong swallows the fill:
  //  - width scales with the ARROW (len), not the token radius. It used to be
  //    R * 0.03, which was proportionate at size 0.28 but left the stroke at full
  //    thickness when the arrow shrank to 0.07 -- so the outline ate the shape and
  //    only a small core still showed the colour.
  //  - alignment 1 is OUTER (PIXI: "0.5 = middle, 1 = outer, 0 = inner"), so the
  //    stroke grows away from the shape instead of inward over the fill.
  //  - added BEFORE the fill, so it renders underneath rather than on top.
  const outline = new PIXI.Graphics();
  outline.lineStyle({ width: Math.max(0.6, len * 0.18), color: 0x000000,
                      alpha: 0.6, alignment: 1 });
  path(outline);

  const wrap = new PIXI.Container();
  wrap.addChild(outline, fill);
  wrap.eventMode = "none";
  wrap.__fill = fill;
  token[ARROW] = wrap;
  token.addChild(wrap);
  return wrap;
}

/**
 * Arrow colour. "border" mirrors Token#_getBorderColor, which is the disposition
 * colour and switches to the CONTROLLED colour while selected -- so the arrow
 * matches whatever the border is showing at that moment.
 * @param {Token} token
 * @returns {number}
 */
function arrowColor(token) {
  // Per-token override beats every mode, for the odd token whose ring the sampler
  // reads wrongly or that wants calling out.
  const own = token.document.getFlag(ID, "color")
           ?? token.actor?.prototypeToken?.flags?.[ID]?.color;
  if ( own ) { try { return Number(Color.from(own)); } catch { /* fall through */ } }

  const mode = setting("colorMode");
  if ( mode === "custom" ) return Number(Color.from(setting("color")));
  if ( mode === "artwork" ) {
    const sampled = artEdgeColor(token);
    if ( sampled !== null ) return sampled;
  }
  try { return token._getBorderColor(); }
  catch { return Number(Color.from(setting("color"))); }
}

/**
 * Per-creature opt-out. Some things have no meaningful facing -- multiple heads,
 * amorphous blobs, swarms, spheres -- and an arrow on those is just noise.
 *
 * The token's own flag wins when it is set at all, so one placed token can differ
 * from its actor. Otherwise the actor's prototype decides, which is what makes the
 * setting stick for a whole monster rather than one copy of it.
 * @param {Token} token
 * @returns {boolean}
 */
function arrowSuppressed(token) {
  const own = token.document.getFlag(ID, "noArrow");
  if ( own !== undefined ) return !!own;
  return !!token.actor?.prototypeToken?.flags?.[ID]?.noArrow;
}

function arrowVisible(token) {
  if ( !setting("showArrow") ) return false;
  if ( !token.visible ) return false;
  if ( arrowSuppressed(token) ) return false;
  if ( setting("ownedOnly") && !token.document.testUserPermission(game.user, "OBSERVER") ) return false;
  return true;
}

/**
 * @param {Token} token
 * @param {number} [rotation]  Animated value when called mid-animation; falls back
 *                             to the document's committed rotation.
 */
function refreshArrow(token, rotation) {
  const wrap = token[ARROW];
  if ( !wrap || wrap.destroyed ) return;
  wrap.visible = arrowVisible(token);
  if ( !wrap.visible ) return;

  if ( wrap.__fill && !wrap.__fill.destroyed ) wrap.__fill.tint = arrowColor(token);

  const deg = rotation ?? token.document.rotation ?? 0;
  // Invert Foundry's own rotation formula (rotation = toDegrees(rayAngle) - 90)
  // to recover the movement vector, instead of assuming an art orientation.
  const rad = Math.toRadians(deg + 90);

  const dist = arrowDistance(token);
  wrap.position.set(token.w / 2 + Math.cos(rad) * dist,
                    token.h / 2 + Math.sin(rad) * dist);
  wrap.rotation = rad;
  // Sit below bars/nameplate/effects. NOT relative to token.mesh: that lives in
  // canvas.primary (Token#_draw does `this.mesh = canvas.primary.addToken(this)`),
  // so getChildIndex(token.mesh) would throw. The Token container already renders
  // above the primary mesh, so anywhere in here is above the artwork.
  const anchor = token.bars ?? token.effects ?? token.nameplate;
  if ( anchor && !anchor.destroyed ) {
    const want = Math.max(0, token.getChildIndex(anchor));
    if ( token.getChildIndex(wrap) !== want ) token.setChildIndex(wrap, want);
  }
}

Hooks.on("drawToken", token => { drawArrow(token); refreshArrow(token); });
Hooks.on("refreshToken", token => refreshArrow(token));
Hooks.on("destroyToken", token => {
  if ( token[ARROW] && !token[ARROW].destroyed ) token[ARROW].destroy();
  token[ARROW] = null;
});
Hooks.on("updateToken", (doc, changed) => {
  if ( !doc.object ) return;
  if ( "rotation" in changed ) return refreshArrow(doc.object, doc.rotation);
  if ( "disposition" in changed ) return refreshArrow(doc.object);
  if ( foundry.utils.hasProperty(changed, `flags.${ID}.noArrow`)
    || foundry.utils.hasProperty(changed, `flags.${ID}.color`) ) refreshArrow(doc.object);
});

// Selecting a token flips its border to the CONTROLLED colour; the arrow follows.
Hooks.on("controlToken", token => refreshArrow(token));

// Changing it on the actor's prototype has to reach tokens already on the canvas.
Hooks.on("updateActor", (actor, changed) => {
  if ( !foundry.utils.hasProperty(changed, `prototypeToken.flags.${ID}.noArrow`) ) return;
  for ( const t of actor.getActiveTokens() ) refreshArrow(t);
});


/* -------------------------------------------- */
/*  Locking what already exists                 */
/* -------------------------------------------- */

/**
 * Set lockRotation on every actor's prototype token and every token already placed.
 * preCreateToken only covers tokens made from here on, so anything already in the
 * world needs this once.
 * @returns {Promise<{actors: number, tokens: number}>}
 */
async function lockAll() {
  let actors = 0, tokens = 0;

  const actorUpdates = game.actors
    .filter(a => a.prototypeToken?.lockRotation === false)
    .map(a => ({ _id: a.id, "prototypeToken.lockRotation": true }));
  if ( actorUpdates.length ) {
    await Actor.updateDocuments(actorUpdates);
    actors = actorUpdates.length;
  }

  for ( const scene of game.scenes ) {
    const updates = scene.tokens
      .filter(t => t.lockRotation === false)
      .map(t => ({ _id: t.id, lockRotation: true }));
    if ( !updates.length ) continue;
    await scene.updateEmbeddedDocuments("Token", updates);
    tokens += updates.length;
  }

  ui.notifications?.info(`Facing Arrow: locked art on ${actors} actor(s) and ${tokens} placed token(s).`);
  return { actors, tokens };
}

Hooks.once("ready", async () => {
  game.modules.get(ID).api = { lockAll, drawArrow, refreshArrow };
  if ( !game.user.isGM || !setting("lockArt") ) return;
  // Run once per install; re-runnable by hand through the API.
  if ( game.settings.get(ID, "migrated") ) return;
  await lockAll();
  await game.settings.set(ID, "migrated", true);
});


/* -------------------------------------------- */
/*  Sheet control                               */
/* -------------------------------------------- */

/**
 * Add "No facing arrow" to the Appearance tab, directly under Lock Rotation.
 *
 * A plain `flags.<id>.<key>` input is enough: TokenApplicationMixin#_processFormData
 * runs expandObject over the whole form and _processChanges only rewrites specific
 * known keys, so unknown paths survive into the document update untouched.
 */
function injectNoArrowField(app, element) {
  if ( element.querySelector(`[name="flags.${ID}.noArrow"]`) ) return;
  const lock = element.querySelector('[name="lockRotation"]');
  const group = lock?.closest(".form-group");
  if ( !group ) return;                       // template changed - leave the sheet alone

  const doc = app.document ?? app.actor?.prototypeToken;
  const checked = !!doc?.getFlag?.(ID, "noArrow") || !!doc?.flags?.[ID]?.noArrow;

  const colour = doc?.getFlag?.(ID, "color") ?? doc?.flags?.[ID]?.color ?? "";

  const el = document.createElement("div");
  el.className = "form-group";
  el.innerHTML = `
    <label>${game.i18n.localize("TSVFACING.NoArrowN")}</label>
    <div class="form-fields">
      <input type="checkbox" name="flags.${ID}.noArrow" ${checked ? "checked" : ""}>
    </div>
    <p class="hint">${game.i18n.localize("TSVFACING.NoArrowL")}</p>`;
  group.after(el);

  const col = document.createElement("div");
  col.className = "form-group";
  col.innerHTML = `
    <label>${game.i18n.localize("TSVFACING.TokenColorN")}</label>
    <div class="form-fields">
      <input type="text" name="flags.${ID}.color" value="${colour}" placeholder="#rrggbb">
      <input type="color" value="${colour || "#ffd166"}" data-edit="flags.${ID}.color">
    </div>
    <p class="hint">${game.i18n.localize("TSVFACING.TokenColorL")}</p>`;
  // Keep the swatch and the text field in step; the text field is what submits.
  const text = col.querySelector('input[type="text"]');
  const swatch = col.querySelector('input[type="color"]');
  swatch.addEventListener("input", () => { text.value = swatch.value; });
  text.addEventListener("change", () => {
    if ( /^#[0-9a-f]{6}$/i.test(text.value) ) swatch.value = text.value;
  });
  el.after(col);
}

Hooks.on("renderTokenConfig", injectNoArrowField);
Hooks.on("renderPrototypeTokenConfig", injectNoArrowField);
