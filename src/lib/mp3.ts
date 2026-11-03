/**
 * Hur lång är en mp3? Ren logik, utan beroenden — körs i servern och i proven.
 *
 * ===========================================================================
 * SERVERN MÄTER, INTE WEBBLÄSAREN (0280)
 *
 * Ett uppladdat säljsamtal ska klara samma krav som ett från Lynes: minst fem
 * minuter. Webbläsaren kan läsa längden ur ljudet, men en längd som klienten
 * uppger är en uppgift från den som vill få igenom ordern. Servern läser
 * därför filen själv, i samma nedladdning som ger kontrollsumman
 * (`registreraFil`).
 *
 * Ramarna räknas en och en: varje ram bär sin egen bithastighet, så samma
 * räkning gäller fast och rörlig bithastighet. Har första ramen ett Xing-,
 * Info- eller VBRI-huvud står antalet ramar där, och då räcker det.
 *
 * Bara MPEG lager III — det är mp3. Allt annat ger null, och den som laddar
 * upp får veta att filen inte är en mp3.
 * ===========================================================================
 */

type Ram = { langd: number; sekunder: number; version: number; mono: boolean };

const BITAR_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITAR_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const FREKVENS: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** Ramhuvudet på position `i`, eller null om där inte börjar en lager III-ram. */
function ram(b: Uint8Array, i: number): Ram | null {
  if (i + 4 > b.length || b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null;
  const version = (b[i + 1] >> 3) & 3; // 3 = MPEG 1, 2 = MPEG 2, 0 = MPEG 2.5
  const lager = (b[i + 1] >> 1) & 3; // 1 = lager III
  const bitIndex = b[i + 2] >> 4;
  const frekIndex = (b[i + 2] >> 2) & 3;
  if (version === 1 || lager !== 1 || bitIndex === 0 || bitIndex === 15 || frekIndex === 3) return null;
  const kbit = (version === 3 ? BITAR_V1 : BITAR_V2)[bitIndex];
  const frekvens = FREKVENS[version][frekIndex];
  const prover = version === 3 ? 1152 : 576;
  const utfyllnad = (b[i + 2] >> 1) & 1;
  const langd = Math.floor(((prover / 8) * kbit * 1000) / frekvens) + utfyllnad;
  return { langd, sekunder: prover / frekvens, version, mono: (b[i + 3] >> 6) === 3 };
}

/** En ram som följs av en ram till (eller av filens slut) — skräp som råkar likna ett huvud gör sällan det. */
function kedjad(b: Uint8Array, i: number): Ram | null {
  const r = ram(b, i);
  if (!r) return null;
  const nasta = i + r.langd;
  return nasta >= b.length - 4 || ram(b, nasta) ? r : null;
}

function uint32(b: Uint8Array, i: number): number {
  return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
}

function tagg(b: Uint8Array, i: number, t: string): boolean {
  if (i + t.length > b.length) return false;
  for (let k = 0; k < t.length; k++) if (b[i + k] !== t.charCodeAt(k)) return false;
  return true;
}

/** Antalet ramar ur ett Xing/Info- eller VBRI-huvud i första ramen, eller null. */
function ramarIHuvudet(b: Uint8Array, i: number, r: Ram): number | null {
  const sidinfo = r.version === 3 ? (r.mono ? 17 : 32) : r.mono ? 9 : 17;
  const x = i + 4 + sidinfo;
  if ((tagg(b, x, "Xing") || tagg(b, x, "Info")) && x + 12 <= b.length && (uint32(b, x + 4) & 1) === 1) {
    return uint32(b, x + 8) || null;
  }
  const v = i + 4 + 32;
  if (tagg(b, v, "VBRI") && v + 18 <= b.length) return uint32(b, v + 14) || null;
  return null;
}

/** Längden i sekunder, eller null om filen inte innehåller mp3-ljud. */
export function mp3Sekunder(b: Uint8Array): number | null {
  let i = 0;

  // ID3v2 först, ibland flera efter varandra. Storleken är "syncsafe": sju bitar per byte.
  while (tagg(b, i, "ID3") && i + 10 <= b.length) {
    const storlek = ((b[i + 6] & 0x7f) << 21) | ((b[i + 7] & 0x7f) << 14) | ((b[i + 8] & 0x7f) << 7) | (b[i + 9] & 0x7f);
    i += 10 + storlek + (b[i + 5] & 0x10 ? 10 : 0);
  }

  while (i < b.length && !kedjad(b, i)) i++;
  const forsta = kedjad(b, i);
  if (!forsta) return null;

  const iHuvudet = ramarIHuvudet(b, i, forsta);
  if (iHuvudet) return iHuvudet * forsta.sekunder;

  let sekunder = 0;
  let ramar = 0;
  while (i < b.length) {
    const r = ram(b, i);
    if (r) {
      sekunder += r.sekunder;
      ramar++;
      i += r.langd;
      continue;
    }
    // Ett avbrott (en tagg på slutet, ett trasigt parti): leta fram nästa kedjade ram.
    i++;
    while (i < b.length && !kedjad(b, i)) i++;
  }
  return ramar > 0 ? sekunder : null;
}
