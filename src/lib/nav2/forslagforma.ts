/**
 * Hemvyn: reglerna för förslag, facit och domar (designdokumentet 1.3–1.7).
 *
 * Allt här är rena funktioner. Jobben läser raderna och skriver i loggen;
 * reglerna ligger här, så att varje gränsfall går att prova utan databas.
 *
 * TRE SAKER SOM ALDRIG FÅR HÄNDA, och som den här filen vaktar:
 *   - Ett facit där Nav nästan alltid får rätt. Därför ingen gissning per möte,
 *     och "låt stå" och "ingen valde" räknas på samma sätt som de andra valen.
 *   - En dom på för få möten, eller som prövats så ofta att slumpen till slut
 *     ger utslag. Därför ges domar bara vid fasta antal (vart tionde möte för
 *     facit, 20 och 40 möten för en ändring).
 *   - Ett facit om en enskild person. Står en person för mer än hälften av
 *     mötena i ett val visas antalen men ingen dom.
 */
import { bekraftelseFonster, lokalDag, lokalKlockan, nastaArbetsdag, omfattas, skaBekraftas } from "./motesflode.ts";
import { fisherEnsidig, tidigastVid, type NAv } from "./statistik.ts";
import { nivaFor } from "./forma.ts";

const TIMME = 3_600_000;

/* ------------------------------------------------------------------------ */
/* Första kedjan: ett möte som inte är bekräftat (1.3)                       */
/* ------------------------------------------------------------------------ */

export type ForslagMote = {
  id: string;
  moteTid: string;
  /** När mötet bokades eller senast flyttades: avgör sista bekräftelsedagen. */
  senastAndrad: string;
  hallsAv: string;
  bokatAv: string;
  art: string;
  bekraftat: boolean;
  /** När mötet bekräftades. Saknas den räknas en bekräftelse som gjord före mötet. */
  bekraftatNar?: string | null;
  utfall: string | null;
  utfallNar?: string | null;
};

export type NyttForslag = {
  moteId: string;
  /** Den som håller mötet: förslaget går dit, inte till den som bokade. */
  om: string;
  nyckel: string;
  /** Arbetsdagen efter mötet. */
  domsDag: string;
  /** Mötets start. Har ingen valt då sparas "ingen valde". */
  utgar: string;
};

export type ObekraftatInst = { tid: string; bekraftaDagar: number; tz: string; gallerFran: string | null };

/**
 * Nyckeln bär mötet, mötesdagen och hållaren. Flyttas mötet eller byter det
 * hållare blir det gamla förslaget inaktuellt, och det nya läget får en egen
 * rad i stället för att krocka med den gamla.
 */
export function forslagNyckel(m: Pick<ForslagMote, "id" | "moteTid" | "hallsAv">, tz: string): string {
  return `${m.id}@${lokalDag(m.moteTid, tz)}@${m.hallsAv}`;
}

export function nyckelDelar(nyckel: string): { mote: string; dag: string; om: string } | null {
  const d = nyckel.split("@");
  if (d.length !== 3 || !d[0] || !d[2] || !/^\d{4}-\d{2}-\d{2}$/.test(d[1])) return null;
  return { mote: d[0], dag: d[1], om: d[2] };
}

/**
 * Vilka möten ska bli ett förslag just nu?
 *
 * Ett första möte som fortfarande är obekräftat på sin sista bekräftelsedag
 * (`senast` ur `bekraftelseFonster`) när klockan når `inst.tid`. Är sista dagen
 * mötesdagen gäller det tidigaste av klockslaget och två timmar före mötet. Är
 * det mindre än en timme kvar skapas inget: då hinner ingen göra något.
 *
 * Missade jobbet sista dagen kommer förslaget ändå nästa gång det går, fram
 * till en timme före mötet. Samma anrop två gånger ger samma lista; att raden
 * inte skrivs två gånger sköter nyckeln i databasen.
 */
