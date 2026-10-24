#!/usr/bin/env node
/**
 * Säljtavlans rörelsemotor (src/app/salesboard/motion/matte.ts). Fem saker står
 * på spel, och de provas åt båda hållen:
 *
 *   1. SAMMA SVAR SOM REMOTION. Kompositionerna skrivs mot motorns API och ska
 *      kunna byta importen mot `remotion` den dag bolaget köper licensen. Ger
 *      interpolate, spring eller Easing andra tal än Remotions ser samma
 *      komposition annorlunda ut efter bytet, och ingen märker det förrän någon
 *      jämför med en renderad film.
 *   2. FJÄDERN ÄR EN LÖSNING, INTE EN SIMULERING, OCH FÖLJER REMOTIONS REGEL FÖR
 *      HÅRD DÄMPNING. Två fall med varsin formel: underdämpad (ζ < 1) och kritisk
 *      (ζ ≥ 1). Remotion räknar `zeta < 1 ? underdämpad : kritiskt dämpad`, så en
 *      fjäder med ζ ≥ 1 är alltid den kritiska med ω₀ = √(k/m), vad `damping`
 *      än är. `{damping: 200}`, Remotions förinställning för "mjuk, ingen studs",
 *      är därför framme på under en sekund. Skulle den räknas som den fysiskt
 *      överdämpade fjäder den ser ut att vara kröp den (0,39 efter en sekund), och
 *      varje komposition kändes seg efter importbytet. Varje formel provas mot en
 *      numerisk integrering som inte delar en rad kod med den, och gränsen mellan
 *      fallen provas för sig: där är det lätt att få NaN eller ett hopp.
 *   3. durationInFrames SKALAR TIDEN. Fjädern ska vara inom 0,5 % av slutet vid
 *      just den bildrutan, inte en bildruta före eller efter. Det är hela
 *      poängen med att få ange en längd.
 *   4. SEQUENCE FÖRSKJUTER BILDRUTAN. Barnen ser `frame - from`, och finns bara
 *      i sitt fönster. Fönstret provas på kanterna, där en bildruta för mycket
 *      eller för lite syns som ett blinkande barn.
 *   5. KLOCKAN STYR. Spelaren räknar bildrutan ur klockan, aldrig ur antalet
 *      målningar: en långsam TV tappar bildrutor men spelar aldrig i slowmotion,
 *      går aldrig bakåt och säger "klar" exakt en gång.
 *
 * Bara matematiken provas här. React-skalet i motor.tsx är tunt (kontext,
 * Provider och en rAF-slinga) och allt det beslutar ligger i matte.ts.
 *
 *   TZ=UTC node --experimental-strip-types tests/salesboard-motor.mjs
 */
import {
  BREDD,
  Easing,
  FPS,
  HOJD,
  interpolate,
  measureSpring,
  sekvensFonster,
  spring,
  stegaSpelare,
} from "../src/app/salesboard/motion/matte.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(
    `  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`,
  );
  if (!villkor) fel++;
};

const nara = (a, b, tol) => Math.abs(a - b) <= tol;
const kastar = (f) => {
  try {
    f();
    return false;
  } catch {
    return true;
  }
};
const heltal = (n) => Array.from({ length: n }, (_, i) => i);

/**
 * Facit för fjädern: u'' = (-c·u' - k·(u - 1)) / m med u(0) = u'(0) = 0, löst
 * med Runge–Kutta 4 i 100 steg per bildruta (60 bilder per sekund). Det är
 * medvetet en annan väg än formlerna i matte.ts: ingen delad kod, bara samma
 * fysik. Returnerar u vid varje steg, så u[bildruta * 100] är bildrutan.
 *
 * Med EN skillnad mot ren fysik, och den är Remotions: en fjäder med ζ ≥ 1 är
 * alltid kritiskt dämpad. Remotion räknar `zeta < 1 ? underdämpad : kritisk`, så
 * damping över 2·√(k·m) ändrar ingenting. Facit integrerar därför med den
 * dämpning som faktiskt gäller, min(c, 2·√(k·m)).
 */
