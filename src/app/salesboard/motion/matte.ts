/**
 * Rörelsemotorns matematik för Säljtavlan: `interpolate`, `Easing` och `spring`
 * med samma namn, argument och svar som Remotion, och de två beslut som
 * `Sequence` och `Spelare` i motor.tsx fattar (`sekvensFonster` och
 * `stegaSpelare`).
 *
 * Ren kod — ingen React, ingen import, inget `@/`. Samma linje som
 * `src/lib/saljtakt.ts`: filen ska gå att prova utan att starta Next. Se
 * `tests/salesboard-motor.mjs`. Reacts del är med flit tunn, och allt den
 * avgör kommer härifrån.
 *
 * ===========================================================================
 * VARFÖR EN EGEN MOTOR, OCH VAD SOM MÅSTE STÄMMA MED REMOTION
 *
 * Remotion kräver företagslicens för ett bolag med fler än tre anställda, och
 * Player i en webbapp räknas dit (spec §3). Rörelsen skrivs därför i Remotions
 * modell, med Remotions namn, men körs av den här lilla motorn. Köper bolaget
 * licensen byts importen mot `remotion` och kompositionerna ska fungera
 * oförändrade. Då räcker det inte att namnen stämmer: standardvärden, kantfall
 * och de fel som kastas ska följa Remotions dokumenterade beteende.
 *
 *   - `interpolate` extrapolerar med "extend" som standard, och easingen gäller
 *     också utanför intervallet. Den som glömmer clamp får samma panel som glider
 *     ut ur bild här som där.
 *   - `spring` har damping 10, mass 1, stiffness 100 och overshootClamping false.
 *   - `spring` räknar `zeta < 1 ? underdämpad : kritiskt dämpad`, med dämpkvoten
 *     ζ = damping / (2·√(stiffness·mass)). Remotion har lånat sina fjäderformler från
 *     Reanimated, och där finns ingen överdämpad form: en fjäder med ζ ≥ 1 är alltid
 *     den kritiska med ω₀ = √(stiffness/mass), vad `damping` än är. Därför är
 *     `{damping: 200}`, Remotions förinställning för "mjuk, ingen studs", framme på
 *     under en sekund vid standardstyvheten och exakt samma kurva som `{damping: 20}`.
 *     En fysiskt överdämpad fjäder med samma tal kryper (0,39 efter en sekund, 635
 *     bildrutor till ro) och skulle göra varje komposition seg efter importbytet.
 *     Mer dämpning än den kritiska ändrar alltså ingenting. Det är avsikten.
 *   - `durationInFrames` skalar tiden så att fjädern är inom 0,5 % av slutet
 *     vid just den bildrutan.
 *   - `Sequence` förskjuter bildrutan med `from`.
 *
 * Skillnader, alla medvetna:
 *
 *   - Fjädern räknas rakt till bildruta f med de slutna formlerna (se `kvar`).
 *     Remotion tar samma formler en bildruta i taget och kan avrunda i vila, så de
 *     små talen kan skilja sig någon tusendel. Det är inte mätt mot Remotion:
 *     koden finns inte här och licensen är inte köpt. Mät det vid bytet.
 *   - `Easing.bezier` utanför 0–1 följer CSS-specens tangentförlängning.
 *     Remotion dokumenterar inget för det fallet. Ändpunkterna är desamma, så en
 *     komposition som clampar märker ingenting. Förlita dig inte på det.
 *   - Bara det som tavlan använder finns: ingen `wrap`, ingen `reverse`, bara de
 *     easingfunktioner som kompositionerna behöver. Saknas något fångas det av
 *     typerna (och för extrapolering av en kontroll som kastar), så att det inte
 *     tyst beter sig annorlunda.
 * ===========================================================================
 */

/** Tavlans bildfrekvens och duk (spec §4–5). Allt rörligt är en funktion av bildrutan vid 60 per sekund. */
export const FPS = 60;
export const BREDD = 1920;
export const HOJD = 1080;

// -----------------------------------------------------------------------------
// Easing
// -----------------------------------------------------------------------------

