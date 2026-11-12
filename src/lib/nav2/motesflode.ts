/**
 * Möten: reglerna för bekräftelsefönstret, pipelinekolumnen, nivån och
 * fördelningen av mötesprovision, och inställningarna med sina förval.
 *
 * Ren modul: ingen import från Supabase eller Next, så att samma regler gäller
 * i rutten, på tavlan, i jobbet och i provisionen, och kan provas utan databas
 * (tests/motesflode.mjs).
 *
 * Lägena och reglerna är fasta för alla installationer. Det som skiljer ett
 * företag från ett annat (dagar, frågor, belopp, kolumnnamn, vilka som får
 * mötesprovision, tidszon) ligger i nav_setting under "moten.*". Inget här är
 * skrivet för ett visst företag: förvalen är neutrala och beloppen noll.
 *
 * Dagar är kalenderdagar i installationens tidszon. Dagaritmetiken görs på
 * datumsträngen (mitt på dagen i UTC), aldrig på millisekunder, så att
 * sommartidsskiftet aldrig flyttar en dag.
 */

import { SKAL } from "./leadsforma.ts";

export type PipeKolumn = "bokat" | "att_bekrafta" | "bekraftat" | "hos_saljaren" | "avgjort";
export const PIPE_KOLUMNER: readonly PipeKolumn[] = ["bokat", "att_bekrafta", "bekraftat", "hos_saljaren", "avgjort"];

export type Fraga = { id: string; text: string; aktiv: boolean };
export type Satser = { kvalificerat: number; hallet: number };
export type MotenInst = {
  bekraftaDagar: number;
  fragor: Fraga[];
  satser: Satser;
  kolumnnamn: Record<PipeKolumn, string>;
  mottagare: string[];
  ombokning: "ny" | "dela";
  tidszon: string;
  utfallPaminnelse: string;
  rubrikPrefix: string;
  /** Möten före den här tiden får aldrig "väntar på bedömning", påminnelser eller låsning. Sätts av migrationen. */
  gallerFran: string | null;
};

export const INST_FORVAL: MotenInst = {
  bekraftaDagar: 2,
  fragor: [
    { id: "beslutsfattare", text: "Var rätt beslutsfattare med?", aktiv: true },
    { id: "syfte", text: "Visste kunden vad mötet gällde?", aktiv: true },
  ],
  satser: { kvalificerat: 0, hallet: 0 },
  kolumnnamn: { bokat: "Bokat", att_bekrafta: "Att bekräfta", bekraftat: "Bekräftat", hos_saljaren: "Hos säljaren", avgjort: "Avgjort" },
  mottagare: [],
  ombokning: "ny",
  tidszon: "Europe/Stockholm",
  utfallPaminnelse: "18:00",
  rubrikPrefix: "",
  gallerFran: null,
};

/** Nyckeln i nav_setting för varje inställning. */
export const INST_NYCKLAR: Record<keyof MotenInst, string> = {
  bekraftaDagar: "moten.bekrafta-dagar",
  fragor: "moten.fragor",
  satser: "moten.provision",
  kolumnnamn: "moten.kolumnnamn",
  mottagare: "moten.mottagare",
  ombokning: "moten.ombokning-provision",
  tidszon: "moten.tidszon",
  utfallPaminnelse: "moten.utfall-paminnelse",
  rubrikPrefix: "moten.rubrik-prefix",
  gallerFran: "moten.galler-fran",
};

export const GRANSER = { dagarMax: 14, fragorMax: 5, fragaText: 120, kolumnnamn: 24, prefix: 40, belopp: 100000 } as const;

const arObjekt = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Tidszonen som Mötens klockslag räknas och visas i (bokningen, tavlan, svaren, statistikens veckor). I dag en
 * konstant: inställningen `moten.tidszon` styr dagarna (bekräftelsefönstret, provisionens månad, påminnelsen om
 * utfall), inte klockslagen (S6 i docs/saljbarhet.md). Den dag klockslagen ska följa inställningen ändras den här
 * funktionen, inte anropen. Utkastet har samma funktion som `moTz()`.
 */
