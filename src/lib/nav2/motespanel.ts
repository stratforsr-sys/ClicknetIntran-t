/**
 * Mötens statistik som panel (beställaren 2026-11-15, förlagan version 9 i
 * docs/superpowers/specs/2026-11-15-moten-statistik-forlaga.dc.html). Allt räknas här, i rena funktioner, och
 * servern kör dem för varje period och person. Utkastet ritar bara.
 *
 * Tiden räknas som lokala strängar "YYYY-MM-DDTHH:MM" i Mötens tidszon, precis som förlagan räknar, så att ett
 * möte 23:30 svensk tid den sista dagen i en period hör till den perioden också när det är 22:30Z.
 */
import { inomKrets, type StatKedja, type StatMote } from "./motesstatforma.ts";
import { foregaendeArbetsdag, type MalTal, MAL_TAL, type MotenInst } from "./motesflode.ts";

export type PeriodNyckel = "vecka" | "manad" | "d90";
export const PERIODER: readonly PeriodNyckel[] = ["vecka", "manad", "d90"];
/** Gränserna är lokala strängar. `till` null betyder ingen övre gräns: 90 dagar tar med det som är bokat framåt. */
export type PanelPeriod = { fran: string; till: string | null; foreFran: string; foreTill: string; mot: string };
/**
 * `ids` är raderna bakom talet, det som bladet visar. Id:na i panelen är korta nycklar i `PanelSvar.moten` och
 * `PanelSvar.kedjor` (en uuid upprepad i tjugo listor gjorde svaret flera gånger större); de riktiga id:na står där.
 */
export type Andel = { n: number; av: number; ids: string[] };
export type Kvot = { n: number; av: number };
export type Panel = {
  rubrik: [string, string];
  show: Andel;
  noshow: Andel;
  bekr: Andel & { svaradeInte: string[]; aldrig: string[] };
  /** av = hållna första möten. `fragor` är hur frågorna efter mötet besvarades, för bladets förklaring. */
  kval: Andel & { obedomda: string[]; fragor: { text: string; ja: number; av: number }[] };
  /** n = kedjor som nått offert, av = kedjor med hållet första möte. ids = kedjorna med offert. */
  offert: Andel;
  /** n = affär, av = affär + nej. ids = alla offerter. */
  closing: Andel & { ejAvgjorda: string[] };
  /** Kedje-id. Läget i dag för kedjor vars första hållna möte ligger i perioden. */
  efter: { offert: string[]; nytt: string[]; foljsUpp: string[]; dog: string[] };
  /** Läget i dag, oavsett period. Mötes-id för attBekr och utan, kedje-id för resten. Sorterade med det som brådskar först. */
  attGora: { attBekr: string[]; utanTid: string[]; uppfNu: string[]; utan: string[]; offSvar: string[] };
  /** Mötes-id framåt, närmast först. */
  kommer: string[];
  /** Avgjorda mötes-id i tidsordning, för strecken i navet. */
  avgjorda: string[];
  fore: { show: Kvot; bekr: Kvot; kval: Kvot; offert: Kvot; closing: Kvot } | null;
  omdome: Partial<Record<MalTal, "over" | "under">>;
};
/** Det som bladen behöver om varje möte och kedja. Tiden är lokal. */
export type PanelMote = {
  tid: string; art: StatMote["art"]; utfall: StatMote["utfall"]; bekr: boolean; forsok: number;
  niva: "kvalificerat" | "hallet" | null; kedja: string; bokatAv: string; hallsAv: string;
};
export type KedjaUt = "offert" | "nytt" | "foljsUpp" | "dog";
export type KedjaSlut = "affar" | "nej" | "tyst" | "svar";
export type PanelKedja = { id: string; uppf: string | null; avslut: StatKedja["avslut"]; ut: KedjaUt | null; slut: KedjaSlut | null; mote: string };

const MS_DAG = 86_400_000;

/** Tidpunkten som lokal sträng "YYYY-MM-DDTHH:MM" i tidszonen. */
export function lokalTid(tid: string | Date, tz: string): string {
  const d = typeof tid === "string" ? new Date(tid) : tid;
  const del = Object.fromEntries(new Intl.DateTimeFormat("sv-SE", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d).map((p) => [p.type, p.value]));
  return `${del.year}-${del.month}-${del.day}T${del.hour}:${del.minute}`;
}

