/**
 * Nav 2.0: vilken notis en push i telefonen visar (`kalPushNasta` i kalender-push.ts).
 *
 * Pushen kommer tom, och enheten frågar efteråt vad den gällde. Svaret tas ur
 * enhetens kö: de pushbara notiserna efter enhetens markör, en per push.
 *
 * 2026-11-03 i Zens Samsung visade telefonen fyra notiser från eftermiddagen i
 * stället för de nya. En skur som kommer på en gång kunde bli en enda notis,
 * eftersom alla hämtningar läste samma markör och svarade med samma notis, och
 * kön som blev kvar visades sedan, en i taget, före det som just hänt. Två
 * regler nu:
 *
 *   - EN PUSH, EN NOTIS. Markören flyttas bara om den står kvar där hämtningen
 *     läste den, och den som förlorar tar nästa (`kalPushNasta`).
 *   - DET NYA GÅR FÖRE DET SOM BLEV KVAR. Bara notiser från samma skur som den
 *     nyaste visas, i den ordning de kom. Det som är äldre hoppas över i
 *     telefonen och finns kvar i klockan.
 *
 * Ren, utan databas: tests/pushko.mjs.
 */

/** Notiser inom så här lång tid före den nyaste hör till samma skur. */
export const SKUR_MS = 10 * 60_000;

/**
 * Notisen som pushen ska visa: den äldsta efter markören i den nyaste skuren,
 * eller null när inget finns efter markören. Kön får komma i vilken ordning som helst.
 */
export function nastaIKon<T extends { id: number; created_at: string }>(ko: readonly T[], markor: number): T | null {
  const kvar = ko.filter((n) => n.id > markor);
  if (!kvar.length) return null;
  const golv = Math.max(...kvar.map((n) => Date.parse(n.created_at))) - SKUR_MS;
  return kvar.filter((n) => Date.parse(n.created_at) >= golv).reduce((a, b) => (b.id < a.id ? b : a));
}
