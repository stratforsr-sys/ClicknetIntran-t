/**
 * Kompositionernas kurvor och små räknare, exakt som i den godkända prototypen
 * (v5, `mall.html`). Ren logik, så att provet kan jämföra bildruta för bildruta.
 *
 * `ip` är prototypens interpolate: den klämmer i ändarna, och en lista med
 * kurvor ger en kurva per delintervall. `fjader` är Remotions spring() med
 * prototypens argument (damping, stiffness, mass, delay i bildrutor).
 */

import { Easing, FPS, interpolate, spring, type EasingFunction } from "./matte.ts";

/** Inträden: snabb start, mjuk landning. */
export const UT = Easing.bezier(0.16, 1, 0.3, 1);
/** Standard på skärmen. */
export const STD = Easing.bezier(0.2, 0, 0, 1);
/** Helskärmssvep. */
export const SVEP = Easing.bezier(0.76, 0, 0.24, 1);
/** Den stora affärens rader som andas in strax före smällen. */
export const ANDAS = Easing.bezier(0.5, 0, 0.75, 0);
/** Säkringen under beloppet, som fylls allt fortare mot smällen. */
export const SAKRING = Easing.bezier(0.55, 0, 1, 0.45);

const KLAMP = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Prototypens interpolate: klämd i ändarna, en kurva eller en per delintervall. */
export function ip(f: number, inn: readonly number[], ut: readonly number[], easing?: EasingFunction | readonly EasingFunction[]): number {
  if (!Array.isArray(easing)) return interpolate(f, inn, ut, { ...KLAMP, easing: easing as EasingFunction | undefined });
  if (f <= inn[0]) return ut[0];
  if (f >= inn[inn.length - 1]) return ut[ut.length - 1];
  let i = 0;
  while (f > inn[i + 1]) i++;
  return interpolate(f, [inn[i], inn[i + 1]], [ut[i], ut[i + 1]], { ...KLAMP, easing: easing[i] });
}

/** En fjäder från 0 mot 1, som prototypens spring({frame, delay, damping, stiffness, mass}). */
export function fjader(frame: number, delay: number, damping = 10, stiffness = 100, mass = 1): number {
  return spring({ frame, fps: FPS, delay, config: { damping, stiffness, mass } });
}

export const mix = (a: number, b: number, p: number): number => a + (b - a) * p;

/** En skala som blandas perceptuellt: lika stora steg i log. */
export const skalaMix = (a: number, b: number, p: number): number => Math.exp(mix(Math.log(a), Math.log(b), p));

/** Två färger "#rrggbb" blandade, som "rgb(r,g,b)". */
export function farg(a: string, b: string, p: number): string {
  const h = (x: string) => [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16));
  const [x, y] = [h(a), h(b)];
  return `rgb(${x.map((v, i) => Math.round(mix(v, y[i], p))).join(",")})`;
}