const STEG_PER_BILDRUTA = 100;
function fjaderFacit({ damping, mass, stiffness }, sekunder) {
  const dt = 1 / FPS / STEG_PER_BILDRUTA;
  const n = Math.round(sekunder / dt);
  const u = new Float64Array(n + 1);
  const c = Math.min(damping, 2 * Math.sqrt(stiffness * mass));
  const acc = (x, v) => (-c * v - stiffness * (x - 1)) / mass;
  let x = 0;
  let v = 0;
  for (let i = 0; i < n; i++) {
    const k1x = v, k1v = acc(x, v);
    const k2x = v + (dt / 2) * k1v, k2v = acc(x + (dt / 2) * k1x, v + (dt / 2) * k1v);
    const k3x = v + (dt / 2) * k2v, k3v = acc(x + (dt / 2) * k2x, v + (dt / 2) * k2v);
    const k4x = v + dt * k3v, k4v = acc(x + dt * k3x, v + dt * k3v);
    x += (dt / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
    v += (dt / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);
    u[i + 1] = x;
  }
  return u;
}

// -----------------------------------------------------------------------------
console.log("\nDuken");
{
  ok("duken är 1920×1080 vid 60 bilder per sekund", FPS === 60 && BREDD === 1920 && HOJD === 1080);
}

// -----------------------------------------------------------------------------
console.log("\ninterpolate — Remotions semantik");
{
  ok("mitt i intervallet: 5 av [0,10] → [0,100] är 50", interpolate(5, [0, 10], [0, 100]) === 50);

  // STANDARD ÄR "extend". Utan clamp fortsätter linjen, och den som glömmer det ser
  // en panel som glider ut ur bild i stället för att stanna.
  ok("extend är standard: 15 ger 150", interpolate(15, [0, 10], [0, 100]) === 150);
  ok("extend åt vänster: -5 ger -50", interpolate(-5, [0, 10], [0, 100]) === -50);
  ok("clamp åt höger: 15 ger 100", interpolate(15, [0, 10], [0, 100], { extrapolateRight: "clamp" }) === 100);
  ok("clamp åt vänster: -5 ger 0", interpolate(-5, [0, 10], [0, 100], { extrapolateLeft: "clamp" }) === 0);
  ok(
    "clamp på båda sidor",
    interpolate(15, [0, 10], [0, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) === 100 &&
      interpolate(-5, [0, 10], [0, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) === 0,
  );
  ok("identity: 15 ger 15", interpolate(15, [0, 10], [0, 100], { extrapolateRight: "identity" }) === 15);
  ok("identity åt vänster: -5 ger -5", interpolate(-5, [0, 10], [0, 100], { extrapolateLeft: "identity" }) === -5);

  // SIDORNA ÄR OBEROENDE. Clamp åt vänster får inte stänga av extend åt höger.
  ok("vänster clamp rör inte höger sida", interpolate(15, [0, 10], [0, 100], { extrapolateLeft: "clamp" }) === 150);
  ok("höger clamp rör inte vänster sida", interpolate(-5, [0, 10], [0, 100], { extrapolateRight: "clamp" }) === -50);
  ok("identity gäller bara den sida den står på", interpolate(-5, [0, 10], [0, 100], { extrapolateRight: "identity" }) === -50);

  ok("flera intervall: 15 av [0,10,20] → [0,100,0] är 50", interpolate(15, [0, 10, 20], [0, 100, 0]) === 50);
  ok("flera intervall: 5 är 50", interpolate(5, [0, 10, 20], [0, 100, 0]) === 50);
  ok("en mellanpunkt ger exakt sitt värde", interpolate(10, [0, 10, 20], [0, 100, 0]) === 100);
  // Utanför ändarna används det första och sista delintervallets lutning.
  ok("extend åt höger följer det sista delintervallets lutning", interpolate(25, [0, 10, 20], [0, 100, 0]) === -50);
  ok("extend åt vänster följer det första delintervallets lutning", interpolate(-5, [0, 10, 20], [0, 100, 0]) === -50);
  ok(
    "clamp gäller ändarna, inte mellanpunkterna",
    interpolate(10, [0, 10, 20], [0, 100, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) === 100 &&
      interpolate(99, [0, 10, 20], [0, 100, 5], { extrapolateRight: "clamp" }) === 5,
  );

  ok("fallande utdata: 5 av [0,10] → [100,0] är 50", interpolate(5, [0, 10], [100, 0]) === 50);
  ok("negativ ingång: -5 av [-10,0] → [0,1] är 0,5", interpolate(-5, [-10, 0], [0, 1]) === 0.5);
  ok("lika utdata ger det värdet", interpolate(3, [0, 10], [7, 7]) === 7);

  // EASING GÄLLER ÄVEN UTANFÖR INTERVALLET (extend skickar t = 1,5 genom easingen).
  ok("easing inom intervallet: quad(0,5) = 25", interpolate(5, [0, 10], [0, 100], { easing: Easing.quad }) === 25);
  ok("easing används också i extend: quad(1,5) = 225", interpolate(15, [0, 10], [0, 100], { easing: Easing.quad }) === 225);
  ok(
    "easing med clamp stannar vid slutvärdet",
    interpolate(15, [0, 10], [0, 100], { easing: Easing.out(Easing.cubic), extrapolateRight: "clamp" }) === 100,
  );
  ok(
    "easing används i varje delintervall",
    interpolate(15, [0, 10, 20], [0, 100, 0], { easing: Easing.quad }) === 75,
    String(interpolate(15, [0, 10, 20], [0, 100, 0], { easing: Easing.quad })),
  );

  // KONTROLLERNA. Remotion kastar för dessa, och ett intervall som fungerar här
  // men kastar där vore en fälla vid bytet.
  ok("inputRange måste stiga strikt (lika värden)", kastar(() => interpolate(1, [0, 0], [0, 1])));
  ok("inputRange måste stiga strikt (fallande)", kastar(() => interpolate(1, [10, 0], [0, 1])));
  ok("inputRange måste stiga även i mitten", kastar(() => interpolate(1, [0, 10, 5], [0, 1, 2])));
  ok("längderna måste vara lika", kastar(() => interpolate(1, [0, 10], [0, 1, 2])));
  ok("minst två punkter", kastar(() => interpolate(1, [0], [0])));
  ok("tomma intervall kastar", kastar(() => interpolate(1, [], [])));
  ok("NaN i inputRange kastar", kastar(() => interpolate(1, [0, NaN], [0, 1])));
  ok("oändlighet i inputRange kastar", kastar(() => interpolate(1, [0, Infinity], [0, 1])));
  ok("oändlighet i outputRange kastar", kastar(() => interpolate(1, [0, 1], [0, Infinity])));
  ok("en sträng som ingång kastar", kastar(() => interpolate("5", [0, 10], [0, 100])));
}

// -----------------------------------------------------------------------------
console.log("\nEasing");
{
  ok("linear", Easing.linear(0.3) === 0.3);
  ok("quad(0,5) = 0,25", Easing.quad(0.5) === 0.25);
  ok("cubic(0,5) = 0,125", Easing.cubic(0.5) === 0.125);
  ok("sin(0) = 0 och sin(1) = 1", Easing.sin(0) === 0 && nara(Easing.sin(1), 1, 1e-12));
  ok("sin(0,5) = 1 - cos(π/4)", nara(Easing.sin(0.5), 1 - Math.cos(Math.PI / 4), 1e-12));
  // 2^(10·(t-1)), som i Remotion och React Native. exp(0) blir därför 2^-10 och inte
  // noll: det är Remotions beteende, så det är också vårt.
  ok("exp(1) = 1 och exp(0,5) = 2^-5", Easing.exp(1) === 1 && Easing.exp(0.5) === 0.03125);
  ok("exp(0) = 2^-10", Easing.exp(0) === 2 ** -10);

  ok("in(f) är f", Easing.in(Easing.cubic)(0.5) === 0.125);
  ok("out(cubic)(0,5) = 0,875", Easing.out(Easing.cubic)(0.5) === 0.875);
  ok("out(quad)(0,5) = 0,75", Easing.out(Easing.quad)(0.5) === 0.75);
  ok("out vänder på kurvan: ändpunkterna står kvar", Easing.out(Easing.cubic)(0) === 0 && Easing.out(Easing.cubic)(1) === 1);
  ok(
    "inOut(quad) är speglad kring mitten",
    Easing.inOut(Easing.quad)(0.25) === 0.125 &&
      Easing.inOut(Easing.quad)(0.75) === 0.875 &&
      Easing.inOut(Easing.quad)(0.5) === 0.5,
  );
  ok("inOut(cubic) börjar och slutar i ändpunkterna", Easing.inOut(Easing.cubic)(0) === 0 && Easing.inOut(Easing.cubic)(1) === 1);
}

// -----------------------------------------------------------------------------
console.log("\nEasing.bezier — Newton–Raphson med bisektion som reserv");
{
  const ease = Easing.bezier(0.42, 0, 0.58, 1);
  ok("ease-in-out i mitten är 0,5", nara(ease(0.5), 0.5, 1e-3), String(ease(0.5)));
  ok("linjen (0,0,1,1) ger 0,3 vid 0,3", nara(Easing.bezier(0, 0, 1, 1)(0.3), 0.3, 1e-3));
  ok("linjen (0,25;0,25;0,75;0,75) är också y = x", nara(Easing.bezier(0.25, 0.25, 0.75, 0.75)(0.3), 0.3, 1e-9));
  // Kurvor med x = y hela vägen är själva linjen, och ska ge ingången oförändrad. Det
  // är samma sak som Remotion och bezier-easing gör, och den som jämför tal exakt ser det.
  ok("linjen svarar exakt, inte 0,30000000000000004", Easing.bezier(0, 0, 1, 1)(0.3) === 0.3 && Easing.bezier(0.1, 0.1, 0.9, 0.9)(0.7) === 0.7);
  ok("ändpunkterna är exakta", ease(0) === 0 && ease(1) === 1);

  // FACIT: tät provtagning av själva kurvan (x(t), y(t)) och linjär interpolation
  // mellan grannarna. Kurvorna är valda för att ha olika svårt för Newton:
  // spec:ens "täck" (0,05; 0,7; 0,1; 1) är brant i början (y går först och x efter),
  // (0,9; 0; 0,1; 1) är en tvär S-kurva där x nästan står still i mitten,
  // (1,0,1,1) och (0,0,0,1) har x-lutning noll i ena änden (Newton hoppar ut ur
  // intervallet, bisektionen tar över), (0,1,1,0) har y-lutning noll mitt i kurvan, och
  // (0,34; 1,56; 0,64; 1) får y över 1 (överskjut).
  const kurvor = [
    [0.42, 0, 0.58, 1],
    [0.25, 0.1, 0.25, 1],
    [0.05, 0.7, 0.1, 1],
    [0, 0, 0.58, 1],
    [0.42, 0, 1, 1],
    [0.9, 0, 0.1, 1],
    [0.34, 1.56, 0.64, 1],
    [0, 1, 1, 0],
    [0, 0, 0, 1],
    [1, 0, 1, 1],
  ];
  const N = 200000;
  let storstaFel = 0;
  let varst = "";
  for (const [x1, y1, x2, y2] of kurvor) {
    const xs = new Float64Array(N + 1);
    const ys = new Float64Array(N + 1);
    for (let i = 0; i <= N; i++) {
      const t = i / N, m = 1 - t;
      xs[i] = 3 * m * m * t * x1 + 3 * m * t * t * x2 + t * t * t;
      ys[i] = 3 * m * m * t * y1 + 3 * m * t * t * y2 + t * t * t;
    }
    const facit = (x) => {
      let lo = 0, hi = N;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (xs[mid] <= x) lo = mid; else hi = mid;
      }
      const d = xs[hi] - xs[lo];
      return d === 0 ? ys[lo] : ys[lo] + ((ys[hi] - ys[lo]) * (x - xs[lo])) / d;
    };
    const f = Easing.bezier(x1, y1, x2, y2);
    for (let i = 1; i < 200; i++) {
      const x = i / 200;
      const fl = Math.abs(f(x) - facit(x));
      if (fl > storstaFel) {
        storstaFel = fl;
        varst = `(${x1},${y1},${x2},${y2}) vid ${x}`;
      }
    }
  }
  ok("tio kurvor stämmer med facit inom 1e-5 på 199 punkter var", storstaFel < 1e-5, `största felet ${storstaFel.toExponential(2)} ${varst}`);

  // (1,0,0,1) har lutning noll mitt i kurvan (x = 0,5, t = 0,5): där är y ett mycket
  // dåligt villkorat svar på x, så facit går inte att jämföra mot 1e-5. Den ska ändå
  // inte ge NaN, inte lämna 0–1 och inte hänga.
  {
    const s_kurva = Easing.bezier(1, 0, 0, 1);
    const varden = heltal(201).map((i) => s_kurva(i / 200));
    ok("kurvan med platt mitt ger ändliga svar i 0–1", varden.every((v) => Number.isFinite(v) && v >= 0 && v <= 1));
    ok("och går genom mitten", nara(s_kurva(0.5), 0.5, 1e-3), String(s_kurva(0.5)));
    // Så nära mitten att lutningen är under 1e-9 i första gissningen (t = x): Newton har
    // ingenting att dela med, och bisektionen måste ta över i stället för att ge NaN
    // eller hoppa ut ur kurvan.
    const nastan = s_kurva(0.5 + 2e-13);
    ok("där Newton saknar lutning tar bisektionen över", Number.isFinite(nastan) && nastan >= 0.5 && nastan < 0.51, String(nastan));
  }

  const taget = Easing.bezier(0.05, 0.7, 0.1, 1);
  let stiger = true;
  let forra = 0;
  for (let i = 1; i <= 1000; i++) {
    const v = taget(i / 1000);
    if (v < forra - 1e-12 || v < 0 || v > 1 + 1e-12) stiger = false;
    forra = v;
  }
  ok("täck-kurvan (0,05; 0,7; 0,1; 1) stiger jämnt och håller sig i 0–1", stiger);
  ok("och är snabb i början: 70 % av vägen vid 15 % av tiden", taget(0.15) > 0.7, String(taget(0.15)));

  // UTANFÖR 0–1 (extend skickar t = 1,5): CSS-specens tangentförlängning.
  ok("ease-in-out håller 1 efter slutet", Easing.bezier(0.42, 0, 0.58, 1)(1.5) === 1);
  ok("ease-in-out håller 0 före början", Easing.bezier(0.42, 0, 0.58, 1)(-0.5) === 0);
  ok("ease-in fortsätter med slutlutningen", nara(Easing.bezier(0.42, 0, 1, 1)(2), 1 + 1 / 0.58, 1e-9));
  ok("NaN ger NaN, inte en oändlig slinga", Number.isNaN(Easing.bezier(0.42, 0, 0.58, 1)(NaN)));

  ok("x1 utanför 0–1 kastar", kastar(() => Easing.bezier(-0.1, 0, 0.5, 1)));
  ok("x2 utanför 0–1 kastar", kastar(() => Easing.bezier(0, 0, 1.1, 1)));
  ok("NaN kastar", kastar(() => Easing.bezier(0, NaN, 1, 1)));
}

// -----------------------------------------------------------------------------
console.log("\nspring — Remotions standard och analytisk lösning");
{
  ok("bildruta 0 är exakt 0", spring({ frame: 0, fps: 60 }) === 0);
  ok("bildruta 600 är 1 inom 1e-3", nara(spring({ frame: 600, fps: 60 }), 1, 1e-3), String(spring({ frame: 600, fps: 60 })));

  // STANDARDEN ÄR damping 10, mass 1, stiffness 100: en fjäder som slår över. Den
  // som läser "mjuk fjäder" i Remotions dokument ska få samma studs här.
  const standard = heltal(121).map((frame) => spring({ frame, fps: 60 }));
  const topp = Math.max(...standard);
  ok("standardfjädern slår över (max > 1,05 inom 120 bildrutor)", topp > 1.05, `topp ${topp.toFixed(4)}`);
  ok(
    "toppen är 16,3 % över (e^(-π·ζ/√(1-ζ²)) med ζ = 0,5)",
    nara(topp, 1 + Math.exp((-Math.PI * 0.5) / Math.sqrt(0.75)), 2e-3),
    `${topp.toFixed(4)} mot ${(1 + Math.exp((-Math.PI * 0.5) / Math.sqrt(0.75))).toFixed(4)}`,
  );
  ok(
    "toppen ligger vid bildruta 22 (π/ωd = 0,363 s)",
    standard.indexOf(topp) === 22,
    `bildruta ${standard.indexOf(topp)}`,
  );

  // {damping: 200} är Remotions egen förinställning för "mjuk, ingen studs". Vid
  // standardstyvheten (ζ = 10) räknar Remotion den som den kritiska fjädern med ω₀ = 10,
  // alltså framme på under en sekund. En fysiskt överdämpad fjäder med samma tal kröp
  // fram: 0,39 efter en sekund och 0,99 först efter tio.
  const tung = heltal(601).map((frame) => spring({ frame, fps: 60, config: { damping: 200 } }));
  ok("damping 200 slår inte över (max ≤ 1,0001)", Math.max(...tung) <= 1.0001, `max ${Math.max(...tung)}`);
  ok("damping 200 stiger jämnt hela vägen", tung.every((v, i) => i === 0 || v >= tung[i - 1] - 1e-12));
  const enSekund = spring({ frame: 60, fps: 60, config: { damping: 200 } });
  ok("damping 200 är framme efter en sekund (> 0,99) och utan studs (≤ 1,0001)", enSekund > 0.99 && enSekund <= 1.0001, String(enSekund));

  ok("from 100, to 0 ger 100 vid bildruta 0", spring({ frame: 0, fps: 60, from: 100, to: 0 }) === 100);
  ok("from 100, to 0 landar på 0", nara(spring({ frame: 600, fps: 60, from: 100, to: 0 }), 0, 0.1));
  const nedat = heltal(121).map((frame) => spring({ frame, fps: 60, from: 100, to: 0 }));
  ok("from 100, to 0 slår över åt rätt håll (under 0)", Math.min(...nedat) < -10, `min ${Math.min(...nedat).toFixed(2)}`);
  ok("from och to skalar linjärt", nara(spring({ frame: 15, fps: 60, from: 10, to: 30 }), 10 + 20 * spring({ frame: 15, fps: 60 }), 1e-12));
  ok("from lika med to ger from", spring({ frame: 15, fps: 60, from: 7, to: 7 }) === 7);

  // FÖRDRÖJNING: fjädern står stilla till och med bildruta `delay`.
  ok("delay 10 ger 0 vid bildruta 10", spring({ frame: 10, fps: 60, delay: 10 }) === 0);
  ok("delay 10 ger 0 före bildruta 10", spring({ frame: 3, fps: 60, delay: 10 }) === 0);
  ok("delay 10: bildruta 11 är fjäderns bildruta 1", spring({ frame: 11, fps: 60, delay: 10 }) === spring({ frame: 1, fps: 60 }));
  ok("delay och from ger from före starten", spring({ frame: 4, fps: 60, delay: 10, from: 5, to: 9 }) === 5);
  ok("negativ bildruta ger from", spring({ frame: -5, fps: 60 }) === 0);

  ok("en bråkdel av en bildruta stöds", nara(spring({ frame: 10.5, fps: 60 }), (spring({ frame: 10, fps: 60 }) + spring({ frame: 11, fps: 60 })) / 2, 5e-3));
  ok("oändligt långt fram är framme", spring({ frame: Infinity, fps: 60 }) === 1);
  ok("config får vara delvis angiven", spring({ frame: 20, fps: 60, config: { damping: 10 } }) === spring({ frame: 20, fps: 60 }));
  ok("fps 30 ger samma kurva i sekunder", nara(spring({ frame: 15, fps: 30 }), spring({ frame: 30, fps: 60 }), 1e-12));
}

// -----------------------------------------------------------------------------
console.log("\nspring — varje formel mot numerisk integrering");
{
  // Underdämpad och kritisk, lätt och tung massa, och ett par rena ytterlägen. Hårdare
  // dämpning än den kritiska är samma fjäder (Remotions regel), och facit följer den.
  // Alla mot RK4 på varje sjunde bildruta de första tio sekunderna.
  const fall = [
    ["standard (ζ = 0,5)", { damping: 10, mass: 1, stiffness: 100 }],
    ["kritisk (ζ = 1)", { damping: 20, mass: 1, stiffness: 100 }],
    ["ζ = 2, räknas som kritisk (Remotions regel)", { damping: 40, mass: 1, stiffness: 100 }],
    ["ζ = 10, räknas som kritisk (Remotions regel)", { damping: 200, mass: 1, stiffness: 100 }],
    ["ζ = 3 med annan massa och styvhet, räknas som kritisk", { damping: 3 * 2 * Math.sqrt(300 * 2), mass: 2, stiffness: 300 }],
    ["lätt dämpad (ζ = 0,1)", { damping: 2, mass: 1, stiffness: 100 }],
    ["tung och styv (ζ = 0,34)", { damping: 30, mass: 5, stiffness: 400 }],
    ["lätt och mjuk (ζ = 0,95)", { damping: 0.95 * 2 * Math.sqrt(75), mass: 0.5, stiffness: 150 }],
    ["tavlans mjuka fjäder (ζ = 0,9, styvhet 150)", { damping: 0.9 * 2 * Math.sqrt(150), mass: 1, stiffness: 150 }],
    ["odämpad (ζ = 0)", { damping: 0, mass: 1, stiffness: 100 }],
  ];
  for (const [namn, cfg] of fall) {
    const facit = fjaderFacit(cfg, 10);
    let storst = 0;
    for (let frame = 0; frame <= 600; frame += 7) {
      const fel_ = Math.abs(spring({ frame, fps: 60, config: cfg }) - facit[frame * STEG_PER_BILDRUTA]);
      if (fel_ > storst) storst = fel_;
    }
    ok(`${namn} stämmer med integreringen inom 1e-7`, storst < 1e-7, `största felet ${storst.toExponential(2)}`);
  }

  // GRÄNSEN MELLAN FALLEN. Under ζ = 1 gäller den underdämpade formeln, från och med
  // ζ = 1 den kritiska. Svaret ska inte hoppa där de möts, och ingen formel får ge NaN
  // i sin egen ytterkant (den underdämpade har ωd → 0 där).
  const nara1 = [19.9999999, 19.99999999, 20, 20.00000001, 20.0000001];
  const kring = [5, 10, 30, 120].map((frame) => nara1.map((damping) => spring({ frame, fps: 60, config: { damping } })));
  ok("inget NaN eller oändligt kring ζ = 1", kring.flat().every(Number.isFinite));
  ok(
    "ingen hoppning kring ζ = 1 (högst 1e-6 mellan grannarna)",
    kring.every((rad) => Math.max(...rad) - Math.min(...rad) < 1e-6),
    `största spridning ${Math.max(...kring.map((rad) => Math.max(...rad) - Math.min(...rad))).toExponential(2)}`,
  );
  // Kritisk fjäder har en sluten form: 1 - e^(-ω·t)·(1 + ω·t). Vid t = 0,1 s: 1 - 2/e.
  ok(
    "kritisk fjäder vid 0,1 s är 1 - 2/e",
    nara(spring({ frame: 6, fps: 60, config: { damping: 20 } }), 1 - 2 / Math.E, 1e-12),
    String(spring({ frame: 6, fps: 60, config: { damping: 20 } })),
  );
  // Odämpad: 1 - cos(ω·t), som svänger mellan 0 och 2 och aldrig lugnar sig.
  ok(
    "odämpad fjäder vid 0,5 s är 1 - cos(5)",
    nara(spring({ frame: 30, fps: 60, config: { damping: 0 } }), 1 - Math.cos(5), 1e-12),
  );
  // HÅRD DÄMPNING ÄNDRAR INGENTING. Från ζ = 1 är fjädern kritiskt dämpad med ω₀ = √(k/m),
  // så damping 20, 40, 200, 1e5 och 1e9 är exakt samma kurva vid styvhet 100 (och 1e9
  // ger inga ändlighetsproblem, eftersom damping inte ingår i formeln längre).
  const kurva = (config) => [1, 3, 6, 10, 30, 90, 300, 600].map((frame) => spring({ frame, fps: 60, config }));
  const kritisk = kurva({ damping: 20 });
  ok(
    "damping 40, 200, 1e5 och 1e9 är exakt samma kurva som damping 20",
    [40, 200, 1e5, 1e9].every((damping) => kurva({ damping }).every((v, i) => v === kritisk[i])),
  );
  ok("och kurvan är ändlig och stiger jämnt", kritisk.every(Number.isFinite) && kritisk.every((v, i) => i === 0 || v >= kritisk[i - 1]));
  // Det är ω₀ = √(k/m) som styr, inte damping: massa 2 och styvhet 50 ger ω₀ = 5.
  const w0 = Math.sqrt(50 / 2);
  const t = 20 / FPS;
  ok(
    "kritisk kurva med annan massa och styvhet: 1 - e^(-ω₀t)·(1 + ω₀t) med ω₀ = 5",
    nara(spring({ frame: 20, fps: 60, config: { damping: 1000, mass: 2, stiffness: 50 } }), 1 - Math.exp(-w0 * t) * (1 + w0 * t), 1e-12),
    String(spring({ frame: 20, fps: 60, config: { damping: 1000, mass: 2, stiffness: 50 } })),
  );
  // Strax under ζ = 1 studsar fjädern lite; från ζ = 1 gör den inte det. Kurvan är sammanhängande över gränsen.
  const nastanKritisk = Math.max(...heltal(301).map((frame) => spring({ frame, fps: 60, config: { damping: 19 } })));
  ok("ζ = 0,95 studsar en aning (max > 1) och ζ = 1 gör det inte (max ≤ 1)", nastanKritisk > 1 && Math.max(...kritisk) <= 1, `max ${nastanKritisk.toFixed(5)}`);
}

// -----------------------------------------------------------------------------
console.log("\nspring — overshootClamping");
{
  const klamd = heltal(301).map((frame) => spring({ frame, fps: 60, config: { overshootClamping: true } }));
  ok("klamd fjäder går aldrig över målet", Math.max(...klamd) <= 1);

  // Som i Remotion och React Native stannar fjädern vid målet i samma stund den
  // först når det. Den får inte klippas ovanifrån och sedan svänga tillbaka under:
  // första passagen sker vid (π/2 + asin ζ)/ωd = 0,2418 s, alltså mellan bildruta 14 och 15.
  ok("bildruta 14 är fortfarande på väg", klamd[14] < 1, String(klamd[14]));
  ok("bildruta 15 är framme", klamd[15] === 1, String(klamd[15]));
  ok("och stannar där (ingen svängning tillbaka)", klamd.slice(15).every((v) => v === 1));
  ok("före passagen är den klamda fjädern den vanliga", klamd.slice(0, 15).every((v, i) => v === spring({ frame: i, fps: 60 })));
  ok(
    "klamning nedåt: from 100, to 0 stannar på 0",
    heltal(301).every((frame) => spring({ frame, fps: 60, from: 100, to: 0, config: { overshootClamping: true } }) >= 0),
  );
  // En fjäder som inte slår över (ζ ≥ 1, alltså kritisk) påverkas inte av klamningen.
  ok(
    "klamning ändrar inget för en fjäder med ζ ≥ 1",
    spring({ frame: 40, fps: 60, config: { damping: 40, overshootClamping: true } }) === spring({ frame: 40, fps: 60, config: { damping: 40 } }),
  );
}

// -----------------------------------------------------------------------------
console.log("\nspring — durationInFrames och measureSpring");
{
  // BRIEF: vid bildruta 30 ska en fjäder med durationInFrames 30 vara inom 0,5 %.
  const v30 = spring({ frame: 30, fps: 60, durationInFrames: 30 });
  ok("durationInFrames 30: |spring(30) - 1| < 0,005", Math.abs(v30 - 1) < 0.005, String(v30));
  ok("durationInFrames 30 börjar på 0", spring({ frame: 0, fps: 60, durationInFrames: 30 }) === 0);

  // För varje fjäder och längd: inom tröskeln vid längden, för alla bildrutor efter,
  // och inte redan klar långt före (annars vore tiden för mycket skalad).
  const configs = [
    { damping: 10 },
    { damping: 20 },
    { damping: 40 },
    { damping: 200 },
    { damping: 3 },
    { damping: 24, stiffness: 150 },
    { damping: 30, mass: 5, stiffness: 400 },
  ];
  let alla = true;
  let efter = true;
  const varfor = [];
  for (const config of configs) {
    for (const langd of [6, 12, 30, 45, 90, 240]) {
      const vid = (frame) => spring({ frame, fps: 60, config, durationInFrames: langd });
      if (!(Math.abs(vid(langd) - 1) < 0.005)) {
        alla = false;
        varfor.push(`${JSON.stringify(config)} ${langd}: ${vid(langd)}`);
      }
      for (let frame = langd; frame <= langd * 4; frame++) {
        if (!(Math.abs(vid(frame) - 1) < 0.005)) {
          efter = false;
          varfor.push(`efter: ${JSON.stringify(config)} ${langd}@${frame}: ${vid(frame)}`);
          break;
        }
      }
    }
  }
  ok("inom 0,5 % vid durationInFrames för 7 fjädrar × 6 längder", alla, varfor.slice(0, 2).join(" | "));
  ok("och förblir inom 0,5 % för alla bildrutor efter", efter, varfor.slice(0, 2).join(" | "));

  // measureSpring ska hitta den SISTA bildrutan utanför tröskeln, inte den första inom
  // den: en studsande fjäder är inom 0,5 % flera gånger innan den stannar. Facit är
  // integreringen: sista steget där |u - 1| ≥ 0,005.
  let measureOk = true;
  const rader = [];
  for (const cfg of [
    { damping: 10, mass: 1, stiffness: 100 },
    { damping: 20, mass: 1, stiffness: 100 },
    { damping: 40, mass: 1, stiffness: 100 },
    { damping: 2, mass: 1, stiffness: 100 },
    { damping: 24, mass: 1, stiffness: 150 },
    { damping: 30, mass: 5, stiffness: 400 },
  ]) {
    const u = fjaderFacit(cfg, 30);
    let sista = 0;
    for (let i = 0; i < u.length; i++) if (Math.abs(u[i] - 1) >= 0.005) sista = i;
    const facitRutor = Math.floor(sista / STEG_PER_BILDRUTA) + 1;
    const mat = measureSpring({ fps: 60, config: cfg });
    rader.push(`${cfg.damping}/${cfg.mass}/${cfg.stiffness}: ${mat} mot ${facitRutor}`);
    if (Math.abs(mat - facitRutor) > 1) measureOk = false;
  }
  ok("measureSpring stämmer med integreringen inom en bildruta", measureOk, rader.join("; "));

  // damping 200 är Remotions "ingen studs" och räknas som kritisk (ω₀ = 10): till ro efter
  // 0,74 s, alltså 45 bildrutor, och exakt som damping 20. Som fysiskt överdämpad hade
  // det tagit 635 bildrutor, och varje komposition med den förinställningen blivit seg.
  const mat200 = measureSpring({ fps: 60, config: { damping: 200 } });
  ok("damping 200 kommer till ro på 45 bildrutor (0,74 s), inte 635", Math.abs(mat200 - 45) <= 1, String(mat200));
  ok("och exakt som damping 20, den kritiska", mat200 === measureSpring({ fps: 60, config: { damping: 20 } }));

  const standardRutor = measureSpring({ fps: 60 });
  // Räknat för hand: tredje vändpunkten (0,0043) är redan under 0,005, den andra (0,0266)
  // inte, och |e| passerar 0,005 på väg ner strax efter bildruta 55 (cirka 0,92 s). Första
  // hela bildruta efter det är 56. Integreringen ovan ger samma tal.
  ok("measureSpring för standardfjädern är ca 0,92 s, 56 bildrutor", standardRutor >= 55 && standardRutor <= 57, String(standardRutor));
  ok("och 28 bildrutor vid 30 bilder per sekund", Math.abs(measureSpring({ fps: 30 }) - 28) <= 1, String(measureSpring({ fps: 30 })));
  ok("fler bildrutor per sekund ger proportionellt fler", Math.abs(measureSpring({ fps: 120 }) - 2 * standardRutor) <= 2);
  ok("en större tröskel ger kortare tid", measureSpring({ fps: 60, threshold: 0.05 }) < standardRutor);
  ok(
    "durationRestThreshold styr hur nära slutet fjädern ska vara",
    Math.abs(spring({ frame: 30, fps: 60, durationInFrames: 30, durationRestThreshold: 0.05 }) - 1) < 0.05,
  );
  ok(
    "klamd fjäder är klar vid första passagen eller förr",
    measureSpring({ fps: 60, config: { overshootClamping: true } }) <= 15,
    String(measureSpring({ fps: 60, config: { overshootClamping: true } })),
  );

  // durationInFrames räknas från fjäderns start, alltså efter delay.
  const medDelay = spring({ frame: 40, fps: 60, delay: 10, durationInFrames: 30 });
  ok("delay och durationInFrames: framme 30 bildrutor efter starten", Math.abs(medDelay - 1) < 0.005, String(medDelay));
  ok("och stilla före starten", spring({ frame: 9, fps: 60, delay: 10, durationInFrames: 30 }) === 0);

  ok("durationInFrames 0 kastar", kastar(() => spring({ frame: 1, fps: 60, durationInFrames: 0 })));
  ok("negativ durationInFrames kastar", kastar(() => spring({ frame: 1, fps: 60, durationInFrames: -5 })));
  ok("oändlig durationInFrames kastar", kastar(() => spring({ frame: 1, fps: 60, durationInFrames: Infinity })));
  ok("durationInFrames utan dämpning kastar (kommer aldrig till ro)", kastar(() => spring({ frame: 1, fps: 60, durationInFrames: 30, config: { damping: 0 } })));
}

// -----------------------------------------------------------------------------
console.log("\nspring — kontroller");
{
  ok("fps 0 kastar", kastar(() => spring({ frame: 1, fps: 0 })));
  ok("negativ fps kastar", kastar(() => spring({ frame: 1, fps: -60 })));
  ok("NaN som fps kastar", kastar(() => spring({ frame: 1, fps: NaN })));
  ok("mass 0 kastar", kastar(() => spring({ frame: 1, fps: 60, config: { mass: 0 } })));
  ok("stiffness 0 kastar", kastar(() => spring({ frame: 1, fps: 60, config: { stiffness: 0 } })));
  ok("negativ damping kastar", kastar(() => spring({ frame: 1, fps: 60, config: { damping: -1 } })));
  ok("NaN i config kastar", kastar(() => spring({ frame: 1, fps: 60, config: { damping: NaN } })));
  ok("tröskeln måste ligga mellan 0 och 1", kastar(() => measureSpring({ fps: 60, threshold: 0 })) && kastar(() => measureSpring({ fps: 60, threshold: 1 })));
}

// -----------------------------------------------------------------------------
console.log("\nSequence — fönstret och förskjutningen");
{
  // Barnen ser `frame - from`, och finns bara från `from` till men inte med `from + längd`.
  ok("före from: inget", sekvensFonster(9, 10) === null);
  ok("vid from: barnets bildruta 0", sekvensFonster(10, 10) === 0);
  ok("efter from: förskjuten", sekvensFonster(25, 10) === 15);
  ok("utan längd finns barnen för alltid", sekvensFonster(1e9, 10) === 1e9 - 10);
  ok("sista bildrutan i fönstret (from 10, längd 30): 39 → 29", sekvensFonster(39, 10, 30) === 29);
  ok("första bildrutan efter fönstret: 40 → inget", sekvensFonster(40, 10, 30) === null);
  ok("längd 1 ger exakt en bildruta", sekvensFonster(10, 10, 1) === 0 && sekvensFonster(11, 10, 1) === null);
  ok("from 0 är en genomsläpning", sekvensFonster(7, 0) === 7);

  // NEGATIVT from är tillåtet i Remotion: sekvensen är redan igång när filmen börjar.
  ok("negativt from: barnet är redan igång vid bildruta 0", sekvensFonster(0, -10) === 10);
  ok("negativt from: fönstret räknas från from", sekvensFonster(19, -10, 30) === 29 && sekvensFonster(20, -10, 30) === null);

  // SEKVENSER I SEKVENSER: det inre from är relativt det yttre, eftersom det yttre
  // redan förskjutit bildrutan. Komponerar man två fönster blir förskjutningarna summan.
  const yttre = sekvensFonster(100, 40);
  ok("inre sekvens ser den yttres bildruta", yttre === 60 && sekvensFonster(yttre, 20) === 40);
  ok("är den yttre ännu inte igång syns inte den inre", sekvensFonster(sekvensFonster(30, 40) ?? -1, 0) === null);

  ok("bråkdels-from kastar (som Remotion)", kastar(() => sekvensFonster(5, 1.5)));
  ok("NaN som from kastar", kastar(() => sekvensFonster(5, NaN)));
  ok("oändligt from kastar", kastar(() => sekvensFonster(5, Infinity)));
  ok("längd 0 kastar", kastar(() => sekvensFonster(5, 0, 0)));
  ok("negativ längd kastar", kastar(() => sekvensFonster(5, 0, -3)));
  ok("NaN som längd kastar", kastar(() => sekvensFonster(5, 0, NaN)));
  ok("Infinity är den tillåtna 'för alltid'", sekvensFonster(5, 0, Infinity) === 5);

  // EN BRÅKDELSLÄNGD KASTAR INTE. Längden räknas ofta ur sekunder (0,5 s · 61 bilder/s),
  // och ett kast i en kompositions rendering tömmer hela tavlan på en TV som ingen rör.
  // Fönstret är detsamma som för heltal: barnet finns så länge den lokala bildrutan är
  // mindre än längden. Med 30,5 syns alltså lokala bildrutor 0–30, och 31 är borta.
  ok(
    "längd 30,5: lokal bildruta 30 syns, 31 inte",
    sekvensFonster(30, 0, 30.5) === 30 && sekvensFonster(31, 0, 30.5) === null,
    `${sekvensFonster(30, 0, 30.5)} och ${sekvensFonster(31, 0, 30.5)}`,
  );
  ok(
    "längd 30,5 efter from 10: absoluta bildrutor 10–40 syns, 41 inte",
    sekvensFonster(10, 10, 30.5) === 0 && sekvensFonster(40, 10, 30.5) === 30 && sekvensFonster(41, 10, 30.5) === null,
  );
  ok("längd 2,5 ger bildrutorna 0, 1 och 2", [0, 1, 2].every((i) => sekvensFonster(i, 0, 2.5) === i) && sekvensFonster(3, 0, 2.5) === null);
  ok("längd under en bildruta (0,5) är giltig: bildruta 0 syns", sekvensFonster(0, 0, 0.5) === 0 && sekvensFonster(1, 0, 0.5) === null);
  ok("en heltalslängd beter sig som förut", sekvensFonster(39, 10, 30) === 29 && sekvensFonster(40, 10, 30) === null);
}

// -----------------------------------------------------------------------------
console.log("\nSpelaren — klockan styr");
{
  const START = { bildruta: 0, klar: false };
  const T = 444; // en vanlig order: 7,4 s

  const noll = stegaSpelare(START, 0, T);
  ok("vid klockans noll visas bildruta 0, inte klar", noll.bildruta === 0 && !noll.klar && !noll.nyligenKlar);
  ok("bildrutan är Math.floor(klocka·FPS)", stegaSpelare(START, 1.0, T).bildruta === 60 && stegaSpelare(START, 1.0166, T).bildruta === 60 && stegaSpelare(START, 1.0167, T).bildruta === 61);
  ok("halv bildruta rundas nedåt", stegaSpelare(START, 0.025, T).bildruta === 1);
  ok("negativ klocka visar bildruta 0", stegaSpelare(START, -3, T).bildruta === 0);

  // EN LÅNGSAM ENHET: 14 målningar per sekund. Bildrutan ska följa klockan, inte
  // antalet målningar: efter 3,621 s står den på bildruta 217, inte 51.
  {
    let s = START;
    let efterfragad = [];
    let bakat = false;
    let klarVid = [];
    const visade = new Set();
    for (let ms = 0; ms <= 8000; ms += 71) {
      const steg = stegaSpelare(s, ms / 1000, T);
      if (steg.bildruta < s.bildruta) bakat = true;
      if (steg.bildruta !== Math.min(Math.floor((ms / 1000) * FPS), T - 1)) efterfragad.push(ms);
      if (steg.nyligenKlar) klarVid.push(ms);
      visade.add(steg.bildruta);
      s = { bildruta: steg.bildruta, klar: steg.klar };
    }
    ok("följer klockan vid 14 målningar/s, varje gång", efterfragad.length === 0, efterfragad.slice(0, 3).join(","));
    ok("tappar bildrutor i stället för att sakta ner", visade.size < T / 3, `${visade.size} av ${T} bildrutor visades`);
    ok("går aldrig bakåt", !bakat);
    const forsta = [...Array(8001).keys()].filter((ms) => ms % 71 === 0).find((ms) => Math.floor((ms / 1000) * FPS) >= T);
    ok("klar slår om exakt en gång", klarVid.length === 1, klarVid.join(","));
    ok("och vid första målningen efter 7,4 s", klarVid[0] === forsta, `${klarVid[0]} mot ${forsta}`);
    ok("sista visade bildruta är varaktighet - 1", s.bildruta === T - 1 && s.klar);
  }

  // EN SNABB ENHET: 240 målningar per sekund ger ändå en klar och aldrig en bildruta över slutet.
  {
    let s = START;
    let klara = 0;
    let hogsta = 0;
    for (let ms = 0; ms <= 9000; ms += 1000 / 240) {
      const steg = stegaSpelare(s, ms / 1000, T);
      if (steg.nyligenKlar) klara++;
      hogsta = Math.max(hogsta, steg.bildruta);
      s = { bildruta: steg.bildruta, klar: steg.klar };
    }
    ok("240 målningar/s: klar exakt en gång", klara === 1, String(klara));
    ok("och bildrutan stannar på den sista", hogsta === T - 1, String(hogsta));
  }

  // KLOCKAN KAN GÅ BAKÅT: ljudklockan och performance.now() är två olika klockor, och
  // en av dem kan byta ut den andra mitt i ett firande. Bildrutan får inte backa.
  {
    let s = START;
    const sett = [];
    for (const klocka of [1.0, 0.4, 0.9, 1.5, 0.0, 1.6]) {
      const steg = stegaSpelare(s, klocka, T);
      sett.push(steg.bildruta);
      s = { bildruta: steg.bildruta, klar: steg.klar };
    }
    ok("backande klocka: bildrutan står still, sedan går den vidare", sett.join(",") === "60,60,60,90,90,96", sett.join(","));
  }

  // Klockan sätts en hundradels bildruta in i bildrutan, så att flyttalsfel i n/60·60
  // inte avgör om provet står på rätt sida om kanten.
  const strax = (rutor) => (rutor + 0.01) / FPS;
  ok("vid varaktigheten är den klar", stegaSpelare({ bildruta: 443, klar: false }, strax(444), T).nyligenKlar);
  ok("en bildruta före är den inte klar", !stegaSpelare({ bildruta: 442, klar: false }, strax(443), T).klar);
  ok("och visar då den sista bildrutan", stegaSpelare({ bildruta: 442, klar: false }, strax(443), T).bildruta === 443);
  const efterKlar = stegaSpelare({ bildruta: 443, klar: true }, 20, T);
  ok("efter klar är nyligenKlar falskt", efterKlar.klar && !efterKlar.nyligenKlar && efterKlar.bildruta === 443);

  // OGILTIGA KLOCKVÄRDEN. En klocka som ger NaN (till exempel en ljudklocka som inte
  // startat) ska inte krascha och inte avsluta förloppet.
  const nan = stegaSpelare({ bildruta: 12, klar: false }, NaN, T);
  ok("NaN från klockan ändrar ingenting", nan.bildruta === 12 && !nan.klar && !nan.nyligenKlar);
  const oandlig = stegaSpelare(START, Infinity, T);
  ok("oändlig klocka är slutet", oandlig.klar && oandlig.nyligenKlar && oandlig.bildruta === T - 1);

  // OGILTIGA LÄNGDER. Ett firande som inte kan räkna ut sin längd avslutas direkt i
  // stället för att hänga på tavlan för alltid.
  const noll_ = stegaSpelare(START, 0, 0);
  ok("varaktighet 0: klar vid första steget, bildruta 0", noll_.klar && noll_.nyligenKlar && noll_.bildruta === 0);
  ok("negativ varaktighet: klar direkt", stegaSpelare(START, 0, -5).nyligenKlar);
  ok("NaN som varaktighet: klar direkt", stegaSpelare(START, 0, NaN).nyligenKlar);
  ok("oändlig varaktighet blir aldrig klar", !stegaSpelare(START, 1e6, Infinity).klar && stegaSpelare(START, 1e6, Infinity).bildruta === 6e7);
  ok(
    "en bråkdelslängd (444,5) visar 445 bildrutor, 0–444",
    stegaSpelare(START, strax(444), 444.5).bildruta === 444 &&
      !stegaSpelare(START, strax(444), 444.5).klar &&
      stegaSpelare(START, strax(445), 444.5).klar,
  );
}

console.log(fel === 0 ? "\n\x1b[32mAllt grönt.\x1b[0m\n" : `\n\x1b[31m${fel} fel.\x1b[0m\n`);
process.exit(fel ? 1 : 0);