export function motesTz(): string {
  return "Europe/Stockholm";
}

/**
 * Valen som bladen erbjuder (S1–S3 i docs/saljbarhet.md): nuläget inför mötet, skälen till ett nej och förslagen
 * på källor. EN plats: rutten prövar indata mot de här listorna (`NULAGE` och `NEJ_SKAL` i motenforma.ts är samma
 * värden) och läsningen skickar dem till gränssnittet i `ND.moten.inst.val`, så utkastet har inga egna kopior.
 *
 * Värdena är desamma som före flytten och får inte byta stavning: nulägets nyckel (`mote.nulage`) och skälets text
 * (`mote_kedja.nej_skal`, samma lista som Leads `lead_skal`) ligger sparade i databasen. Att göra listorna till
 * inställningar per företag är ett eget varv; då ändras det här stället, inte anropen.
 */
export const MOTES_NULAGE = { ingen: "Ingen SEO", sjalv: "Gör själv", byra: "Har byrå" } as const;
/** Samma skäl som Leads, så att ett Nej betyder samma sak på båda ställena. */
export const MOTES_NEJ_SKAL = SKAL;
/** Förslag i fältet Källa. Källan är fri text; förslagen sparas inte någonstans. */
export const MOTES_KALLOR = ["Kallsamtal", "Hemsida", "Rekommendation", "Tidigare kund"] as const;
export type MotesVal = { nulage: Record<string, string>; nejSkal: string[]; kallor: string[] };
/** Listorna i den form gränssnittet läser dem. Kopior, så att mottagaren inte kan ändra källan. */
export function motesVal(): MotesVal {
  return { nulage: { ...MOTES_NULAGE }, nejSkal: [...MOTES_NEJ_SKAL], kallor: [...MOTES_KALLOR] };
}

export function giltigTidszon(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz) return false;
  try {
    new Intl.DateTimeFormat("sv-SE", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * En tolkare per inställning: ger värdet i sin rena form, eller undefined när
 * det inte går att använda. Läsningen och sparandet (provaInstallning) går
 * genom samma tolkare, så att det som går att spara alltid går att läsa.
 */
const giltigtBelopp = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= GRANSER.belopp;
const giltigtNamn = (n: unknown): n is string => typeof n === "string" && !!n.trim() && n.trim().length <= GRANSER.kolumnnamn;

const TOLKA: { [K in Exclude<keyof MotenInst, "kolumnnamn">]: (v: unknown) => MotenInst[K] | undefined } = {
  bekraftaDagar: (v) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= GRANSER.dagarMax ? v : undefined),
  fragor: (v) => {
    if (!Array.isArray(v) || v.length > GRANSER.fragorMax) return undefined;
    const id = new Set<string>();
    const lista: Fraga[] = [];
    for (const f of v) {
      if (!arObjekt(f) || typeof f.id !== "string" || !/^[a-z0-9_-]{1,40}$/.test(f.id) || id.has(f.id)
        || typeof f.text !== "string" || !f.text.trim() || f.text.trim().length > GRANSER.fragaText || typeof f.aktiv !== "boolean") return undefined;
      id.add(f.id);
      lista.push({ id: f.id, text: f.text.trim(), aktiv: f.aktiv });
    }
    return lista;
  },
  satser: (v) => (arObjekt(v) && giltigtBelopp(v.kvalificerat) && giltigtBelopp(v.hallet)
    ? { kvalificerat: Math.round(v.kvalificerat * 100) / 100, hallet: Math.round(v.hallet * 100) / 100 }
    : undefined),
  mottagare: (v) => (Array.isArray(v) && v.length <= 1000 && v.every((m) => typeof m === "string" && m.length > 0 && m.length <= 64) ? [...new Set(v as string[])] : undefined),
  ombokning: (v) => (v === "ny" || v === "dela" ? v : undefined),
  tidszon: (v) => (giltigTidszon(v) ? v : undefined),
  utfallPaminnelse: (v) => (typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : undefined),
  rubrikPrefix: (v) => (typeof v === "string" && v.trim().length <= GRANSER.prefix ? v.trim() : undefined),
  gallerFran: (v) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : undefined),
};