// Räkning på lokala strängar, som i förlagan: tolkas som UTC bara för att få kalendern rätt.
const ms = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), +(s.slice(11, 13) || 0), +(s.slice(14, 16) || 0));
const iso = (t: number) => new Date(t).toISOString().slice(0, 16);
const plus = (s: string, d: number) => iso(ms(s) + d * MS_DAG);
const mandag = (dag: string) => { const t = ms(dag.slice(0, 10)); return iso(t - ((new Date(t).getUTCDay() + 6) % 7) * MS_DAG).slice(0, 10); };
function iso8601Vecka(dag: string): number {
  const d = new Date(ms(dag.slice(0, 10)));
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const v1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d.getTime() - v1.getTime()) / MS_DAG - 3 + ((v1.getUTCDay() + 6) % 7)) / 7);
}
const MANADER = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];

/** Vecka (måndag–söndag), Månad (kalendermånaden) och 90 dagar (rullande), var och en med perioden före. */
export function panelPerioder(nu: Date, tidszon: string): Record<PeriodNyckel, PanelPeriod> {
  const n = lokalTid(nu, tidszon);
  const man = mandag(n);
  const m1 = n.slice(0, 8) + "01";
  const forraM = iso(ms(m1) - MS_DAG).slice(0, 8) + "01";
  const slutM = iso(Date.UTC(+n.slice(0, 4), +n.slice(5, 7), 0)).slice(0, 10);
  return {
    vecka: { fran: man, till: plus(man, 6).slice(0, 10) + "T23:59", foreFran: plus(man, -7).slice(0, 10), foreTill: plus(man, -1).slice(0, 10) + "T23:59", mot: "vecka " + iso8601Vecka(plus(man, -7)) },
    manad: { fran: m1, till: slutM + "T23:59", foreFran: forraM, foreTill: plus(m1, -1).slice(0, 10) + "T23:59", mot: "i " + MANADER[+forraM.slice(5, 7) - 1] },
    d90: { fran: plus(n, -90).slice(0, 10), till: null, foreFran: plus(n, -180).slice(0, 10), foreTill: plus(n, -90).slice(0, 10), mot: "perioden före" },
  };
}

type M = PanelMote & { id: string; n: string; nivaSvar: { id: string; ja: boolean }[] };
type K = PanelKedja & { n: string; moten: M[]; forsta: M | null; uteblev: M | null; oppet: boolean; natt: boolean; ombokad: boolean; tyst: number };

/**
 * Mötena och kedjorna i den form bladen läser, med kedjans läge i dag. Läget beror på inställningarna (dödsgränserna)
 * men inte på period eller person, så det räknas en gång.
 */
export function panelUnderlag(moten: StatMote[], kedjor: StatKedja[], inst: MotenInst, nu: Date) {
  const tz = inst.tidszon;
  const idag = lokalTid(nu, tz).slice(0, 10);
  const M: M[] = moten.map((m) => ({
    id: m.id, tid: lokalTid(m.moteTid, tz), art: m.art, utfall: m.utfall, bekr: !!m.bekraftatNar, forsok: m.forsok ?? 0,
    niva: m.niva ?? null, kedja: m.kedja, bokatAv: m.bokatAv, hallsAv: m.hallsAv, nivaSvar: m.nivaSvar ?? [],
    n: "",
  })).sort((a, b) => (a.tid < b.tid ? -1 : a.tid > b.tid ? 1 : 0));
  M.forEach((m, i) => { m.n = i.toString(36); });
  const perKedja = new Map<string, M[]>();
  for (const m of M) { const l = perKedja.get(m.kedja); if (l) l.push(m); else perKedja.set(m.kedja, [m]); }
  const K: K[] = [];
  for (const k of kedjor) {
    const km = perKedja.get(k.id) ?? [];
    if (!km.length) continue;
    const forsta = km.find((m) => m.utfall === "hallet") ?? null;
    const tyst = k.ingetSvarIRad ?? 0;
    const uppf = k.uppfoljningDatum ?? null;
    // Ett nytt möte är ett senare möte som inte avbokades (granskningen 2026-11-15: ett avbokat möte höll kedjan "ny" för alltid).
    const sen = forsta ? km.some((m) => m.tid > forsta.tid && m.utfall !== "avbokat") : false;
    const gammal = !!uppf && (ms(idag) - ms(uppf)) / MS_DAG > inst.dodDagar;
    const natt = !!forsta && (!!k.offertNar || k.avslut === "affar");
    const ut: KedjaUt | null = !forsta ? null : natt ? "offert" : sen && !k.avslut ? "nytt" : (k.avslut || tyst >= inst.dodTysta || gammal) ? "dog" : "foljsUpp";
    const slut: KedjaSlut | null = !natt ? null : k.avslut === "affar" ? "affar" : k.avslut ? "nej" : tyst >= inst.dodTysta ? "tyst" : "svar";
    const uteblev = km.find((m) => m.utfall === "uteblev") ?? null;
    K.push({
      id: k.id, n: K.length.toString(36), uppf, avslut: k.avslut, ut, slut, mote: (forsta ?? uteblev ?? km[0]).n,
      moten: km, forsta, uteblev, oppet: km.some((m) => !m.utfall), natt, tyst,
      ombokad: !!uteblev && km.some((m) => m.tid > uteblev.tid),
    });
  }
  return { M, K, idag, nuLokal: lokalTid(nu, tz) };
}

