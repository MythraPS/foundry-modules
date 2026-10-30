import "./fixart.mjs";   // Fix Pictures: right-click / token HUD -> foundry-import picture choices, swapped in live
// Matching Portrait & Token.
//
// Portrait -> token: when an actor has a portrait but its token is still a default picture (Black
// Flag's "systems/black-flag/artwork/types/pc.svg" silhouette, Foundry's mystery man), a token is
// MADE from the portrait: the face is found (face-api's SSD MobileNet detector, bundled in lib/ and
// models/), a square around it is cut out, saved as a new image in assets/tokens/, and set as the
// token - on the actor and on its tokens already placed in scenes. No face found: the top of the
// picture, where a head usually is. The GM's browser does this (players can't upload files by
// default), for changes made while the GM is connected and, when the GM loads the world, for any
// actor still waiting. Anyone can then change the token as usual; a chosen token is never replaced.
//
// Token -> portrait: a new token image on an actor whose portrait is still a default picture is
// also used as the portrait, straight away.

const MOD = "tselverse-portraits";
const TOKEN = "prototypeToken.texture.src";
const FOLDER = "assets/tokens";
const SIZE = 400;                      // the made token's width and height, in pixels

const get = foundry.utils.getProperty, set = foundry.utils.setProperty;

function isDefault(src) {
  if (!src) return true;
  const p = decodeURIComponent(String(src)).replace(/^\/+/, "");
  return p === CONST.DEFAULT_TOKEN || p === "icons/svg/mystery-man.svg"
    || /^systems\/[^/]+\/artwork\/types\/[^/]+\.(svg|webp|png)$/.test(p);
}

/** Has a portrait, but no token of its own yet (a default one, or the portrait itself). A "portrait"
 *  that is already token art (Black Flag's framed discs in artwork/tokens/, foundry-import's) is used
 *  as it is: cutting a square out of it cut through its round frame (Deva, Solar..., 2026-10-03). */
const isTokenArt = src => /\/tokens\//.test(decodeURIComponent(String(src ?? "")));
const waiting = actor => !isDefault(actor.img) && !isTokenArt(actor.img) && (isDefault(get(actor, TOKEN)) || get(actor, TOKEN) === actor.img);
const iAmTheGM = () => !!game.users.activeGM?.isSelf;

// ------------------------------------------------------------------ making a token
let faceapi = null;
async function detector() {
  if (!faceapi) {
    const fa = await import(foundry.utils.getRoute(`modules/${MOD}/lib/face-api.esm.js`));
    await fa.nets.ssdMobilenetv1.loadFromUri(foundry.utils.getRoute(`modules/${MOD}/models`));
    faceapi = fa;
  }
  return faceapi;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${src}`));
    img.src = src;
  });
}

/** The square to cut: around the most certain face with room for hair and chin (2.2 times its
 *  size, lifted a little), or the top of the picture when there is none. Tried on 12 painted
 *  portraits: every face found was a face, and the squares framed them. */
function square(W, H, faces) {
  if (faces.length) {
    const b = faces.reduce((a, f) => (f.score > a.score ? f : a)).box;
    const side = Math.min(Math.max(b.width, b.height) * 2.2, W, H);
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2 - 0.08 * side;
    return {x: Math.min(Math.max(cx - side / 2, 0), W - side), y: Math.min(Math.max(cy - side / 2, 0), H - side), side};
  }
  const side = Math.min(W, H);
  return {x: (W - side) / 2, y: 0, side};
}

async function makeToken(actor) {
  const img = await loadImage(actor.img);
  const W = img.naturalWidth, H = img.naturalHeight;
  let faces = [];
  try {
    const fa = await detector();
    faces = await fa.detectAllFaces(img, new fa.SsdMobilenetv1Options({minConfidence: 0.2}));
  } catch (err) {
    console.warn(`${MOD} | face detection failed, using the top of the picture`, err);
  }
  const s = square(W, H, faces);
  // a disc with clear corners, inset like foundry-import's token art (316 of 512) so it sits inside
  // Foundry's dynamic ring; with the ring off it is drawn larger to fill the square (TSVPORT_FILL)
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d"), d = SIZE / TSVPORT_FILL, o = (SIZE - d) / 2;
  ctx.beginPath(); ctx.arc(SIZE / 2, SIZE / 2, d / 2, 0, Math.PI * 2); ctx.clip();
  ctx.drawImage(img, s.x, s.y, s.side, s.side, o, o, d, d);
  const blob = await new Promise(r => canvas.toBlob(r, "image/webp", 0.9));
  // a new name each time, so a remade token is never shown from the browser's cache
  const name = `${actor.name.slugify({strict: true}) || "token"}-${actor.id}-${Date.now().toString(36)}-disc.webp`;   // -disc: drawn to fill when the ring is off
  const FP = foundry.applications.apps.FilePicker.implementation;
  try { await FP.createDirectory("data", FOLDER, {notify: false}); } catch { /* already there */ }
  const res = await FP.upload("data", FOLDER, new File([blob], name, {type: "image/webp"}), {}, {notify: false});
  if (!res?.path) throw new Error("the upload failed");
  const path = res.path;
  const old = get(actor, TOKEN);
  await actor.update({[TOKEN]: path, "prototypeToken.ring.enabled": true});
  // tokens already placed that still show the old default (or the whole portrait)
  for (const scene of game.scenes) {
    const updates = scene.tokens.filter(t => t.actorId === actor.id && (isDefault(t.texture.src) || t.texture.src === old || t.texture.src === actor.img))
      .map(t => ({_id: t.id, "texture.src": path, "ring.enabled": true}));
    if (updates.length) await scene.updateEmbeddedDocuments("Token", updates);
  }
  console.log(`${MOD} | ${actor.name}: token made from the portrait (${faces.length ? "face found" : "no face found - top of the picture"})`);
}

// one at a time, each actor once
const queued = new Set();
let chain = Promise.resolve();
function queue(actor) {
  if (queued.has(actor.id)) return;
  queued.add(actor.id);
  chain = chain.then(async () => {
    try { if (waiting(actor)) await makeToken(actor); }
    catch (err) { console.error(`${MOD} | ${actor.name}: no token made`, err); ui.notifications.warn(`Couldn't make a token for ${actor.name}: ${err.message}`); }
    finally { queued.delete(actor.id); }
  });
}