/**
 * Varje nyckel prövas för sig: ett felaktigt värde ger förvalet för just den
 * nyckeln och välter aldrig Möten eller Provision. Kolumnnamnen prövas namn för namn.
 */
export function lasInstallningar(rader: { key: string; value: unknown }[]): MotenInst {
  const v = new Map(rader.map((r) => [r.key, r.value]));
  const ut: MotenInst = structuredClone(INST_FORVAL);
  for (const falt of Object.keys(TOLKA) as (keyof typeof TOLKA)[]) {
    if (!v.has(INST_NYCKLAR[falt])) continue;
    const t = TOLKA[falt](v.get(INST_NYCKLAR[falt]));
    if (t !== undefined) (ut as Record<string, unknown>)[falt] = t;
  }
  const namn = v.get(INST_NYCKLAR.kolumnnamn);
  if (arObjekt(namn)) for (const k of PIPE_KOLUMNER) if (giltigtNamn(namn[k])) ut.kolumnnamn[k] = (namn[k] as string).trim();
  return ut;
}

const SPARFEL: Record<keyof MotenInst, string> = {
  bekraftaDagar: "Antalet dagar ska vara ett heltal från 0 till 14.",
  fragor: "Högst fem frågor, var och en med en text på högst 120 tecken.",
  satser: "Beloppen ska vara mellan 0 och 100 000 kr.",
  kolumnnamn: "Varje kolumnnamn ska ha mellan 1 och 24 tecken.",
  mottagare: "Listan över vilka som får mötesprovision stämmer inte.",
  ombokning: "Välj Den som bokade om eller Dela lika.",
  tidszon: "Tidszonen finns inte.",
  utfallPaminnelse: "Skriv tiden som TT:MM, till exempel 18:00.",
  rubrikPrefix: "Prefixet får ha högst 40 tecken.",
  gallerFran: "Den här inställningen går inte att ändra.",
};

/** Inställningen och fältet för en nav_setting-nyckel, eller null. */
export function faltFor(nyckel: string): keyof MotenInst | null {
  const f = (Object.keys(INST_NYCKLAR) as (keyof MotenInst)[]).find((k) => INST_NYCKLAR[k] === nyckel);
  return f ?? null;
}

/**
 * Prövar ett värde innan det sparas. Samma tolkare som läsningen; kolumnnamnen
 * prövas strängare (en okänd kolumn eller ett ogiltigt namn nekas i stället för
 * att falla tillbaka). `moten.galler-fran` går inte att ändra.
 */
export function provaInstallning(nyckel: string, varde: unknown): { ok: true; varde: unknown } | { ok: false; fel: string } {
  const falt = faltFor(nyckel);
  if (!falt) return { ok: false, fel: "Okänd inställning." };
  if (falt === "gallerFran") return { ok: false, fel: SPARFEL.gallerFran };
  if (falt === "kolumnnamn") {
    if (!arObjekt(varde)) return { ok: false, fel: SPARFEL.kolumnnamn };
    const ut: Partial<Record<PipeKolumn, string>> = {};
    for (const [k, n] of Object.entries(varde)) {
      if (!(PIPE_KOLUMNER as readonly string[]).includes(k) || !giltigtNamn(n)) return { ok: false, fel: SPARFEL.kolumnnamn };
      ut[k as PipeKolumn] = n.trim();
    }
    return { ok: true, varde: ut };
  }
  const t = TOLKA[falt](varde);
  return t === undefined ? { ok: false, fel: SPARFEL[falt] } : { ok: true, varde: t };
}

/** Kalenderdagen ("YYYY-MM-DD") för en tidpunkt i tidszonen. */
export function lokalDag(tid: string | Date, tz: string): string {
  const d = typeof tid === "string" ? new Date(tid) : tid;
  return new Intl.DateTimeFormat("sv-SE", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Lägger till n kalenderdagar till en datumsträng. */
export function plusDagar(dag: string, n: number): string {
  const [a, m, d] = dag.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + n, 12)).toISOString().slice(0, 10);
}