export function obekraftadeAttForesla(
  moten: readonly ForslagMote[], aktiva: ReadonlySet<string>, nu: Date, inst: ObekraftatInst,
): NyttForslag[] {
  const idag = lokalDag(nu, inst.tz);
  const klockan = lokalKlockan(nu, inst.tz);
  const ut: NyttForslag[] = [];
  for (const m of moten) {
    if (!omfattas(m.moteTid, inst.gallerFran)) continue;
    if (!skaBekraftas(m.art) || m.bekraftat || m.utfall) continue;
    if (!aktiva.has(m.hallsAv)) continue;
    const start = Date.parse(m.moteTid);
    if (!Number.isFinite(start) || start - nu.getTime() < TIMME) continue;
    const f = bekraftelseFonster({ moteTid: m.moteTid, senastAndrad: m.senastAndrad, dagar: inst.bekraftaDagar, tz: inst.tz });
    if (idag < f.senast) continue;
    const motesdag = lokalDag(m.moteTid, inst.tz);
    if (idag === f.senast) {
      let tid = inst.tid;
      if (f.senast === motesdag) {
        const tvaFore = new Date(start - 2 * TIMME);
        const fore = lokalDag(tvaFore, inst.tz) === motesdag ? lokalKlockan(tvaFore, inst.tz) : "00:00";
        if (fore < tid) tid = fore;
      }
      if (klockan < tid) continue;
    }
    ut.push({
      moteId: m.id,
      om: m.hallsAv,
      nyckel: forslagNyckel(m, inst.tz),
      domsDag: nastaArbetsdag(motesdag),
      utgar: new Date(start).toISOString(),
    });
  }
  return ut;
}

/**
 * Har ett förslag som ingen valt i blivit inaktuellt? Mötet är flyttat till en
 * annan dag, har fått en annan hållare, är bekräftat, har fått ett utfall eller
 * finns inte längre. Då lämnar förslaget kortet.
 */
export function inaktuellt(nyckel: string, m: ForslagMote | null, tz: string): boolean {
  const d = nyckelDelar(nyckel);
  if (!d || !m) return true;
  return lokalDag(m.moteTid, tz) !== d.dag || m.hallsAv !== d.om || m.bekraftat || m.utfall !== null;
}

/**
 * Läget för ett förslag som ingen har valt i:
 *   - `oppet`: står kvar i kortet.
 *   - `inaktuellt`: det fanns inget kvar att välja före mötet. Räknas inte i facit.
 *   - `ingen`: mötet började utan att någon valde. RÄKNAS i facit, också när
 *     mötet sedan hölls. Annars ser allt Nav lägger fram ut att hjälpa.
 * En bekräftelse eller en avbokning efter mötets start gör inte förslaget
 * inaktuellt: då hade ingen valt när det gällde.
 */
export function oppetLage(nyckel: string, utgar: string, m: ForslagMote | null, nu: Date, tz: string): "oppet" | "inaktuellt" | "ingen" {
  const d = nyckelDelar(nyckel);
  if (!d || !m) return "inaktuellt";
  if (lokalDag(m.moteTid, tz) !== d.dag || m.hallsAv !== d.om) return "inaktuellt";
  const start = Date.parse(utgar);
  const fore = (nar: string | null | undefined) => !nar || Date.parse(nar) < start;
  if (m.bekraftat && fore(m.bekraftatNar)) return "inaktuellt";
  if (m.utfall === "avbokat" && fore(m.utfallNar)) return "inaktuellt";
  if (nu.getTime() >= start) return "ingen";
  return m.utfall !== null ? "inaktuellt" : "oppet";
}

/* ------------------------------------------------------------------------ */
/* Domen och Navs facit (1.4)                                                */
/* ------------------------------------------------------------------------ */

export type Val = "ringer-sjalv" | "flytta" | "lat-sta";
export type Beslut = Val | "ingen" | "inaktuellt";
export type MotesUtfall = "hallet" | "uteblev" | "avbokat" | "flyttat" | "okant";

