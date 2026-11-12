import type { SupabaseClient } from "@supabase/supabase-js";
import {
  lokalDag,
  manadFor,
  omfattas,
  omraknadRad,
  raknaRader,
  harLastBelopp,
  rattelseNot,
  ursprungligBokare as ursprungligIKedjan,
  type Lage,
  type MotenInst,
  type ProvisionsRad,
  type Satser,
  type Del,
} from "./motesflode.ts";

/**
 * Möten: låsningen av mötesprovisionen, ändringar i efterhand och rättelserna i huvudboken.
 *
 * Alla anrop går med service role (rutten har redan prövat rättigheten). Reglerna, vem som får, hur det
 * delas och beloppen, står i den rena modulen motesflode.ts. Skrivningarna går i EN transaktion per väg,
 * i databasen (0288): `mote_las_provision` och `mote_andra_provision`, som också bokför rättelsen för en
 * fastställd månad (`mote_bokfor_rattelse`). Här räknas raderna, innevarande månad och texten, och sedan
 * görs ett anrop. Ett fel rullar tillbaka allt, så mötet kan låsas om.
 * Provet tests/moten-db.mjs kör den här filen mot databasen i en transaktion, så den importerar bara
 * relativt med .ts-ändelse och använder bara `from().select/insert/update().eq/is/in/limit/maybeSingle()`
 * och `rpc()`.
 *
 * En öppen månad räknas live ur raderna av provisionsmotorn; bara en fastställd månad får en rättelse, och
 * den hamnar i innevarande månad. Möten skriver aldrig till `commission_entry` på något annat sätt.
 */

type Db = SupabaseClient;

/** Mötet har ändrats under tiden, eller är redan låst: rutten svarar 409. */
export class ProvisionKonflikt extends Error {}

/** Det låsningen behöver av mötesraden. */
export type MoteForLas = {
  id: string;
  kedja_id: string;
  bokat_av: string;
  halls_av: string;
  mote_tid: string;
  bekraftat_nar: string | null;
  provision_last_nar?: string | null;
};

const fel = (vad: string, e: { message?: string } | null): Error => new Error(`${vad}: ${e?.message ?? "okänt fel"}`);

/** Ett fel från en av 0288:s funktioner: P0409 är en konflikt (409), P0422 ingen öppen månad, resten ett fel. */
function rpcFel(vad: string, e: { code?: string; message?: string }): Error {
  if (e.code === "P0409") return new ProvisionKonflikt("Mötet har ändrats under tiden, eller provisionen är redan låst. Ladda om tavlan.");
  if (e.code === "P0422") return new Error(`${vad}: både mötets månad och innevarande månad är fastställda, så rättelsen har ingen öppen månad. Ekonomi bokför den för hand.`);
  return fel(vad, e);
}

const bokfortUr = (data: unknown): string[] => {
  const b = (data as { bokfort?: unknown } | null)?.bokfort;
  return Array.isArray(b) ? b.map(String) : [];
};

/**
 * Den ursprungliga bokaren: kedjans möten läses, och den rena vandringen i motesflode.ts följer
 * `foregaende_id` bakåt till det första mötet. Ett uppföljningsmöte (också bakom en ombokning) ger null,
 * alltså ingen bokarprovision. Ett läsfel kastar: det får aldrig se ut som "ingen bokare".
 */
export async function ursprungligBokare(db: Db, moteId: string): Promise<string | null> {
  const { data: rad, error } = await db.from("mote").select("kedja_id").eq("id", moteId).maybeSingle();
  if (error) throw fel("Mötet gick inte att läsa", error);
  const kedja = (rad as { kedja_id: string } | null)?.kedja_id;
  if (!kedja) return null;
  const { data, error: e2 } = await db.from("mote").select("id, art, foregaende_id, bokat_av").eq("kedja_id", kedja).limit(1000);
  if (e2) throw fel("Kedjans möten gick inte att läsa", e2);
  const moten = (data ?? []) as unknown as { id: string; art: string; foregaende_id: string | null; bokat_av: string }[];
  return ursprungligIKedjan(moteId, new Map(moten.map((m) => [m.id, { art: m.art, foregaende: m.foregaende_id, bokatAv: m.bokat_av }])));
}