/**
 * Fönstret öppnar N dagar före mötesdagen. Senast-dagen är dagen före mötet,
 * eller mötesdagen när mötet bokades (eller flyttades) dagen före eller samma
 * dag. Senast är aldrig före öppningen (N = 0 öppnar på mötesdagen).
 */
export function bekraftelseFonster(i: { moteTid: string; senastAndrad: string; dagar: number; tz: string }): { oppnar: string; senast: string } {
  const motesdag = lokalDag(i.moteTid, i.tz);
  const dagenFore = plusDagar(motesdag, -1);
  const oppnar = plusDagar(motesdag, -Math.max(0, i.dagar));
  const bokDag = lokalDag(i.senastAndrad, i.tz);
  let senast = bokDag >= dagenFore ? motesdag : dagenFore;
  if (senast < oppnar) senast = oppnar;
  return { oppnar, senast };
}

/** Vilken kolumn ett öppet möte står i just nu. Ordningen är regeln. */
export function pipelineKolumn(
  m: { moteTid: string; langd: number; bekraftat: boolean; utfall: string | null },
  f: { oppnar: string },
  nu: Date,
  tz: string,
): PipeKolumn {
  if (m.utfall) return "avgjort";
  const slut = new Date(m.moteTid).getTime() + Math.max(0, m.langd) * 60_000;
  if (nu.getTime() >= slut) return "hos_saljaren";
  if (m.bekraftat) return "bekraftat";
  if (lokalDag(nu, tz) >= f.oppnar) return "att_bekrafta";
  return "bokat";
}

/** En kedja utan öppet möte står i Avgjort, annars avgör mötet. */
export function kortFas(
  k: { harOppetMote: boolean; mote: Parameters<typeof pipelineKolumn>[0] | null; fonster: { oppnar: string } | null },
  nu: Date,
  tz: string,
): PipeKolumn {
  if (!k.harOppetMote || !k.mote || !k.fonster) return "avgjort";
  return pipelineKolumn(k.mote, k.fonster, nu, tz);
}

/** Brådskan för ett möte som ännu ska bekräftas. Passerad senast-dag är fortfarande "i dag". */
export function bradska(senast: string, kolumn: PipeKolumn, nu: Date, tz: string): "idag" | "imorgon" | null {
  if (kolumn !== "bokat" && kolumn !== "att_bekrafta") return null;
  const idag = lokalDag(nu, tz);
  if (idag >= senast) return "idag";
  if (plusDagar(idag, 1) === senast) return "imorgon";
  return null;
}

/**
 * Nivån räknas på frågorna som är aktiva när svaret ges. Alla ja ger
 * kvalificerat, ett nej ger hållet. Utan aktiva frågor är ett hållet möte
 * kvalificerat.
 */
export function niva(fragor: Fraga[], svar: { id: string; ja: boolean }[]): "kvalificerat" | "hallet" | { fel: string } {
  const per = new Map(svar.map((s) => [s.id, s.ja]));
  let allaJa = true;
  for (const f of fragor) {
    if (!f.aktiv) continue;
    const ja = per.get(f.id);
    if (typeof ja !== "boolean") return { fel: `Svar saknas: ${f.text}` };
    if (!ja) allaJa = false;
  }
  return allaJa ? "kvalificerat" : "hallet";
}

export type Andel = { employeeId: string; belopp: number; delatMed: string | null };

/**
 * Vem som får bokarprovisionen för ett möte.
 *
 * - Den som håller mötet får aldrig bokarprovision för det.
 * - Bokade säljaren (eller någon utan markering) om mötet, går den till den
 *   ursprungliga bokaren.
 * - Bokade en annan markerad bokare om det, får den hela ("ny") eller delar
 *   med den ursprungliga ("dela"). Kan den ursprungliga inte få (saknar
 *   markering eller håller mötet själv) går hela till den som bokade om.
 * - Vid delning får den ursprungliga den nedrundade halvan, den som bokade om
 *   resten, så att summan alltid är beloppet på öret.
 */