/**
 * Utfallet för ett förslags möte. null = utfallet är inte satt än ("Jag dömer
 * när det är det"). Ett möte som flyttats till en annan dag efter valet har
 * inget utfall den dagen och räknas för sig.
 */
export function utfallFor(nyckel: string, m: Pick<ForslagMote, "moteTid" | "utfall"> | null, tz: string): MotesUtfall | null {
  const d = nyckelDelar(nyckel);
  if (!d || !m) return "okant";
  if (lokalDag(m.moteTid, tz) !== d.dag) return "flyttat";
  return m.utfall === "hallet" || m.utfall === "uteblev" || m.utfall === "avbokat" ? m.utfall : null;
}

export type FacitRad = { beslut: Beslut; utfall: MotesUtfall; om: string; /** Tidpunkt att ordna raderna efter (mötets tid). */ dag: string };
type Delning = { hallet: number; uteblev: number; avbokat: number };
export type Facit = {
  /** Hållna av avgjorda (hållna, uteblivna och avbokade), per val. Alltid de senaste talen. */
  per: Record<Val | "ingen", NAv>;
  detalj: Record<Val | "ingen", Delning>;
  /** Möten där valet var att flytta. De har inget utfall samma dag. */
  flyttade: number;
  dom: {
    /** `tomt` = inget att jämföra. `en-person` = utslag, men det vore ett facit om en person. */
    sort: "utslag" | "for-fa" | "en-person" | "tomt";
    p: number | null;
    /** Tidigast vid så många möten kan det bli ett utslag, om skillnaden håller. */
    tidigast: number | null;
    /** Antalet möten domen räknades på (ett jämnt tiotal). 0 = ingen dom än. */
    vid: number;
  };
};

const AVGJORT: ReadonlySet<string> = new Set(["hallet", "uteblev", "avbokat"]);
const tomDelning = (): Delning => ({ hallet: 0, uteblev: 0, avbokat: 0 });
const somNAv = (d: Delning): NAv => ({ n: d.hallet, av: d.hallet + d.uteblev + d.avbokat });
const STEG = 10;

/** Står en person för mer än hälften av raderna? */
const enDominerar = (rader: FacitRad[]): boolean => {
  const per = new Map<string, number>();
  for (const r of rader) per.set(r.om, (per.get(r.om) ?? 0) + 1);
  return [...per.values()].some((n) => n > rader.length / 2);
};

const hallna = (l: FacitRad[]): NAv => ({ n: l.filter((r) => r.utfall === "hallet").length, av: l.length });
const arJamford = (r: FacitRad): boolean => AVGJORT.has(r.utfall) && (r.beslut === "ringer-sjalv" || r.beslut === "lat-sta");
/** De `vid` första jämförda mötena i tidsordning, delade på de två valen som jämförs. */
const deForsta = (jamforda: readonly FacitRad[], vid: number): { ringde: FacitRad[]; lat: FacitRad[] } => {
  const da = [...jamforda].sort((a, b) => Date.parse(a.dag) - Date.parse(b.dag)).slice(0, vid);
  return { ringde: da.filter((r) => r.beslut === "ringer-sjalv"), lat: da.filter((r) => r.beslut === "lat-sta") };
};

/**
 * Talen en dom räknades på: de `vid` första jämförda mötena. Nattjobbet sparar
 * dem bredvid domen, så att facits historia går att läsa i efterhand.
 */
export function facitVid(rader: readonly FacitRad[], vid: number): { hog: NAv; lag: NAv } {
  const { ringde, lat } = deForsta(rader.filter(arJamford), vid);
  return { hog: hallna(ringde), lag: hallna(lat) };
}