/** Bolagets namn för rättelsens text. Ett läsfel ger en neutral text: namnet får aldrig stoppa pengarna. */
async function bolagsnamn(db: Db, kedjaId: string): Promise<string> {
  const { data: k } = await db.from("mote_kedja").select("bolag_id").eq("id", kedjaId).maybeSingle();
  const bolagId = (k as { bolag_id: string } | null)?.bolag_id;
  if (!bolagId) return "okänt bolag";
  const { data: b } = await db.from("mote_bolag").select("namn").eq("id", bolagId).maybeSingle();
  return (b as { namn: string } | null)?.namn ?? "okänt bolag";
}

/** En låst rad, som omräkningen behöver den. */
export type LastRad = {
  employee_id: string;
  niva: "kvalificerat" | "hallet" | null;
  belopp: number;
  skal: string | null;
  satser: Satser;
  del: Del;
  version: number;
};

/** Mötets låsta rader. Ett läsfel kastar. */
export async function lastaRader(db: Db, moteId: string): Promise<LastRad[]> {
  const { data, error } = await db
    .from("mote_provision")
    .select("employee_id, niva, belopp, skal, satser, del, version")
    .eq("mote_id", moteId)
    .limit(100);
  if (error) throw fel("Mötets provision gick inte att läsa", error);
  return ((data ?? []) as unknown as LastRad[]).map((r) => ({ ...r, belopp: Number(r.belopp) }));
}

/** Har mötet låst mötesprovision över noll (`harLastBelopp`)? Ett läsfel kastar: det får aldrig se ut som "nej". */
export async function harLastProvision(db: Db, moteId: string): Promise<boolean> {
  const { data, error } = await db.from("mote_provision").select("belopp").eq("mote_id", moteId).limit(100);
  if (error) throw fel("Mötets provision gick inte att läsa", error);
  return harLastBelopp((data ?? []) as unknown as { belopp: number }[]);
}

/** Har ett senare möte bokats om från det här (`foregaende_id` pekar hit)? Ett läsfel kastar. */
export async function harOmbokning(db: Db, moteId: string): Promise<boolean> {
  const { data, error } = await db.from("mote").select("id").eq("foregaende_id", moteId).limit(1);
  if (error) throw fel("Ombokningarna gick inte att läsa", error);
  return ((data ?? []) as unknown[]).length > 0;
}

/**
 * Vilka som får (eller skulle få) mötesprovision för mötet. Låst: raderna. Inte låst: `fordela` med inställningen
 * som gäller nu, samma räkning som låsningen gör. Ingen av dem får sätta eller ändra mötets nivå.
 */
export async function provisionsmottagare(db: Db, m: MoteForLas, inst: MotenInst): Promise<string[]> {
  if (m.provision_last_nar) return (await lastaRader(db, m.id)).map((r) => r.employee_id);
  const ursprunglig = await ursprungligBokare(db, m.id);
  return raknaRader({
    ursprunglig,
    bokatAv: m.bokat_av,
    hallsAv: m.halls_av,
    mottagare: inst.mottagare,
    regel: inst.ombokning,
    satser: inst.satser,
    lage: { tappat: "avbokat" },
    bekraftat: false,
    manad: manadFor(m.mote_tid, inst.tidszon),
  }).map((r) => r.employee_id);
}

/**
 * Lås mötesprovisionen för ett möte: raderna räknas med inställningen som gäller nu (`fordela` med
 * `inst.mottagare` och `inst.ombokning`, beloppen ur `inst.satser`), och `mote_las_provision` sparar nivån,
 * raderna och rättelsen för en fastställd månad i en transaktion. Möten före `moten.galler-fran` låses
 * aldrig (`last: false`). Redan låst ger `ProvisionKonflikt`.
 */