export type EasingFunction = (t: number) => number;

const linear: EasingFunction = (t) => t;
const quad: EasingFunction = (t) => t * t;
const cubic: EasingFunction = (t) => t * t * t;
const sin: EasingFunction = (t) => 1 - Math.cos((t * Math.PI) / 2);
/**
 * 2^(10·(t-1)), som i Remotion och React Native. Observera att `exp(0)` därför
 * blir 2^-10 och inte noll — det är Remotions beteende, så det är också vårt.
 */
const exp: EasingFunction = (t) => Math.pow(2, 10 * (t - 1));

/**
 * `cubic-bezier(x1, y1, x2, y2)` som i CSS: kurvan går från (0,0) till (1,1)
 * med de två kontrollpunkterna, och easingen är y som funktion av x.
 *
 * Kurvan är parametrisk, så för ett givet x måste t först lösas ut ur
 * x(t) = x. x(t) stiger jämnt när x1 och x2 ligger i 0–1, vilket är skälet till
 * att de kontrolleras. Rotfinnaren är Newton–Raphson inom ett intervall som
 * hela tiden krymper. Ger Newton ett steg utanför intervallet, eller saknar x(t)
 * nästan lutning (x1 = x2 = 1 ger lutning noll vid slutet, x1 = x2 = 0 vid
 * början och (1, 0, 0, 1) mitt i kurvan) tar bisektionen över det steget. Slingan
 * är dessutom begränsad, så den varken divergerar eller hänger.
 */
function bezier(x1: number, y1: number, x2: number, y2: number): EasingFunction {
  if (![x1, y1, x2, y2].every(Number.isFinite)) {
    throw new RangeError(`Easing.bezier: alla fyra värden måste vara ändliga tal, fick (${x1}, ${y1}, ${x2}, ${y2})`);
  }
  if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) {
    throw new RangeError(`Easing.bezier: x1 och x2 måste ligga mellan 0 och 1, fick ${x1} och ${x2}`);
  }
  // När x(t) = y(t) för alla t är kurvan själva linjen y = x.
  if (x1 === y1 && x2 === y2) return linear;

  // B(t) = 3(1-t)²t·p1 + 3(1-t)t²·p2 + t³, utskrivet som polynomet ((a·t + b)·t + c)·t.
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const kurvaX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const kurvaY = (t: number) => ((ay * t + by) * t + cy) * t;
  const lutningX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

  return (x) => {
    if (Number.isNaN(x)) return x;
    // Utanför 0–1 (extend skickar t = 1,5 genom easingen) fortsätter kurvan längs
    // tangenten i ändpunkten, som CSS Easing säger. Är tangenten vågrät blir det 0 respektive 1.
    if (x < 0) {
      if (x1 > 0) return x * (y1 / x1);
      if (x2 > 0) return x * (y2 / x2);
      return 0;
    }
    if (x > 1) {
      if (x2 < 1) return 1 + (x - 1) * ((1 - y2) / (1 - x2));
      if (x1 < 1) return 1 + (x - 1) * ((1 - y1) / (1 - x1));
      return 1;
    }
    if (x === 0 || x === 1) return x;

    let lo = 0;
    let hi = 1;
    let t = x;
    for (let i = 0; i < 100; i++) {
      const avvikelse = kurvaX(t) - x;
      if (Math.abs(avvikelse) < 1e-13) break;
      if (avvikelse > 0) hi = t;
      else lo = t;
      const lutning = lutningX(t);
      let nasta = lutning > 1e-9 ? t - avvikelse / lutning : NaN;
      if (!(nasta > lo && nasta < hi)) nasta = (lo + hi) / 2; // Newton gick utanför: bisektion
      if (nasta === t) break;
      t = nasta;
    }
    return kurvaY(t);
  };
}

/**
 * Samma uppsättning och semantik som Remotions `Easing` (som i sin tur följer
 * React Native), begränsad till det kompositionerna behöver.
 */