/**
 * Navs facit per val, över hela laget.
 *
 * Jämförelsen är bestämd i förväg: ringde själv mot lät stå. "Ingen valde" står
 * bredvid men ingår inte i domen. Ett avbokat möte räknas som inte hållet: ett
 * samtal som får kunden att avboka ska inte försvinna ur nämnaren och få
 * samtalen att se bättre ut än de är. Delningen står i `detalj`.
 *
 * DOMEN GES VID VART TIONDE MÖTE, på de möten som fanns då (de första i
 * tidsordning), inte på nytt varje gång någon tittar. Antalen i `per` är alltid
 * de senaste. Före tio möten ges ingen dom alls.
 */
export function facitPerVal(rader: readonly FacitRad[], grans: number): Facit {
  const detalj: Facit["detalj"] = { "ringer-sjalv": tomDelning(), flytta: tomDelning(), "lat-sta": tomDelning(), ingen: tomDelning() };
  let flyttade = 0;
  const jamforda: FacitRad[] = [];
  for (const r of rader) {
    if (r.beslut === "inaktuellt") continue;
    if (r.beslut === "flytta") flyttade++;
    if (!AVGJORT.has(r.utfall)) continue;
    detalj[r.beslut][r.utfall as keyof Delning]++;
    if (r.beslut === "ringer-sjalv" || r.beslut === "lat-sta") jamforda.push(r);
  }
  const per: Facit["per"] = {
    "ringer-sjalv": somNAv(detalj["ringer-sjalv"]), flytta: somNAv(detalj.flytta), "lat-sta": somNAv(detalj["lat-sta"]), ingen: somNAv(detalj.ingen),
  };
  const hog = per["ringer-sjalv"];
  const lag = per["lat-sta"];
  if (hog.av === 0 || lag.av === 0) return { per, detalj, flyttade, dom: { sort: "tomt", p: null, tidigast: null, vid: 0 } };

  const vid = Math.floor(jamforda.length / STEG) * STEG;
  if (vid >= STEG) {
    const { ringde, lat } = deForsta(jamforda, vid);
    const p = fisherEnsidig(hallna(ringde), hallna(lat));
    if (p <= grans) {
      const sort = enDominerar(ringde) || enDominerar(lat) ? "en-person" : "utslag";
      return { per, detalj, flyttade, dom: { sort, p, tidigast: null, vid } };
    }
  }
  const t = tidigastVid(hog, lag, grans);
  const nastaTiotal = (Math.floor(jamforda.length / STEG) + 1) * STEG;
  return { per, detalj, flyttade, dom: { sort: "for-fa", p: fisherEnsidig(hog, lag), tidigast: t === null ? null : Math.max(t, nastaTiotal), vid } };
}

/** Har antalet avgjorda möten passerat ett nytt tiotal sedan domen senast sparades? */
export function facitDags(nuAvgjorda: number, vidSenaste: number): boolean {
  return Math.floor(nuAvgjorda / STEG) > Math.floor(vidSenaste / STEG);
}

/**
 * Raden "hittills" i ett förslag: är obekräftade möten för få för att säga något
 * om? Samma prov och samma gräns som facit, mot de bekräftade mötena.
 */
export function forFaAttSaga(obekraftade: NAv, bekraftade: NAv, grans: number): boolean {
  return fisherEnsidig(bekraftade, obekraftade) > grans;
}

/**
 * Det Nav trodde, avstämt i klump: "Jag räknade med att 9 av 20 skulle hållas.
 * Det blev 11." Aldrig per möte, och först när minst 20 dömda rader har ett
 * `trodde`. Ett enda möte går inte att gissa utan att nästan alltid få rätt.
 */
export function troddeAvstamning(
  rader: readonly { trodde: NAv | null; utfall: MotesUtfall }[],
): { raknade: number; av: number; blev: number } | null {
  const med = rader.filter((r) => r.trodde && r.trodde.av > 0 && AVGJORT.has(r.utfall));
  if (med.length < 20) return null;
  const raknade = Math.round(med.reduce((s, r) => s + r.trodde!.n / r.trodde!.av, 0));
  return { raknade, av: med.length, blev: med.filter((r) => r.utfall === "hallet").length };
}