type Underlag = ReturnType<typeof panelUnderlag>;

const pct = (n: number, av: number) => (av ? Math.round((n / av) * 100) : 0);
const ord = (n: number, en: string, fl: string) => n + " " + (n === 1 ? en : fl);
const ids = (a: { n: string }[]) => a.map((x) => x.n);
const iTid = (fran: string, till: string | null) => (t: string) => !!t && t >= fran && (till === null || t <= till);

function stat(U: Underlag, fran: string, till: string | null, hos: (m: M) => boolean) {
  const i = iTid(fran, till);
  const F = U.M.filter((m) => m.art !== "uppfoljning" && i(m.tid) && hos(m));
  const hallna = F.filter((m) => m.utfall === "hallet");
  const avgj = F.filter((m) => m.utfall === "hallet" || m.utfall === "uteblev");
  const K1 = U.K.filter((k) => k.forsta && k.forsta.art !== "uppfoljning" && i(k.forsta.tid) && hos(k.forsta));
  const ut = (l: KedjaUt) => K1.filter((k) => k.ut === l);
  const off = ut("offert");
  const slut = (l: KedjaSlut) => off.filter((k) => k.slut === l);
  return {
    F, hallna, avgj, K1, off,
    uteblev: F.filter((m) => m.utfall === "uteblev"),
    svarade: avgj.filter((m) => m.bekr),
    ejsvar: avgj.filter((m) => !m.bekr && m.forsok > 0),
    aldrig: avgj.filter((m) => !m.bekr && !m.forsok),
    obekr: avgj.filter((m) => !m.bekr),
    bedomda: hallna.filter((m) => m.niva),
    kval: hallna.filter((m) => m.niva === "kvalificerat"),
    nytt: ut("nytt"), foljsUpp: ut("foljsUpp"), dog: ut("dog"),
    affar: slut("affar"), nej: slut("nej"), tyst: slut("tyst"), svar: slut("svar"),
  };
}

/**
 * Hela panelen för en period och en person (null = alla). Talen och texterna är förlagans `renderVals()`.
 * Underlaget kan skickas med när samma möten räknas för flera perioder och personer.
 */