export const Easing = {
  linear,
  quad,
  cubic,
  sin,
  exp,
  bezier,
  /** Kurvan som den är: "in" är grundformen. */
  in: (easing: EasingFunction): EasingFunction => easing,
  /** Kurvan spegelvänd, så att den börjar snabbt och landar mjukt. */
  out:
    (easing: EasingFunction): EasingFunction =>
    (t) =>
      1 - easing(1 - t),
  /** Första halvan som "in", andra som "out". */
  inOut:
    (easing: EasingFunction): EasingFunction =>
    (t) =>
      t < 0.5 ? easing(t * 2) / 2 : 1 - easing((1 - t) * 2) / 2,
};

// -----------------------------------------------------------------------------
// interpolate
// -----------------------------------------------------------------------------

/** Vad som händer utanför intervallets ändar: fortsätt linjen, håll ändvärdet, eller svara med ingången själv. */
export type ExtrapolateType = "extend" | "clamp" | "identity";

export type InterpolateOptions = {
  easing?: EasingFunction;
  extrapolateLeft?: ExtrapolateType;
  extrapolateRight?: ExtrapolateType;
};

const EXTRAPOLERINGAR: readonly string[] = ["extend", "clamp", "identity"];

function andligaTal(namn: string, serie: readonly number[]): void {
  for (let i = 0; i < serie.length; i++) {
    if (typeof serie[i] !== "number" || !Number.isFinite(serie[i])) {
      throw new RangeError(`interpolate: ${namn} får bara innehålla ändliga tal, fick [${serie.join(",")}]`);
    }
  }
}

function kontrolleraIntervall(inn: readonly number[], ut: readonly number[]): void {
  if (inn.length !== ut.length) {
    throw new RangeError(`interpolate: inputRange (${inn.length}) och outputRange (${ut.length}) måste vara lika långa`);
  }
  if (inn.length < 2) {
    throw new RangeError("interpolate: inputRange och outputRange måste ha minst två punkter");
  }
  andligaTal("inputRange", inn);
  andligaTal("outputRange", ut);
  for (let i = 1; i < inn.length; i++) {
    if (!(inn[i] > inn[i - 1])) {
      throw new RangeError(`interpolate: inputRange måste stiga strikt, fick [${inn.join(",")}]`);
    }
  }
}

/**
 * Avbilda `input` från `inputRange` till `outputRange`, delintervall för
 * delintervall. Som Remotions `interpolate`:
 *
 *   - `inputRange` måste vara strikt stigande och lika långt som `outputRange`.
 *   - `easing` formar varje delintervall, och gäller också utanför ändarna när
 *     extrapoleringen är "extend" (t blir då större än 1 eller mindre än 0).
 *   - `extrapolateLeft` och `extrapolateRight` gäller bara de yttersta ändarna,
 *     är oberoende av varandra, och är "extend" som standard.
 */
export function interpolate(
  input: number,
  inputRange: readonly number[],
  outputRange: readonly number[],
  options: InterpolateOptions = {},
): number {
  if (typeof input !== "number") {
    throw new TypeError(`interpolate: input måste vara ett tal, fick ${typeof input}`);
  }
  kontrolleraIntervall(inputRange, outputRange);
  const { easing = linear, extrapolateLeft = "extend", extrapolateRight = "extend" } = options;
  if (!EXTRAPOLERINGAR.includes(extrapolateLeft) || !EXTRAPOLERINGAR.includes(extrapolateRight)) {
    throw new RangeError(
      `interpolate: extrapolateLeft/Right måste vara "extend", "clamp" eller "identity", fick "${extrapolateLeft}" och "${extrapolateRight}"`,
    );
  }

  // Det första delintervall vars slut ligger vid eller efter input. En mellanpunkt
  // tillhör alltså intervallet före den. Utanför ändarna används det första
  // respektive sista, så att "extend" fortsätter med deras lutning.
  let i = 0;
  while (i < inputRange.length - 2 && input > inputRange[i + 1]) i++;
  const y0 = outputRange[i];
  const y1 = outputRange[i + 1];

  let t = (input - inputRange[i]) / (inputRange[i + 1] - inputRange[i]);
  if (input < inputRange[0]) {
    if (extrapolateLeft === "identity") return input;
    if (extrapolateLeft === "clamp") t = 0;
  } else if (input > inputRange[inputRange.length - 1]) {
    if (extrapolateRight === "identity") return input;
    if (extrapolateRight === "clamp") t = 1;
  }
  if (y0 === y1) return y0;
  return y0 + (y1 - y0) * easing(t);
}