/* ------------------------------------------------------------------------ */
/* Domen över en ändring (1.5)                                               */
/* ------------------------------------------------------------------------ */

export type AndringIn = {
  /** De 40 senaste avgjorda mötena före ändringen. */
  fore: NAv;
  /** Mötena efter ändringen VID KONTROLLPUNKTEN (`kollpunkt`): de 20 eller 40 första. */
  efter: NAv;
  motFore: NAv;
  motEfter: NAv;
  /** Resten av laget samma veckor. null när ändringen gäller hela laget. */
  resten: { fore: NAv; efter: NAv } | null;
  /** Hela veckor sedan ändringen. */
  veckor: number;
  battre: "upp" | "ned";
  motBattre: "upp" | "ned";
  grans: number;
  gransMotvikt: number;
};

export type AndringDom = {
  sort: "inget-fore" | "for-tidigt" | "ser-bra-ut" | "battre-men" | "ser-samre-ut" | "ingen-skillnad" | "for-fa";
  /** Raden har fått sitt slut och stäms inte av igen. */
  stangd: boolean;
  restenOcksa: boolean;
  helaLaget: boolean;
};

const MINST_FORE = 20;
const KOLL = [20, 40] as const;
const SISTA_VECKAN = 12;

/**
 * Vid vilket antal möten efter ändringen domen prövas: de 20 första, sedan de
 * 40 första. Jobbet klipper raderna här innan det räknar måttet, så att samma
 * möten inte prövas om vecka efter vecka.
 */
export function kollpunkt(antalEfter: number): 0 | 20 | 40 {
  return antalEfter >= KOLL[1] ? KOLL[1] : antalEfter >= KOLL[0] ? KOLL[0] : 0;
}

const andel = (x: NAv): number => (x.av === 0 ? 0 : x.n / x.av);

/**
 * Domen över en ändring, enligt tabellen i 1.5.
 *
 * Gränsen delas på de två tillfällena (halva gränsen per tillfälle), så att
 * hela risken för en falsk dom håller sig vid den inställda gränsen. Varje rad
 * får ett slut, och slutet skiljer på "vi såg efter och det syntes inget" och
 * "det blev aldrig tillräckligt många". Formuleringen är "ser bra ut", aldrig
 * "fungerar": en ändring anmäls ofta när talen är dåliga, och dåliga tal rättar
 * ofta till sig av sig själva. Därför står resten av laget bredvid.
 */
export function domAndring(i: AndringIn): AndringDom {
  const helaLaget = i.resten === null;
  const svar = (sort: AndringDom["sort"], stangd: boolean, restenOcksa = false): AndringDom => ({ sort, stangd, restenOcksa, helaLaget });
  const sent = i.veckor >= SISTA_VECKAN;
  if (i.fore.av < MINST_FORE) return svar("inget-fore", sent);
  if (i.efter.av < KOLL[0]) return sent ? svar("for-fa", true) : svar("for-tidigt", false);

  const g = i.grans / KOLL.length;
  const pBattre = i.battre === "ned" ? fisherEnsidig(i.fore, i.efter) : fisherEnsidig(i.efter, i.fore);
  const pSamre = i.battre === "ned" ? fisherEnsidig(i.efter, i.fore) : fisherEnsidig(i.fore, i.efter);

  const d = andel(i.efter) - andel(i.fore);
  const r = i.resten;
  const dr = r && r.fore.av > 0 && r.efter.av > 0 ? andel(r.efter) - andel(r.fore) : 0;
  const restenOcksa = d !== 0 && dr !== 0 && Math.sign(dr) === Math.sign(d) && Math.abs(dr) >= Math.abs(d) / 2;

  if (pBattre <= g) {
    const motFel = i.motBattre === "upp" ? andel(i.motEfter) < andel(i.motFore) : andel(i.motEfter) > andel(i.motFore);
    const pMot = i.motBattre === "upp" ? fisherEnsidig(i.motFore, i.motEfter) : fisherEnsidig(i.motEfter, i.motFore);
    return svar(motFel && pMot <= i.gransMotvikt ? "battre-men" : "ser-bra-ut", true, restenOcksa);
  }
  if (pSamre <= g) return svar("ser-samre-ut", true, restenOcksa);
  if (i.efter.av >= KOLL[1]) return svar("ingen-skillnad", true);
  return sent ? svar("for-fa", true) : svar("for-tidigt", false);
}