export function fordela(i: { ursprunglig: string; bokatAv: string; hallsAv: string; mottagare: readonly string[]; regel: "ny" | "dela"; belopp: number }): Andel[] {
  const mott = new Set(i.mottagare);
  const ursprungligFar = mott.has(i.ursprunglig) && i.ursprunglig !== i.hallsAv;
  const omBokare = i.bokatAv !== i.ursprunglig && i.bokatAv !== i.hallsAv && mott.has(i.bokatAv) ? i.bokatAv : null;
  if (!omBokare) return ursprungligFar ? [{ employeeId: i.ursprunglig, belopp: i.belopp, delatMed: null }] : [];
  if (i.regel === "ny" || !ursprungligFar) return [{ employeeId: omBokare, belopp: i.belopp, delatMed: null }];
  const oren = Math.round(i.belopp * 100);
  const forsta = Math.floor(oren / 2);
  return [
    { employeeId: i.ursprunglig, belopp: forsta / 100, delatMed: omBokare },
    { employeeId: omBokare, belopp: (oren - forsta) / 100, delatMed: i.ursprunglig },
  ];
}

/** Skälet som står vid ett tappat möte i Provision. */
export function taptSkal(utfall: "uteblev" | "avbokat", bekraftat: boolean): string {
  if (utfall === "avbokat") return "Avbokat";
  return bekraftat ? "Uteblev trots bekräftelse" : "Inte bekräftat före mötet";
}

/** Provisionsmånaden ("YYYY-MM-01") är mötestidens månad i tidszonen. */
export function manadFor(moteTid: string, tz: string): string {
  return `${lokalDag(moteTid, tz).slice(0, 7)}-01`;
}

/**
 * Den ursprungliga bokaren: vandra bakåt genom ombokningarna till det första
 * mötet. Ett uppföljningsmöte (också ett ombokat) ger ingen bokarprovision,
 * så vandringen ger null när den möter ett. Saknas ett föregående möte är
 * den som bokade det äldsta kända mötet den ursprungliga. En slinga ger null.
 */
export function ursprungligBokare(
  id: string,
  moten: ReadonlyMap<string, { art: string; foregaende: string | null; bokatAv: string }>,
): string | null {
  const sett = new Set<string>();
  let m = moten.get(id);
  while (m) {
    if (sett.has(id)) return null;
    sett.add(id);
    if (m.art === "uppfoljning") return null;
    if (m.art !== "ombokning" || !m.foregaende) return m.bokatAv;
    const forra = moten.get(m.foregaende);
    if (!forra) return m.bokatAv;
    id = m.foregaende;
    m = forra;
  }
  return null;
}

/* ------------------------------------------------------------------------ */
/* Låsningen av mötesprovisionen (uppgift 6)                                 */
/* ------------------------------------------------------------------------ */

/** Ett svar som det sparas på mötet: med frågans text som den löd när svaret gavs. */
export type NivaSvar = { id: string; text: string; ja: boolean };
/** Det som låses: en nivå (hållet möte) eller ett tappat möte. */
export type Lage = { niva: "kvalificerat" | "hallet"; svar: NivaSvar[] } | { tappat: "uteblev" | "avbokat" };
/** Vilken andel en rad är. Vid delning får den ursprungliga bokaren första halvan (nedrundad), den som bokade om resten. */
export type Del = "hel" | "forsta_halvan" | "andra_halvan";
/** En rad i `mote_provision`, som `mote_las_provision` tar den (`p_rader`). */
export type ProvisionsRad = {
  employee_id: string;
  niva: "kvalificerat" | "hallet" | null;
  belopp: number;
  mojligt: number;
  skal: string | null;
  satser: Satser;
  delat_med: string | null;
  del: Del;
  manad: string;
};

/**
 * Omfattas mötet av mötesprovisionen? Bara möten från `moten.galler-fran` och framåt låses. Utan
 * inställningen omfattas inget, samma regel som "väntar på bedömning" i moten.ts.
 */