// -----------------------------------------------------------------------------
// spring
// -----------------------------------------------------------------------------

export type SpringConfig = {
  /**
   * Motståndet: större värde, mindre studs. Remotions standard är 10. Från
   * damping = 2·√(stiffness·mass) (20 vid standardvärdena) är fjädern kritiskt
   * dämpad, och mer dämpning ändrar ingenting, som i Remotion.
   */
  damping: number;
  /** Tröghet. Standard 1. */
  mass: number;
  /** Fjäderns styvhet: större värde, snabbare. Standard 100. */
  stiffness: number;
  /** Stanna vid målet i stället för att slå över det. Standard false. */
  overshootClamping: boolean;
};

export type SpringArgs = {
  frame: number;
  fps: number;
  config?: Partial<SpringConfig>;
  from?: number;
  to?: number;
  /** Sträck eller pressa fjädern så att den är i vila vid just den här bildrutan (efter `delay`). */
  durationInFrames?: number;
  /** Hur nära slutet, som andel av sträckan, fjädern ska vara för att räknas som i vila. Standard 0,005. */
  durationRestThreshold?: number;
  /** Bildrutor fjädern står still innan den börjar. */
  delay?: number;
};

const STANDARDFJADER: SpringConfig = { damping: 10, mass: 1, stiffness: 100, overshootClamping: false };
const VILOTROSKEL = 0.005;

/** Inställningarna med de storheter som lösningen behöver. */
type Fjader = SpringConfig & {
  /** Egenfrekvens ω₀ = √(k/m), radianer per sekund. */
  w0: number;
  /** Dämpkvot ζ = c / (2·√(k·m)): under 1 studsar fjädern, från 1 är den kritiskt dämpad. */
  zeta: number;
  /** Avklingning ζ·ω₀ = c / (2m), per sekund. Bara den underdämpade formen använder den. */
  a: number;
};

function fjader(delvis: Partial<SpringConfig> = {}): Fjader {
  const damping = delvis.damping ?? STANDARDFJADER.damping;
  const mass = delvis.mass ?? STANDARDFJADER.mass;
  const stiffness = delvis.stiffness ?? STANDARDFJADER.stiffness;
  const overshootClamping = delvis.overshootClamping ?? STANDARDFJADER.overshootClamping;
  if (!Number.isFinite(damping) || damping < 0) {
    throw new RangeError(`spring: damping måste vara ett tal som inte är negativt, fick ${damping}`);
  }
  if (!Number.isFinite(mass) || mass <= 0) {
    throw new RangeError(`spring: mass måste vara ett positivt tal, fick ${mass}`);
  }
  if (!Number.isFinite(stiffness) || stiffness <= 0) {
    throw new RangeError(`spring: stiffness måste vara ett positivt tal, fick ${stiffness}`);
  }
  return {
    damping,
    mass,
    stiffness,
    overshootClamping,
    w0: Math.sqrt(stiffness / mass),
    zeta: damping / (2 * Math.sqrt(stiffness * mass)),
    a: damping / (2 * mass),
  };
}

function kontrolleraFps(fps: number): void {
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new RangeError(`spring: fps måste vara ett positivt tal, fick ${fps}`);
  }
}

/** sin(x)/x med sinc(0) = 1, så att formeln nedan håller när ωd går mot noll. */
const sinc = (x: number) => (x === 0 ? 1 : Math.sin(x) / x);