// ------------------------------------------------------------------ hooks
Hooks.on("updateActor", (actor, changes) => {
  if (iAmTheGM() && "img" in changes && waiting(actor)) queue(actor);
});
Hooks.on("createActor", actor => {
  if (iAmTheGM() && waiting(actor)) queue(actor);
});
Hooks.once("ready", () => {
  if (iAmTheGM()) for (const actor of game.actors) if (waiting(actor)) queue(actor);
});

// token -> portrait, in the same update, for anyone
Hooks.on("preUpdateActor", (actor, changes) => {
  const img = get(changes, "img"), tok = get(changes, TOKEN);
  if (tok && !isDefault(tok) && img === undefined && isDefault(actor.img)) set(changes, "img", tok);
});
Hooks.on("preCreateActor", (actor, data) => {
  const img = get(data, "img"), tok = get(data, TOKEN);
  if (tok && !isDefault(tok) && isDefault(img)) actor.updateSource({img: tok});
  // token rings on by default: a new actor's token starts with its ring, unless the data being
  // created says otherwise (a compendium creature keeps the setting it was made with)
  // (and not over a system's own framed token art - Black Flag's artwork/tokens/ discs carry a ring)
  const framed = /^systems\/[^/]+\/artwork\/tokens\//.test(decodeURIComponent(String(tok ?? "")).replace(/^\/+/, ""));
  if (get(data, "prototypeToken.ring.enabled") === undefined && !framed) actor.updateSource({"prototypeToken.ring.enabled": true});
});

// for remaking a token by hand: game.modules.get("tselverse-portraits").api.makeToken(actor)
Hooks.once("ready", () => { game.modules.get(MOD).api = {makeToken}; });

/* Tokens made by foundry-import (and portrait tokens made here, named *-disc.webp) fill their square.
 * Its token art is a disc inset to 316 of 512 px, leaving room for Foundry's dynamic ring. With
 * the ring switched on that is right; with it off (most placed tokens - Air Jinnborn Pirate,
 * 2026-10-02) the disc sat small in the middle of its square next to a full-bleed PC token. When the
 * ring is off, the art is drawn 512/316 larger so the disc fills the square. Only the prepared
 * value changes - nothing is stored, so turning the ring on or off just works. */
const TSVPORT_FILL = 512 / 316;
Hooks.once("init", () => {
  const cls = CONFIG.Token?.documentClass;
  if (!cls?.prototype?.prepareData) return;
  const original = cls.prototype.prepareData;
  cls.prototype.prepareData = function (...args) {
    const r = original.apply(this, args);
    try {
      // One size rule for every token, ring or not (2026-10-19): Medium fills its square, Small is drawn at 80%
      // (Black Flag's own sizes[].dynamicTokenScale). Black Flag 3.0.078 means to do this for ringed tokens but
      // reads CONFIG.BlackFlag.actorSizes, which doesn't exist (it is .sizes), so it never happened.
      let size = this.baseActor?.system?.traits?.size;
      if (!this.actorLink) size = this.delta?.system?.traits?.size ?? size;
      const sizes = CONFIG.BlackFlag?.sizes ?? CONFIG.BlackFlag?.actorSizes ?? {};
      const bySize = sizes[size]?.dynamicTokenScale ?? 1;
      // our disc art is inset to 316 of 512 px for the ring: without the ring it is drawn larger to fill the square
      const src = this.texture?.src ?? "";
      const disc = !this.ring?.enabled && (src.includes("modules/tselverse-art/art/tokens/") || src.endsWith("-disc.webp"));
      // from the saved scale, not the prepared one: Foundry can prepare a token twice without resetting
      // it, and multiplying again made tokens (512/316)^2 = 2.6x too big (Angulotl Yegg, 2026-10-19)
      const k = (disc ? TSVPORT_FILL : 1) * bySize;
      if (k !== 1) {
        this.texture.scaleX = (this._source.texture?.scaleX ?? 1) * k;
        this.texture.scaleY = (this._source.texture?.scaleY ?? 1) * k;
      }
    } catch (err) { console.warn("tselverse-portraits | token fill", err); }
    return r;
  };
});