export function omfattas(moteTid: string, gallerFran: string | null): boolean {
  if (!gallerFran) return false;
  const t = Date.parse(moteTid);
  const g = Date.parse(gallerFran);
  return Number.isFinite(t) && Number.isFinite(g) && t >= g;
}

/**
 * De sparade svaren (`mote.niva_svar`) i den form bladet Ändra svaren fyller i: bara id och ja, och bara de svar som
 * går att läsa. Null när inget går att läsa (kolumnen är tom, eller har en annan form än väntat).
 */
export function sparadeSvar(v: unknown): { id: string; ja: boolean }[] | null {
  if (!Array.isArray(v)) return null;
  const ut: { id: string; ja: boolean }[] = [];
  for (const x of v as unknown[]) {
    const s = x as { id?: unknown; ja?: unknown } | null;
    if (s && typeof s === "object" && typeof s.id === "string" && s.id !== "" && typeof s.ja === "boolean") ut.push({ id: s.id, ja: s.ja });
  }
  return ut.length ? ut : null;
}

/** Svaren på de aktiva frågorna, i frågornas ordning och med deras text just nu. Svar på andra frågor följer inte med. */
export function nivaSvar(fragor: Fraga[], svar: { id: string; ja: boolean }[]): NivaSvar[] {
  const per = new Map(svar.map((s) => [s.id, s.ja]));
  const ut: NivaSvar[] = [];
  for (const f of fragor) {
    const ja = per.get(f.id);
    if (f.aktiv && typeof ja === "boolean") ut.push({ id: f.id, text: f.text, ja });
  }
  return ut;
}

/** Andelen av ett belopp: hela, den nedrundade halvan, eller resten. Samma räkning som `fordela`. */
export function andel(belopp: number, del: Del): number {
  const oren = Math.round(belopp * 100);
  const forsta = Math.floor(oren / 2);
  if (del === "forsta_halvan") return forsta / 100;
  if (del === "andra_halvan") return (oren - forsta) / 100;
  return oren / 100;
}

/**
 * Raderna som låses för ett möte. `fordela` med inställningen som gäller just nu avgör vem som får och hur det
 * delas; beloppet är satsen för nivån (0 för ett tappat möte), det möjliga är kvalificerat-satsen delad på samma
 * sätt, och satserna sparas i raden så att en senare ändring räknas ur dem. Ingen ursprunglig bokare (ett
 * uppföljningsmöte, också ombokat) ger inga rader.
 */
export function raknaRader(i: {
  ursprunglig: string | null;
  bokatAv: string;
  hallsAv: string;
  mottagare: readonly string[];
  regel: "ny" | "dela";
  satser: Satser;
  lage: Lage;
  bekraftat: boolean;
  manad: string;
}): ProvisionsRad[] {
  if (!i.ursprunglig) return [];
  const ursprunglig = i.ursprunglig;
  const andelar = fordela({ ursprunglig, bokatAv: i.bokatAv, hallsAv: i.hallsAv, mottagare: i.mottagare, regel: i.regel, belopp: 0 });
  const del = (a: Andel): Del => (a.delatMed === null ? "hel" : a.employeeId === ursprunglig ? "forsta_halvan" : "andra_halvan");
  return andelar.map((a) => {
    const d = del(a);
    const r = omraknadRad({ satser: i.satser, del: d }, i.lage, i.bekraftat);
    return { employee_id: a.employeeId, niva: r.niva, belopp: r.belopp, mojligt: r.mojligt, skal: r.skal, satser: { ...i.satser }, delat_med: a.delatMed, del: d, manad: i.manad };
  });
}

/**
 * Beloppen för en rad ur radens egna satser och andel. Används vid låsningen och vid varje ändring efteråt:
 * en ändring räknas aldrig ur dagens inställning och fördelas aldrig om.
 */
export function omraknadRad(rad: { satser: Satser; del: Del }, lage: Lage, bekraftat: boolean): { niva: "kvalificerat" | "hallet" | null; belopp: number; mojligt: number; skal: string | null } {
  const mojligt = andel(rad.satser.kvalificerat, rad.del);
  if ("niva" in lage) return { niva: lage.niva, belopp: andel(rad.satser[lage.niva], rad.del), mojligt, skal: null };
  return { niva: null, belopp: 0, mojligt, skal: taptSkal(lage.tappat, bekraftat) };
}