/**
 * Hur långt fjädern har kvar till målet som andel av hela sträckan: 1 vid
 * starten, 0 i vila, negativt när den slagit över.
 *
 * Fjädern är m·x'' + c·x' + k·x = k·mål med x(0) = från och x'(0) = 0. Med
 * e = (mål - x)/(mål - från) blir det e'' + 2ζω₀e' + ω₀²e = 0, e(0) = 1,
 * e'(0) = 0. Som i Remotion finns två former, valda av dämpkvoten:
 *
 *   ζ < 1  underdämpad:  e = e^(-a·t)·(cos ωd·t + (a/ωd)·sin ωd·t),  a = ζ·ω₀, ωd = ω₀√(1-ζ²)
 *   ζ ≥ 1  kritisk:      e = e^(-ω₀·t)·(1 + ω₀·t)
 *
 * Det finns ingen tredje, överdämpad form. Fysiskt ger ζ > 1 två reella poler och
 * en kurva som kryper långsammare ju hårdare man dämpar. Remotion (och Reanimated
 * före det) räknar i stället allt från ζ = 1 som den kritiska fjädern med
 * ω₀ = √(k/m), så `damping` ingår inte i den formen alls. Se huvudkommentaren för
 * varför det avgör hur `{damping: 200}` beter sig.
 *
 * Exponenterna är ≤ 0, så inget kan svämma över hur lång tiden än är.
 */
function kvar(t: number, f: Fjader): number {
  const { a, w0, zeta } = f;
  if (zeta < 1) {
    // sinc håller formeln stabil när ωd går mot noll (ζ nära 1), där (a/ωd)·sin ωd·t
    // annars delar med nästan noll. Gränsvärdet är den kritiska formen nedan.
    const x = w0 * Math.sqrt(1 - zeta * zeta) * t;
    return Math.exp(-a * t) * (Math.cos(x) + a * t * sinc(x));
  }
  return Math.exp(-w0 * t) * (1 + w0 * t);
}

/**
 * När en underdämpad fjäder först når målet: e = 0 vid ωd·t = π/2 + asin ζ.
 * En kritiskt dämpad fjäder (ζ ≥ 1) når det aldrig på ändlig tid.
 */
function forstaPassage(f: Fjader): number {
  if (f.zeta >= 1) return Infinity;
  return (Math.PI / 2 + Math.asin(f.zeta)) / (f.w0 * Math.sqrt(1 - f.zeta * f.zeta));
}

/**
 * Fjäderns läge som andel av sträckan: 0 vid start, 1 vid målet. Med
 * overshootClamping stannar fjädern vid målet i samma stund den först når det
 * (som i Remotion och React Native), i stället för att klippas ovanifrån och
 * svänga tillbaka under det.
 */
function lage(t: number, f: Fjader): number {
  if (t === Infinity) return 1;
  if (f.overshootClamping && t >= forstaPassage(f)) return 1;
  return 1 - kvar(t, f);
}

/** Dela intervallet tills gränsen mellan "utanför" (lo) och "innanför" (hi) är funnen. Returnerar den innanför. */
function delaTills(lo: number, hi: number, utanfor: (t: number) => boolean): number {
  for (let i = 0; i < 200; i++) {
    const mitt = lo + (hi - lo) / 2;
    if (mitt <= lo || mitt >= hi) break;
    if (utanfor(mitt)) lo = mitt;
    else hi = mitt;
  }
  return hi;
}

/**
 * Den sista stunden (sekunder) då fjädern är minst `troskel` från målet. Efter
 * den är den inom tröskeln för alltid, vilket är vad "i vila" betyder: en
 * studsande fjäder är inom 0,5 % flera gånger innan den stannar.
 *
 * Underdämpad: felet e har sina vändpunkter vid t = n·π/ωd, och vändpunkt n har
 * storleken qⁿ med q = e^(-π·ζ/√(1-ζ²)). Den sista vändpunkt som ännu når
 * tröskeln är därför n = ⌊ln tröskel / ln q⌋, och efter den sjunker |e| jämnt tills
 * nästa vändpunkt, som redan är under tröskeln. Gränsen ligger alltså i
 * intervallet [n, n+1]·π/ωd och hittas med bisektion. En kritisk fjäder (ζ ≥ 1)
 * sjunker jämnt från början, och med overshootClamping gäller samma sak fram till
 * första passagen.
 */