/* ------------------------------------------------------------------------ */
/* Trendregeln (1.7)                                                         */
/* ------------------------------------------------------------------------ */

const TREND_NYA = 20;
const TREND_FORE = 40;
export const TREND_BEHOVER = TREND_NYA + TREND_FORE;

export type Trend =
  | { lage: "saknas"; har: number; behover: number }
  | { lage: "utslag" | "inget"; p: number; nya: NAv; fore: NAv };

/**
 * Lagets uteblivna möten: de 20 senaste avgjorda mot de 40 före. Fönstren räknas
 * i möten, inte i veckor, så att en lugn vecka inte ger ett litet och skakigt
 * underlag. Tills 60 avgjorda möten finns säger regeln hur långt det är kvar i
 * stället för att vara tyst.
 *
 * Vad regeln klarar: har andelen uteblivna fördubblats upptäcker den det ungefär
 * en gång av tio. Den fångar bara det som sticker ut rejält, och det är priset
 * för att nästan aldrig peka ut något som inte finns.
 */
export function trendLaget(avgjorda: readonly { moteTid: string; utfall: "hallet" | "uteblev" }[], grans: number): Trend {
  if (avgjorda.length < TREND_BEHOVER) return { lage: "saknas", har: avgjorda.length, behover: TREND_BEHOVER };
  const senaste = [...avgjorda].sort((a, b) => Date.parse(a.moteTid) - Date.parse(b.moteTid)).slice(-TREND_BEHOVER);
  const uteblivna = (l: typeof senaste): NAv => ({ n: l.filter((m) => m.utfall === "uteblev").length, av: l.length });
  const fore = uteblivna(senaste.slice(0, TREND_FORE));
  const nya = uteblivna(senaste.slice(TREND_FORE));
  const p = fisherEnsidig(nya, fore);
  return { lage: p <= grans ? "utslag" : "inget", p, nya, fore };
}

/* ------------------------------------------------------------------------ */
/* Inställningarna                                                           */
/* ------------------------------------------------------------------------ */

/**
 * Allt är av från början. Brytarna slås på av en människa, aldrig av bygget:
 * `pa` låter jobben skapa och döma rader (av = de räknar och skriver bara i sitt
 * kvitto), `hemNytt` säger vilka som ser det nya hemmet.
 */
export type ForslagInst = {
  pa: boolean;
  /** Klockslaget ("HH:MM") då ett obekräftat möte blir ett förslag på sin sista bekräftelsedag. */
  obekraftatTid: string;
  gransFacit: number;
  gransDom: number;
  gransPerson: number;
  gransMotvikt: number;
  /** Inställningar vars ändring blir en rad i loggen och följs upp. */
  foljda: string[];
  hemNytt: string[] | "alla";
};

export const FORSLAG_FORVAL: ForslagInst = {
  pa: false,
  obekraftatTid: "14:00",
  gransFacit: 0.01,
  gransDom: 0.05,
  gransPerson: 0.01,
  gransMotvikt: 0.2,
  foljda: ["moten.bekrafta-dagar", "moten.bekrafta-tid", "moten.bekrafta-paminn"],
  hemNytt: [],
};

export const FORSLAG_NYCKLAR: Record<keyof ForslagInst, string> = {
  pa: "forslag.pa",
  obekraftatTid: "forslag.obekraftat-tid",
  gransFacit: "forslag.grans-facit",
  gransDom: "forslag.grans-dom",
  gransPerson: "forslag.grans-person",
  gransMotvikt: "forslag.grans-motvikt",
  foljda: "forslag.foljda-installningar",
  hemNytt: "hem.nytt",
};