/**
 * Rättelsens text i huvudboken. Posten hamnar i en annan månad än mötet, så texten säger vilket möte det gäller.
 * Själva rättelsen (fastställd månad, skillnad, en gång per version) bokförs i databasen, i samma transaktion
 * som raderna: `mote_bokfor_rattelse` (0288).
 */
export function rattelseNot(bolag: string, dag: string): string {
  return `Rättelse möte ${bolag} ${dag}`;
}

/** Har mötet låst mötesprovision som raderingen skulle ta bort? Ett belopp över noll på någon rad. */
export function harLastBelopp(rader: readonly { belopp: number | string }[]): boolean {
  return rader.some((r) => Math.round(Number(r.belopp) * 100) > 0);
}

/**
 * Har de låsta raderna redan det läget? Används när ett rättat utfall körs om: står mötet redan på utfallet och
 * ger omräkningen samma nivå, belopp och skäl för varje rad finns inget att göra.
 */
export function radernaStammer(
  rader: readonly { niva: string | null; belopp: number; skal: string | null; satser: Satser; del: Del }[],
  lage: Lage,
  bekraftat: boolean,
): boolean {
  return rader.every((r) => {
    const ny = omraknadRad(r, lage, bekraftat);
    return ny.niva === r.niva && Math.round(ny.belopp * 100) === Math.round(Number(r.belopp) * 100) && ny.skal === r.skal;
  });
}