function hvilotid(f: Fjader, troskel: number): number {
  const utanfor = (t: number) => Math.abs(kvar(t, f)) >= troskel;
  let tid: number;

  if (f.zeta < 1 && !f.overshootClamping) {
    if (f.zeta === 0) throw new RangeError("spring: en fjäder utan dämpning (damping 0) kommer aldrig till ro");
    const wd = f.w0 * Math.sqrt(1 - f.zeta * f.zeta);
    const vandning = Math.PI / wd;
    const q = Math.exp((-Math.PI * f.zeta) / Math.sqrt(1 - f.zeta * f.zeta));
    let n = Math.max(0, Math.floor(Math.log(troskel) / Math.log(q)));
    // Logaritmerna kan hamna en vändpunkt fel av avrundning. Rätta mot själva värdena.
    for (let i = 0; i < 64 && n > 0 && !utanfor(n * vandning); i++) n--;
    for (let i = 0; i < 64 && utanfor((n + 1) * vandning); i++) n++;
    tid = delaTills(n * vandning, (n + 1) * vandning, utanfor);
  } else {
    let lo = 0;
    let hi = Math.min(forstaPassage(f), 1 / f.w0);
    for (let i = 0; i < 2000 && utanfor(hi) && hi < Infinity; i++) {
      lo = hi;
      hi *= 2;
      if (hi > forstaPassage(f)) hi = forstaPassage(f);
    }
    tid = delaTills(lo, hi, utanfor);
  }

  if (!Number.isFinite(tid)) throw new RangeError("spring: fjädern kommer aldrig till ro med de här inställningarna");
  return tid;
}

/** Vilotiden räknas om för varje spring()-anrop med durationInFrames, men inställningarna byts nästan aldrig. */
const VILOTIDER = new Map<string, number>();

function vilotid(f: Fjader, troskel: number): number {
  const nyckel = `${f.damping}|${f.mass}|${f.stiffness}|${f.overshootClamping}|${troskel}`;
  const sparad = VILOTIDER.get(nyckel);
  if (sparad !== undefined) return sparad;
  const tid = hvilotid(f, troskel);
  if (VILOTIDER.size >= 256) VILOTIDER.clear();
  VILOTIDER.set(nyckel, tid);
  return tid;
}

/**
 * Hur många bildrutor fjädern behöver för att komma till ro: den första hela
 * bildruta efter vilket den är inom `threshold` (standard 0,5 %) av målet, och
 * förblir det. Som Remotions `measureSpring`.
 */
export function measureSpring({
  fps,
  config,
  threshold = VILOTROSKEL,
}: {
  fps: number;
  config?: Partial<SpringConfig>;
  threshold?: number;
}): number {
  kontrolleraFps(fps);
  if (!(threshold > 0 && threshold < 1)) {
    throw new RangeError(`measureSpring: threshold måste ligga mellan 0 och 1, fick ${threshold}`);
  }
  // Första hela bildruta STRIKT efter sista stunden utanför tröskeln, så att fjädern
  // vid den bildrutan är innanför och inte precis på gränsen.
  return Math.floor(vilotid(fjader(config), threshold) * fps) + 1;
}

/**
 * Fjäderns värde vid en bildruta, från `from` (standard 0) mot `to` (standard 1).
 * Som Remotions `spring`: standardfjädern slår över med 16 %, `delay` håller den
 * stilla, och `durationInFrames` skalar tiden så att den är i vila vid just den
 * bildrutan. Negativa bildrutor ger `from`.
 */