export function byggPanel(moten: StatMote[], kedjor: StatKedja[], p: PanelPeriod, person: string | null, inst: MotenInst, nu: Date, underlag?: Underlag): Panel {
  const U = underlag ?? panelUnderlag(moten, kedjor, inst, nu);
  const hos = (m: M) => !person || m.bokatAv === person || m.hallsAv === person;
  const S = stat(U, p.fran, p.till, hos);
  const F0 = stat(U, p.foreFran, p.foreTill, hos);
  const nH = S.hallna.length, nA = S.avgj.length, nK = S.K1.length, nO = S.off.length, ob = S.obekr;
  const obH = ob.filter((m) => m.utfall === "hallet").length;
  const bkH = S.svarade.filter((m) => m.utfall === "hallet").length;

  // Rubriken: det talen inte visar. Annars hur många som gått till offert.
  let ins1 = "";
  if (ob.length >= 2 && S.svarade.length >= 2) {
    if (obH === 0) ins1 = "Inget av de " + ob.length + " obekräftade mötena blev av.";
    else if (pct(bkH, S.svarade.length) - pct(obH, ob.length) >= 15) ins1 = "Bekräftade möten blev av " + bkH + " av " + S.svarade.length + " gånger, obekräftade " + obH + " av " + ob.length + ".";
  }
  if (!ins1) ins1 = nK ? (nO ? nO + " av " + ord(nK, "hållet möte", "hållna möten") + " har gått till offert." : "Inget möte har gått till offert än.") : nA ? "Inget möte blev av i perioden." : S.F.length ? "Inget av de bokade mötena har varit än." : "Inga möten i perioden.";
  const ins2 = !S.F.length ? "Välj en längre period för att se mer." : "";

  // Att göra nu: läget i dag. Bekräftelsen öppnar `bekraftaDagar` arbetsdagar före mötesdagen, röda dagar räknas bort.
  const oppnar = (dag: string) => { let d = dag; for (let n = 0; n < Math.max(0, inst.bekraftaDagar); n++) d = foregaendeArbetsdag(d); return d; };
  const fram = (a: M[]) => a.sort((x, y) => (x.tid < y.tid ? -1 : x.tid > y.tid ? 1 : 0));
  const kommer = fram(U.M.filter((m) => m.art !== "uppfoljning" && hos(m) && !m.utfall && m.tid > U.nuLokal));
  const attBekr = kommer.filter((m) => !m.bekr && oppnar(m.tid.slice(0, 10)) <= U.idag);
  // Utfall saknas 30 minuter efter mötets start, samma regel som veckovyn under Mer (motesstatforma.ts).
  const utanGrans = iso(ms(U.nuLokal) - 30 * 60_000);
  const utan = U.M.filter((m) => hos(m) && !m.utfall && m.tid <= utanGrans);
  const efterUppf = (a: K[]) => a.sort((x, y) => { const u = (k: K) => k.uppf ?? k.forsta?.tid ?? ""; return u(x) < u(y) ? -1 : u(x) > u(y) ? 1 : 0; });
  const efterMote = (a: K[]) => a.sort((x, y) => { const t = (k: K) => (k.uteblev ?? k.moten[0]).tid; return t(x) < t(y) ? -1 : 1; });
  const utanTid = efterMote(U.K.filter((k) => k.uteblev && hos(k.uteblev) && !k.ombokad && !k.avslut && !k.forsta));
  const uppfNu = efterUppf(U.K.filter((k) => k.forsta && hos(k.forsta) && !k.avslut && !k.natt && !k.oppet && k.tyst < inst.dodTysta && k.uppf && k.uppf <= U.idag));
  const offSvar = efterUppf(U.K.filter((k) => k.slut === "svar" && k.forsta && hos(k.forsta)));

  // Kvalificeringens frågor, så som de besvarades för de hållna mötena. Frågorna är företagets egna (inställningen).
  const fragor = inst.fragor.map((f) => {
    const svar = S.hallna.map((m) => m.nivaSvar.find((s) => s.id === f.id)).filter((s): s is { id: string; ja: boolean } => !!s);
    return { text: f.text, ja: svar.filter((s) => s.ja).length, av: svar.length };
  }).filter((f) => f.av > 0);

  const andel = (n: number, av: number, a: { n: string }[]): Andel => ({ n, av, ids: ids(a) });
  const panel: Panel = {
    rubrik: [ins1, ins2],
    show: andel(nH, nA, S.avgj),
    noshow: andel(S.uteblev.length, nA, S.uteblev),
    bekr: { ...andel(S.svarade.length, nA, S.avgj), svaradeInte: ids(S.ejsvar), aldrig: ids(S.aldrig) },
    kval: { ...andel(S.kval.length, nH, S.hallna), obedomda: ids(S.hallna.filter((m) => !m.niva)), fragor },
    offert: andel(nO, nK, S.off),
    closing: { ...andel(S.affar.length, S.affar.length + S.nej.length, S.off), ejAvgjorda: ids([...S.svar, ...S.tyst]) },
    efter: { offert: ids(S.off), nytt: ids(S.nytt), foljsUpp: ids(S.foljsUpp), dog: ids(S.dog) },
    attGora: { attBekr: ids(attBekr), utanTid: ids(utanTid), uppfNu: ids(uppfNu), utan: ids(fram(utan)), offSvar: ids(offSvar) },
    kommer: ids(kommer),
    avgjorda: ids(S.avgj),
    fore: {
      show: { n: F0.hallna.length, av: F0.avgj.length },
      bekr: { n: F0.svarade.length, av: F0.avgj.length },
      kval: { n: F0.kval.length, av: F0.hallna.length },
      offert: { n: F0.off.length, av: F0.K1.length },
      closing: { n: F0.affar.length, av: F0.affar.length + F0.nej.length },
    },
    omdome: {},
  };
  if (!S.F.length && !F0.F.length) panel.fore = null;

  // Omdömet mot målet. Utan mål inget omdöme. För No-show rate är lägre bättre.
  const talet: Record<MalTal, Kvot> = { show: panel.show, noshow: panel.noshow, bekr: panel.bekr, kval: panel.kval, closing: panel.closing };
  for (const t of MAL_TAL) {
    const mal = inst.mal[t];
    const { n, av } = talet[t];
    // Under fem i nämnaren visas "N av M" i stället för procent: då är procenten brus, och den döms inte heller.
    if (mal === undefined || av < 5) continue;
    const a = pct(n, av);
    panel.omdome[t] = (t === "noshow" ? a <= mal : a >= mal) ? "over" : "under";
  }
  return panel;
}