/** Klockslaget ("HH:MM") för en tidpunkt i tidszonen. */
export function lokalKlockan(tid: string | Date, tz: string): string {
  const d = typeof tid === "string" ? new Date(tid) : tid;
  return new Intl.DateTimeFormat("sv-SE", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}

export type PaminnelseMote = { id: string; slut: string; utfall: string | null; niva: string | null; utfallNar: string | null; hallsAv: string };
export type Paminnelse = { kalla: "mote-utfall-saknas" | "mote-bedomning-saknas"; till: string; moteId: string };

/**
 * Vem ska påminnas just nu. Ren: jobbet läser mötena och skriver notiserna, regeln ligger här.
 *
 *   - Utfall saknas: sluttiden har passerat och klockan i tidszonen är minst påminnelsetiden, samma kalenderdag
 *     som mötet slutade: hållaren. Två kalenderdagar efter (från påminnelsetiden): alla admins.
 *   - Hållet utan nivå: samma tid, räknat från dagen utfallet sattes: hållaren, och två dagar efter admins.
 *   - Möten som slutade före `galler-fran` påminns aldrig.
 *
 * En dag är en kalenderdag i `tidszon`. Samma anrop två gånger samma dag ger samma lista; att samma notis inte
 * skrivs två gånger sköter jobbet med nyckeln (källa, möte, dag).
 */
export function vemPaminns(moten: readonly PaminnelseMote[], admins: readonly string[], nu: Date, inst: MotenInst): Paminnelse[] {
  const idag = lokalDag(nu, inst.tidszon);
  if (lokalKlockan(nu, inst.tidszon) < inst.utfallPaminnelse) return [];
  const ut: Paminnelse[] = [];
  const lagg = (kalla: Paminnelse["kalla"], fran: string, m: PaminnelseMote) => {
    const dag = lokalDag(fran, inst.tidszon);
    if (idag === dag) ut.push({ kalla, till: m.hallsAv, moteId: m.id });
    else if (idag === plusDagar(dag, 2)) for (const a of admins) ut.push({ kalla, till: a, moteId: m.id });
  };
  for (const m of moten) {
    if (!omfattas(m.slut, inst.gallerFran)) continue;
    if (Date.parse(m.slut) > nu.getTime()) continue;
    if (m.utfall === null) lagg("mote-utfall-saknas", m.slut, m);
    else if (m.utfall === "hallet" && m.niva === null && m.utfallNar) lagg("mote-bedomning-saknas", m.utfallNar, m);
  }
  const sett = new Set<string>();
  return ut.filter((p) => {
    const nyckel = `${p.kalla}|${p.till}|${p.moteId}`;
    if (sett.has(nyckel)) return false;
    sett.add(nyckel);
    return true;
  });
}

/**
 * Påminnelserna som ännu inte skickats i dag. `gamla` är svaret på läsningen av redan skickade notiser. Misslyckades
 * läsningen (`error`) vet vi inte vad som skickats, och då skickas ingenting den här körningen: det är null, aldrig
 * "allt är nytt". `nyckel` är `notisId` (källa, möte, kalenderdag); den tas som parameter så att modulen förblir ren.
 */
export function utanRedanSkickade(
  att: readonly Paminnelse[],
  gamla: { data: unknown; error: unknown },
  idag: string,
  tz: string,
  nyckel: (kalla: Paminnelse["kalla"], moteId: string, dag: string) => string,
): Paminnelse[] | null {
  if (gamla.error || !Array.isArray(gamla.data)) return null;
  const skickat = new Set(
    (gamla.data as { employee_id: string; kalla: Paminnelse["kalla"]; object_id: string; created_at: string }[]).map(
      (r) => `${nyckel(r.kalla, r.object_id, lokalDag(r.created_at, tz))}:${r.employee_id}`,
    ),
  );
  return att.filter((p) => !skickat.has(`${nyckel(p.kalla, p.moteId, idag)}:${p.till}`));
}

/**
 * Får en envägsknapp ångras (F6.1)? Bara exakt den sparning servern svarade med (samma ögonblick), och bara
 * när inget har hänt sedan dess: inget utfall och ingen låst mötesprovision. En bekräftelse ångras av den som
 * bekräftade. Ett försök bär ingen person: det pekas ut av tiden ensam, och tiden som läggs tillbaka (`fore`)
 * måste vara tom eller äldre än försöket. Rutten villkorar skrivningen på samma saker i databasen.
 */
export type AngraMote = { bekraftat_nar: string | null; bekraftat_av: string | null; utfall: string | null; provision_last_nar: string | null; forsok: number; senast_forsok: string | null };
export function provaAngra(
  m: AngraMote,
  i: { vad: "bekrafta" | "forsok"; nar: string; fore: string | null; jag: string },
): { ok: true } | { ok: false; fel: string; status: 400 | 409 } {
  const samma = (a: string | null, b: string) => a !== null && Date.parse(a) === Date.parse(b);
  if (m.utfall) return { ok: false, fel: "Mötet har redan fått ett utfall. Inget ångrades.", status: 409 };
  if (m.provision_last_nar) return { ok: false, fel: "Mötesprovisionen är låst. Inget ångrades.", status: 409 };
  if (i.vad === "bekrafta") {
    if (!samma(m.bekraftat_nar, i.nar) || m.bekraftat_av !== i.jag) return { ok: false, fel: "Mötet har ändrats sedan du bekräftade det. Inget ångrades.", status: 409 };
    return { ok: true };
  }
  if (m.bekraftat_nar) return { ok: false, fel: "Mötet är bekräftat. Försöket står kvar.", status: 409 };
  if (m.forsok < 1 || !samma(m.senast_forsok, i.nar)) return { ok: false, fel: "Mötet har ändrats sedan försöket. Inget ångrades.", status: 409 };
  if (i.fore !== null && !(Date.parse(i.fore) < Date.parse(i.nar))) return { ok: false, fel: "Det går inte att ångra längre. Ladda om tavlan.", status: 400 };
  return { ok: true };
}

/** Ordningen på tavlan: kolumnvis, inom kolumnen efter tid, stigande (Avgjort fallande). */
export function sorteraFas(a: { fas: PipeKolumn; tid: string }, b: { fas: PipeKolumn; tid: string }): number {
  const k = PIPE_KOLUMNER.indexOf(a.fas) - PIPE_KOLUMNER.indexOf(b.fas);
  if (k) return k;
  return a.fas === "avgjort" ? b.tid.localeCompare(a.tid) : a.tid.localeCompare(b.tid);
}