export async function lasProvision(
  db: Db,
  m: MoteForLas,
  inst: MotenInst,
  lage: Lage,
  av: string,
  nu: Date = new Date(),
): Promise<{ last: boolean; rader: ProvisionsRad[]; bokfort: string[] }> {
  if (!omfattas(m.mote_tid, inst.gallerFran)) return { last: false, rader: [], bokfort: [] };
  const ursprunglig = await ursprungligBokare(db, m.id);
  const rader = raknaRader({
    ursprunglig,
    bokatAv: m.bokat_av,
    hallsAv: m.halls_av,
    mottagare: inst.mottagare,
    regel: inst.ombokning,
    satser: inst.satser,
    lage,
    bekraftat: !!m.bekraftat_nar,
    manad: manadFor(m.mote_tid, inst.tidszon),
  });
  const note = rader.some((r) => r.belopp !== 0) ? rattelseNot(await bolagsnamn(db, m.kedja_id), lokalDag(m.mote_tid, inst.tidszon)) : null;
  const { data, error } = await db.rpc("mote_las_provision", {
    p_mote: m.id,
    p_niva: "niva" in lage ? lage.niva : null,
    p_svar: "niva" in lage ? lage.svar : null,
    p_av: av,
    p_rader: rader,
    p_innevarande: manadFor(nu.toISOString(), inst.tidszon),
    p_note: note,
  });
  if (error) throw rpcFel("Mötesprovisionen kunde inte låsas", error);
  return { last: true, rader, bokfort: bokfortUr(data) };
}

/**
 * Ändra ett redan låst möte: en ny nivå (admin bedömer om, också efter Ifrågasätt) eller ett rättat utfall.
 * Räknas ENBART ur de befintliga raderna: samma personer, samma `del`, samma `satser`. Aldrig fördelat igen
 * och aldrig ur dagens inställning. `mote_andra_provision` skriver mötet (villkorat på utfallet och nivåns tid
 * som lästes här), raderna (villkorade på versionen) och rättelsen i en transaktion; skillnaden räknas där,
 * ur radens belopp under radlås. Två samtidiga ändringar ger `ProvisionKonflikt`.
 */
export async function andraProvision(
  db: Db,
  moteId: string,
  nytt: Lage,
  av: string,
  tidszon: string,
  nu: Date = new Date(),
): Promise<{ rader: number; bokfort: string[] }> {
  const { data: mRad, error } = await db
    .from("mote")
    .select("id, kedja_id, mote_tid, utfall, niva_nar, bekraftat_nar, provision_last_nar")
    .eq("id", moteId)
    .maybeSingle();
  if (error) throw fel("Mötet gick inte att läsa", error);
  const m = mRad as unknown as { id: string; kedja_id: string; mote_tid: string; utfall: string | null; niva_nar: string | null; bekraftat_nar: string | null; provision_last_nar: string | null } | null;
  if (!m) throw new ProvisionKonflikt("Mötet finns inte.");
  if (!m.utfall || !m.provision_last_nar) throw new ProvisionKonflikt("Mötets provision är inte låst.");

  const rader = await lastaRader(db, moteId);
  const nya = rader.map((r) => {
    const ny = omraknadRad({ satser: r.satser, del: r.del }, nytt, !!m.bekraftat_nar);
    return { employee_id: r.employee_id, version: r.version, niva: ny.niva, belopp: ny.belopp, mojligt: ny.mojligt, skal: ny.skal };
  });
  const note = rader.length ? rattelseNot(await bolagsnamn(db, m.kedja_id), lokalDag(m.mote_tid, tidszon)) : null;
  const { data, error: rFel } = await db.rpc("mote_andra_provision", {
    p_mote: moteId,
    p_fran_utfall: m.utfall,
    p_fran_niva_nar: m.niva_nar,
    p_utfall: "niva" in nytt ? "hallet" : nytt.tappat,
    p_niva: "niva" in nytt ? nytt.niva : null,
    p_svar: "niva" in nytt ? nytt.svar : null,
    p_av: av,
    p_rader: nya,
    p_innevarande: manadFor(nu.toISOString(), tidszon),
    p_note: note,
  });
  if (rFel) throw rpcFel("Mötesprovisionen kunde inte ändras", rFel);
  return { rader: rader.length, bokfort: bokfortUr(data) };
}