/** Mötena och kedjorna i den form utkastet läser dem, med id som nyckel. */
export function panelKarta(U: Underlag): { moten: Record<string, PanelMote>; kedjor: Record<string, PanelKedja> } {
  const moten: Record<string, PanelMote> = {};
  for (const m of U.M) moten[m.n] = { tid: m.tid, art: m.art, utfall: m.utfall, bekr: m.bekr, forsok: m.forsok, niva: m.niva, kedja: m.kedja, bokatAv: m.bokatAv, hallsAv: m.hallsAv };
  const kedjor: Record<string, PanelKedja> = {};
  for (const k of U.K) kedjor[k.n] = { id: k.id, uppf: k.uppf, avslut: k.avslut, ut: k.ut, slut: k.slut, mote: k.mote };
  return { moten, kedjor };
}

/** Det som servern skickar i `ND.motesstat.panel`. Nyckeln "alla" i `tal` är hela kretsen. */
export type PanelSvar = {
  perioder: Record<PeriodNyckel, PanelPeriod>;
  /** Dagen i dag i Mötens tidszon ("YYYY-MM-DD"), samma som listorna räknades mot (försenad = före i dag). */
  idag: string;
  personer: { id: string; namn: string }[];
  tal: Record<PeriodNyckel, Record<string, Panel>>;
  mal: MotenInst["mal"];
  moten: Record<string, PanelMote>;
  kedjor: Record<string, PanelKedja>;
};

/**
 * Hela panelen för chefen: raderna begränsas till kretsen (0264, null = alla) INNAN något räknas, och talen räknas
 * för varje period och för alla och varje person som bokat eller hållit ett möte i kretsen.
 */
export function byggPanelSvar(
  moten: StatMote[], kedjor: StatKedja[], krets: readonly string[] | null, namn: (id: string) => string, inst: MotenInst, nu: Date,
): PanelSvar {
  const b = inomKrets(moten, kedjor, krets);
  const i = krets === null ? null : new Set(krets);
  const U = panelUnderlag(b.moten, b.kedjor, inst, nu);
  const ids = new Set<string>();
  for (const m of b.moten) for (const id of [m.bokatAv, m.hallsAv]) if (id && (!i || i.has(id))) ids.add(id);
  const personer = [...ids].map((id) => ({ id, namn: namn(id) })).sort((x, y) => x.namn.localeCompare(y.namn, "sv"));
  const perioder = panelPerioder(nu, inst.tidszon);
  const tal = {} as PanelSvar["tal"];
  for (const p of PERIODER) {
    tal[p] = { alla: byggPanel(b.moten, b.kedjor, perioder[p], null, inst, nu, U) };
    for (const person of personer) tal[p][person.id] = byggPanel(b.moten, b.kedjor, perioder[p], person.id, inst, nu, U);
  }
  // "Välj en längre period" bara när en längre period faktiskt har möten: inget löfte utan belägg.
  for (const [i, p] of PERIODER.entries()) {
    for (const [vem, panel] of Object.entries(tal[p])) {
      if (panel.rubrik[1] && !PERIODER.slice(i + 1).some((q) => !tal[q][vem].rubrik[1])) panel.rubrik = [panel.rubrik[0], ""];
    }
  }
  return { perioder, idag: U.idag, personer, tal, mal: inst.mal, ...panelKarta(U) };
}

