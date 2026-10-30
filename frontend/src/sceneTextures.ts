import * as THREE from "three";

// Small procedural textures for the 3D campus. React Native has no 2D canvas, so each
// texture is painted straight into an RGBA pixel buffer and uploaded as a DataTexture.

type Painter = { width: number; height: number; data: Uint8Array };
type RGB = [number, number, number];

function rgb(hex: string): RGB {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function painter(width: number, height: number): Painter {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

function dot(p: Painter, x: number, y: number, colour: RGB, alpha = 1) {
  if (x < 0 || y < 0 || x >= p.width || y >= p.height) return;
  const i = (y * p.width + x) * 4;
  p.data[i] = p.data[i] * (1 - alpha) + colour[0] * alpha;
  p.data[i + 1] = p.data[i + 1] * (1 - alpha) + colour[1] * alpha;
  p.data[i + 2] = p.data[i + 2] * (1 - alpha) + colour[2] * alpha;
  p.data[i + 3] = 255;
}

function fillRect(p: Painter, x: number, y: number, w: number, h: number, colour: RGB, alpha = 1) {
  for (let row = Math.round(y); row < Math.round(y + h); row++)
    for (let col = Math.round(x); col < Math.round(x + w); col++) dot(p, col, row, colour, alpha);
}

function strokeRect(p: Painter, x: number, y: number, w: number, h: number, line: number, colour: RGB) {
  fillRect(p, x, y, w, line, colour);
  fillRect(p, x, y + h - line, w, line, colour);
  fillRect(p, x, y, line, h, colour);
  fillRect(p, x + w - line, y, line, h, colour);
}

// Fills every pixel whose distance from the centre is between `inner` and `outer`.
function ring(p: Painter, cx: number, cy: number, inner: number, outer: number, colour: RGB, alpha = 1) {
  for (let y = Math.floor(cy - outer); y <= Math.ceil(cy + outer); y++)
    for (let x = Math.floor(cx - outer); x <= Math.ceil(cx + outer); x++) {
      const distance = Math.hypot(x - cx, y - cy);
      if (distance >= inner && distance <= outer) dot(p, x, y, colour, alpha);
    }
}

function toTexture(p: Painter, repeat = false): THREE.DataTexture {
  const texture = new THREE.DataTexture(p.data, p.width, p.height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

const white = rgb("#FFFFFF");

// A striped football pitch with touchlines, halfway line, centre circle and boxes.
export function pitchTexture(length: number, width: number): THREE.DataTexture {
  const W = 256;
  const H = Math.max(64, Math.round((W * width) / length));
  const p = painter(W, H);
  const stripes = 12;
  for (let i = 0; i < stripes; i++)
    fillRect(p, (i * W) / stripes, 0, W / stripes + 1, H, rgb(i % 2 ? "#3E8C50" : "#357F46"));
  const line = 2;
  const m = W * 0.045;
  strokeRect(p, m, m, W - 2 * m, H - 2 * m, line, white);
  fillRect(p, W / 2 - line / 2, m, line, H - 2 * m, white);
  ring(p, W / 2, H / 2, H * 0.16 - line, H * 0.16, white);
  const boxW = W * 0.13;
  const boxH = H * 0.52;
  strokeRect(p, m, (H - boxH) / 2, boxW, boxH, line, white);
  strokeRect(p, W - m - boxW, (H - boxH) / 2, boxW, boxH, line, white);
  const sixW = W * 0.05;
  const sixH = H * 0.26;
  strokeRect(p, m, (H - sixH) / 2, sixW, sixH, line, white);
  strokeRect(p, W - m - sixW, (H - sixH) / 2, sixW, sixH, line, white);
  return toTexture(p);
}

// A mown cricket oval: concentric bands, the 30-yard circle, the rope and the pitch strip.
export function cricketTexture(): THREE.DataTexture {
  const S = 256;
  const p = painter(S, S);
  fillRect(p, 0, 0, S, S, rgb("#357F46"));
  for (let i = 10; i > 0; i--) ring(p, S / 2, S / 2, 0, ((S / 2) * i) / 10, rgb(i % 2 ? "#3E8C50" : "#367F47"));
  ring(p, S / 2, S / 2, S * 0.3 - 1.5, S * 0.3, white, 0.7);
  ring(p, S / 2, S / 2, S * 0.475 - 2.5, S * 0.475, white, 0.9);
  fillRect(p, S / 2 - 8, S / 2 - 35, 16, 70, rgb("#CDB88C"));
  fillRect(p, S / 2 - 11, S / 2 - 29, 22, 1, white);
  fillRect(p, S / 2 - 11, S / 2 + 29, 22, 1, white);
  return toTexture(p);
}

// A hard court in one colour with an outline and a centre line.
export function courtTexture(colour: string): THREE.DataTexture {
  const W = 128;
  const H = 64;
  const p = painter(W, H);
  fillRect(p, 0, 0, W, H, rgb(colour));
  strokeRect(p, 6, 6, W - 12, H - 12, 2, white);
  fillRect(p, W / 2 - 1, 6, 2, H - 12, white);
  return toTexture(p);
}

// A padel court's blue artificial turf, 20 by 10 metres: a fine grain, the two service
// lines 6.95 m either side of the net and the centre service line between them.
export function padelTurfTexture(): THREE.DataTexture {
  const W = 256;
  const H = 128;
  const p = painter(W, H);
  fillRect(p, 0, 0, W, H, rgb("#2167C8"));
  let seed = 5;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 2600; i++) dot(p, Math.floor(random() * W), Math.floor(random() * H), rgb("#3B82E0"), 0.5);
  const metre = W / 20;
  const serviceLine = Math.round((10 - 6.95) * metre);
  fillRect(p, serviceLine - 1, 0, 3, H, white);
  fillRect(p, W - serviceLine - 2, 0, 3, H, white);
  fillRect(p, serviceLine, H / 2 - 1, W - serviceLine * 2, 3, white);
  return toTexture(p);
}

// House walls for the DHA level: two floors of three windows on a pale render. The lit
// version is the emissive map, so some windows glow after dark.
export function houseTextures(): { wall: THREE.DataTexture; lit: THREE.DataTexture } {
  const W = 48;
  const H = 32;
  const wall = painter(W, H);
  const lit = painter(W, H);
  fillRect(wall, 0, 0, W, H, rgb("#F4F0E8"));
  fillRect(lit, 0, 0, W, H, rgb("#000000"));
  // A darker plinth at the foot of the wall.
  fillRect(wall, 0, H - 3, W, 3, rgb("#C9C2B6"));
  for (let row = 0; row < 2; row++)
    for (let col = 0; col < 3; col++) {
      const x = 5 + col * 15;
      const y = 4 + row * 13;
      fillRect(wall, x, y, 8, 7, rgb("#5C6970"));
      if ((row + col) % 2 === 0) fillRect(lit, x, y, 8, 7, rgb("#FFFFFF"));
    }
  return { wall: toTexture(wall), lit: toTexture(lit) };
}

// Building walls: three floors of windows. The lit version is used as an emissive map,
// so the same windows glow after dark.
export function wallTextures(): { wall: THREE.DataTexture; lit: THREE.DataTexture } {
  const W = 64;
  const H = 32;
  const wall = painter(W, H);
  const lit = painter(W, H);
  fillRect(wall, 0, 0, W, H, rgb("#E9E5DB"));
  fillRect(lit, 0, 0, W, H, rgb("#000000"));
  let seed = 11;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 8; col++) {
      const x = 2 + col * 8;
      const y = 3 + row * 10;
      fillRect(wall, x, y, 4, 5, rgb("#8C948D"));
      if (random() < 0.55) fillRect(lit, x, y, 4, 5, white);
    }
  return { wall: toTexture(wall, true), lit: toTexture(lit, true) };
}

// A fluorescent yellow padel ball with its curved white seam, the padel pin.
export function padelBallTexture(): THREE.DataTexture {
  const W = 128;
  const H = 64;
  const p = painter(W, H);
  fillRect(p, 0, 0, W, H, rgb("#D8E43A"));
  // The seam wraps around the ball as one wave, twice across the width.
  for (let x = 0; x < W; x++) {
    const y = Math.round(H / 2 + Math.sin((x / W) * Math.PI * 4) * H * 0.28);
    for (let thickness = -2; thickness <= 2; thickness++) dot(p, x, y + thickness, rgb("#F7F7EE"));
  }
  return toTexture(p);
}

// A red taped tennis ball, the tape-ball cricket pin.
export function tapeBallTexture(): THREE.DataTexture {
  const W = 128;
  const H = 64;
  const p = painter(W, H);
  fillRect(p, 0, 0, W, H, rgb("#D8302B"));
  for (let i = -8; i < 16; i++)
    for (let y = 0; y < H; y++) dot(p, Math.round(i * 11 + y * 0.45), y, rgb("#000000"), 0.18);
  fillRect(p, 0, H * 0.46, W, H * 0.1, rgb("#F1C232"));
  return toTexture(p);
}