/**
 * Ifrågasätt: den som har en rad med nivån hållet för mötet, en gång. "ok" när det sparades, "redan" när
 * raden redan är ifrågasatt, "ingen" när personen inte har någon sådan rad.
 */
export async function ifragasattProvision(db: Db, moteId: string, employeeId: string, nu: Date = new Date()): Promise<"ok" | "redan" | "ingen"> {
  const { data, error } = await db
    .from("mote_provision")
    .update({ ifragasatt_nar: nu.toISOString(), ifragasatt_av: employeeId })
    .eq("mote_id", moteId)
    .eq("employee_id", employeeId)
    .eq("niva", "hallet")
    .is("ifragasatt_nar", null)
    .select("employee_id");
  if (error) throw fel("Ifrågasättandet kunde inte sparas", error);
  if (((data ?? []) as unknown[]).length > 0) return "ok";
  const { data: rad, error: e2 } = await db
    .from("mote_provision")
    .select("ifragasatt_nar")
    .eq("mote_id", moteId)
    .eq("employee_id", employeeId)
    .eq("niva", "hallet")
    .maybeSingle();
  if (e2) throw fel("Mötets provision gick inte att läsa", e2);
  return rad ? "redan" : "ingen";
}

/** Ett möte som reparationen kan låsa. */
export type ReparationsKandidat = MoteForLas & { utfall: "uteblev" | "avbokat"; utfall_av: string | null };

/**
 * Möten vars utfall är satt men vars mötesprovision inte blivit låst, äldst utfall först. Hållna möten tas inte med:
 * `mote_las_provision` sätter nivån och låsningen i samma sats, så ett hållet möte utan lås har också ingen nivå och
 * väntar på bedömning, och skulle annars fylla `limit` och stoppa de riktiga reparationerna. Utfallet måste vara minst
 * fem minuter gammalt. Ett läsfel kastar.
 */
export async function reparationsKandidater(db: Db, gallerFran: string, nu: Date, limit: number): Promise<ReparationsKandidat[]> {
  const { data, error } = await db
    .from("mote")
    .select("id, kedja_id, bokat_av, halls_av, mote_tid, bekraftat_nar, provision_last_nar, utfall, utfall_av")
    .not("utfall", "is", null)
    .neq("utfall", "hallet")
    .is("provision_last_nar", null)
    .gte("mote_tid", gallerFran)
    .lte("utfall_nar", new Date(nu.getTime() - 5 * 60_000).toISOString())
    .order("utfall_nar", { ascending: true })
    .limit(limit);
  if (error) throw fel("Reparationens möten gick inte att läsa", error);
  return (data ?? []) as unknown as ReparationsKandidat[];
}

/**
 * Låt stå: en admin låter den ifrågasatta nivån stå kvar. Sätter `beslut_nar`/`beslut_av` på mötets ifrågasatta rader
 * som ännu inte har något beslut, och rör inga belopp. Ger antalet rader som fick beslutet: 0 betyder att inget var
 * ifrågasatt, eller att någon redan hann besluta (rutten svarar 409).
 */
export async function latStaProvision(db: Db, moteId: string, av: string, nu: Date = new Date()): Promise<number> {
  const { data, error } = await db
    .from("mote_provision")
    .update({ beslut_nar: nu.toISOString(), beslut_av: av })
    .eq("mote_id", moteId)
    .not("ifragasatt_nar", "is", null)
    .is("beslut_nar", null)
    .select("employee_id");
  if (error) throw fel("Beslutet kunde inte sparas", error);
  return ((data ?? []) as unknown[]).length;
}