/** Raderna som panelen läser, i databasens form. Samma kolumner i servern och i databasprovet. */
export const PANEL_MOTE_KOLUMNER = "id, kedja_id, bokat_av, halls_av, bokat_nar, mote_tid, art, utfall, resultat, kalla, bekraftat_nar, forsok, niva, niva_svar";
export const PANEL_KEDJA_KOLUMNER = "kedja_id, bolag_id, forsta_bokat_av, forsta_bokat_nar, forsta_mote_tid, forsta_hallna_halls_av, avslut, avslut_nar, affar_forsta_mote, offert_nar, kolumn, kalla";
type Tid = string | Date;
const tidIso = (v: Tid) => (v instanceof Date ? v.toISOString() : v);
const tidIsoEllerNull = (v: Tid | null | undefined) => (v === null || v === undefined ? null : tidIso(v));
// En `date`-kolumn ("2026-10-26"). Som Date från pg är den lokal midnatt, inte UTC.
const datumEllerNull = (v: Tid | null | undefined) => (v === null || v === undefined ? null
  : v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}` : v.slice(0, 10));

export type PanelMoteRad = {
  id: string; kedja_id: string; bokat_av: string; halls_av: string; bokat_nar: Tid; mote_tid: Tid; art: StatMote["art"]; utfall: StatMote["utfall"];
  resultat: string | null; kalla: string; bekraftat_nar: Tid | null; forsok: number | null; niva: string | null; niva_svar: unknown;
};
export type PanelKedjaRad = {
  kedja_id: string; bolag_id?: string; forsta_bokat_av: string | null; forsta_bokat_nar: Tid | null; forsta_mote_tid: Tid | null; forsta_hallna_halls_av: string | null;
  avslut: StatKedja["avslut"]; avslut_nar: Tid | null; affar_forsta_mote: boolean | null; offert_nar: Tid | null; kolumn: string | null; kalla: string | null;
};
export type PanelKedjaExtra = { id: string; uppfoljning_datum: Tid | null; inget_svar_i_rad: number | null };

export function panelMote(r: PanelMoteRad): StatMote {
  const svar = Array.isArray(r.niva_svar)
    ? (r.niva_svar as unknown[]).filter((x): x is { id: string; ja: boolean } => !!x && typeof x === "object" && typeof (x as { id?: unknown }).id === "string" && typeof (x as { ja?: unknown }).ja === "boolean")
    : null;
  return {
    id: r.id, kedja: r.kedja_id, bokatAv: r.bokat_av, hallsAv: r.halls_av, bokatNar: tidIso(r.bokat_nar), moteTid: tidIso(r.mote_tid),
    art: r.art, utfall: r.utfall, resultat: r.resultat, kalla: r.kalla, bekraftatNar: tidIsoEllerNull(r.bekraftat_nar),
    forsok: r.forsok ?? 0, niva: r.niva === "kvalificerat" || r.niva === "hallet" ? r.niva : null, nivaSvar: svar,
  };
}

export function panelKedja(r: PanelKedjaRad, extra: PanelKedjaExtra | undefined): StatKedja {
  return {
    id: r.kedja_id, forstaBokatAv: r.forsta_bokat_av ?? "", forstaBokatNar: tidIsoEllerNull(r.forsta_bokat_nar) ?? "", forstaMoteTid: tidIsoEllerNull(r.forsta_mote_tid),
    forstaHallnaHallsAv: r.forsta_hallna_halls_av, avslut: r.avslut, avslutNar: tidIsoEllerNull(r.avslut_nar), affarForstaMote: r.affar_forsta_mote === true,
    offertNar: tidIsoEllerNull(r.offert_nar), kolumn: r.kolumn, kalla: r.kalla ?? "",
    uppfoljningDatum: datumEllerNull(extra?.uppfoljning_datum), ingetSvarIRad: extra?.inget_svar_i_rad ?? 0,
  };
}