/** Brytarna: bara superadmin. Gränserna och klockslaget: admin och uppåt, som Mötens inställningar. */
const BRYTARE: readonly string[] = [FORSLAG_NYCKLAR.pa, FORSLAG_NYCKLAR.hemNytt];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const INST_NYCKEL_RE = /^[a-z0-9]+\.[a-z0-9-]{1,40}$/;
const svenskt = (x: number): string => String(x).replace(".", ",");
const talMellan = (min: number, max: number) => (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : undefined;
const gransFel = (min: number, max: number): string => `Gränsen ska vara mellan ${svenskt(min)} och ${svenskt(max)}.`;

const TOLKA_F: { [K in keyof ForslagInst]: { tolka: (v: unknown) => ForslagInst[K] | undefined; fel: string } } = {
  pa: { tolka: (v) => (typeof v === "boolean" ? v : undefined), fel: "Välj på eller av." },
  obekraftatTid: { tolka: (v) => (typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : undefined), fel: "Skriv tiden som TT:MM, till exempel 14:00." },
  gransFacit: { tolka: talMellan(0.001, 0.1), fel: gransFel(0.001, 0.1) },
  gransDom: { tolka: talMellan(0.001, 0.2), fel: gransFel(0.001, 0.2) },
  gransPerson: { tolka: talMellan(0.001, 0.1), fel: gransFel(0.001, 0.1) },
  gransMotvikt: { tolka: talMellan(0.01, 0.5), fel: gransFel(0.01, 0.5) },
  foljda: {
    tolka: (v) => (Array.isArray(v) && v.length <= 20 && v.every((x) => typeof x === "string" && INST_NYCKEL_RE.test(x)) ? [...new Set(v as string[])] : undefined),
    fel: "Listan ska vara högst 20 inställningar, skrivna som deras nycklar.",
  },
  hemNytt: {
    tolka: (v) =>
      v === "alla" ? "alla" : Array.isArray(v) && v.length <= 500 && v.every((x) => typeof x === "string" && UUID_RE.test(x)) ? [...new Set(v as string[])] : undefined,
    fel: "Välj Alla, eller de personer som ska ha det nya hemmet.",
  },
};

const faltForNyckel = (nyckel: string): keyof ForslagInst | null =>
  (Object.keys(FORSLAG_NYCKLAR) as (keyof ForslagInst)[]).find((f) => FORSLAG_NYCKLAR[f] === nyckel) ?? null;

/** Inställningarna ur `nav_setting`. Ett värde som saknas eller är trasigt ger förvalet. */
export function lasForslagInst(rader: readonly { key: string; value: unknown }[]): ForslagInst {
  const ut: ForslagInst = structuredClone(FORSLAG_FORVAL);
  for (const r of rader) {
    const falt = faltForNyckel(r.key);
    if (!falt) continue;
    const t = TOLKA_F[falt].tolka(r.value);
    if (t !== undefined) (ut as Record<string, unknown>)[falt] = t;
  }
  return ut;
}

/** Prövar ett värde innan det sparas. Felet säger vad som gäller. */
export function provaForslagInst(nyckel: string, varde: unknown): { ok: true; varde: unknown } | { ok: false; fel: string } {
  const falt = faltForNyckel(nyckel);
  if (!falt) return { ok: false, fel: "Okänd inställning." };
  const t = TOLKA_F[falt].tolka(varde);
  return t === undefined ? { ok: false, fel: TOLKA_F[falt].fel } : { ok: true, varde: t };
}

export function farAndraForslagInst(roller: readonly string[], nyckel: string): boolean {
  const niva = nivaFor([...roller]);
  if (niva === "salesperson" || !faltForNyckel(nyckel)) return false;
  return !BRYTARE.includes(nyckel) || niva === "superadmin";
}