export function spring({
  frame,
  fps,
  config,
  from = 0,
  to = 1,
  durationInFrames,
  durationRestThreshold = VILOTROSKEL,
  delay = 0,
}: SpringArgs): number {
  kontrolleraFps(fps);
  const f = fjader(config);
  let rutor = Math.max(0, frame - delay);
  if (durationInFrames !== undefined) {
    if (!Number.isFinite(durationInFrames) || durationInFrames <= 0) {
      throw new RangeError(`spring: durationInFrames måste vara ett positivt tal, fick ${durationInFrames}`);
    }
    rutor *= measureSpring({ fps, config: f, threshold: durationRestThreshold }) / durationInFrames;
  }
  return from + (to - from) * lage(rutor / fps, f);
}

// -----------------------------------------------------------------------------
// Sequence och Spelare — besluten, utan React
// -----------------------------------------------------------------------------

/**
 * Sequence: barnets bildruta, eller null när barnet inte ska finnas.
 *
 * Barnen ser `frame - from`, och finns från och med `from` till men inte med
 * `from + durationInFrames`. `frame` är den omgivande bildrutan, alltså redan
 * förskjuten av en yttre Sequence, så ett inre `from` är relativt den yttre.
 * Som i Remotion är `from` ett heltal (negativt tillåtet: sekvensen är då
 * redan igång vid bildruta 0) och längden ett positivt tal eller Infinity.
 *
 * Längden får vara en bråkdel. Den räknas ofta ur sekunder, och ett kast i en
 * kompositions rendering tömmer hela tavlan på en TV som ingen rör. Fönstret är
 * detsamma som för heltal, så med 30,5 syns de lokala bildrutorna 0–30.
 */
export function sekvensFonster(frame: number, from: number = 0, durationInFrames: number = Infinity): number | null {
  if (!Number.isInteger(from)) {
    throw new RangeError(`Sequence: from måste vara ett heltal, fick ${from}`);
  }
  if (!(durationInFrames > 0)) {
    throw new RangeError(`Sequence: durationInFrames måste vara ett positivt tal eller Infinity, fick ${durationInFrames}`);
  }
  const lokal = frame - from;
  return lokal >= 0 && lokal < durationInFrames ? lokal : null;
}

export type Spelstatus = {
  /** Bildrutan som visas. */
  bildruta: number;
  /** Klockan har nått varaktigheten. */
  klar: boolean;
};

export type Spelsteg = Spelstatus & {
  /** Sant i exakt det steg där `klar` slog om, och aldrig mer. Då ska onKlar anropas. */
  nyligenKlar: boolean;
};

/**
 * Ett steg i Spelarens klocka, anropat en gång per målning.
 *
 * Bildrutan räknas ur klockan, `Math.floor(sekunder·fps)`, aldrig ur antalet
 * målningar. En långsam TV målar färre gånger och hoppar därför över bildrutor,
 * men spelar aldrig i slowmotion, och ljudet (som går på samma klocka) hänger med.
 *
 *   - Bildrutan går aldrig bakåt. Ljudklockan och performance.now() är två klockor,
 *     och byter tavlan från den ena till den andra ska bilden stå still, inte backa.
 *   - Den visade bildrutan stannar på den sista, `varaktighet - 1`. Kompositionen
 *     får aldrig se en bildruta den inte har.
 *   - `nyligenKlar` är sant första gången klockans bildruta når `varaktighet`.
 *   - En klocka som ger NaN (en ljudklocka som inte startat) ändrar ingenting.
 *   - En längd som inte går att räkna ut (NaN, noll, negativ) ger ett firande som
 *     är slut direkt, så att det inte hänger på tavlan för alltid.
 */
export function stegaSpelare(fore: Spelstatus, sekunder: number, varaktighet: number, fps: number = FPS): Spelsteg {
  if (Number.isNaN(sekunder)) return { bildruta: fore.bildruta, klar: fore.klar, nyligenKlar: false };
  const langd = varaktighet > 0 ? varaktighet : 0;
  const ra = Math.max(0, Math.floor(sekunder * fps));
  const sista = Math.max(0, Math.ceil(langd) - 1);
  const klar = fore.klar || ra >= langd;
  return {
    bildruta: Math.max(fore.bildruta, Math.min(ra, sista)),
    klar,
    nyligenKlar: klar && !fore.klar,
  };
}
