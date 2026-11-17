import type { SupabaseClient } from "@supabase/supabase-js";
import { svenskTidpunkt, svensktDatum } from "../../klocka.ts";
import { delaUpp, lasSidvis } from "../../sidvis.ts";
import { STAMMER_INTE_HUVUD, farSlasPa, lasChattInst, lasUtrymme, provNyckel, stammerInteId, visatKort, type Utrymme } from "./chattforma.ts";
import { avtryck } from "./systemtext.ts";

/** Frågans och svarets text sparas så här länge (designdokumentet, Loggen). */
export const CHATT_TEXT_DAGAR = 90;

/**
 * Nattjobbet: nollar frågans och svarets text i loggrader äldre än 90 dagar.
 * Raden står kvar med modell, token, verktyg och kostnad: det är dem gränserna
 * och kvalitetsmåttet räknas på.
 */
export async function rensaChattText(db: SupabaseClient, nu: Date = new Date()): Promise<{ nollade: number }> {
  const fore = new Date(nu.getTime() - CHATT_TEXT_DAGAR * 86_400_000).toISOString();
  const { data, error } = await db.from("nav_chatt_logg").update({ fraga: null, svar: null }).lt("nar", fore).not("fraga", "is", null).select("id");
  if (error) throw new Error(error.message);
  return { nollade: (data ?? []).length };
}

/** Miljön en loggrad hör till. Gränserna räknas per miljö: en preview drar aldrig av produktionens utrymme. */
export const chattMiljo = (): string => process.env.VERCEL_ENV ?? "lokal";

export type ChattLage = {
  pa: boolean;
  skal: string | null;
  modell: string;
  /** Vad personen och företaget använt i månaden, och gränserna. Null när det inte gick att läsa. */
  utrymme: Utrymme | null;
  /** Allas förbrukning i månaden. Bara för den som får se den. */
  allas: { namn: string; usd: number; fragor: number }[] | null;
  /** Hur korten gick och hur många svar som fick Stämmer inte, i månaden (A1-5). Samma krets som `allas`; null annars, och när det inte gick att läsa. */
  avlasning: ChattAvlasning | null;
};

/**
 * Avläsningen för den som sköter chatten (A1-5): antal, aldrig en procent och aldrig en dom. Bara kort som visades
 * (`kort: true` i loggens verktyg) räknas, med det utfall som står på dem nu: ett kort som godkändes och sedan ångrades
 * står som ångrat. `andrade` är kort som personen rättade före beslutet (funktion 6); de räknas inte som att AI:n hade
 * rätt, och därför står de godkända efter ändring för sig ("3 godkända (1 efter ändring)"). Månaden är den svenska
 * kalendermånaden, som gränserna (`nav_chatt_utrymme`), och miljön är den här.
 */
export type ChattAvlasning = {
  /** "ÅÅÅÅ-MM". */
  manad: string;
  /** Svenska dagen talen gäller. */
  dataPer: string;
  /** `godkandaAndrade` är de godkända som personen rättade före Godkänn (de ingår i `godkanda`); `andrade` alla rättade, oavsett utfall. */
  kort: { visade: number; godkanda: number; godkandaAndrade: number; delvis: number; avbrutna: number; angrade: number; utanUtfall: number; andrade: number };
  /** Svar i månaden och miljön som någon tryckt Stämmer inte på, ett per svar. */
  stammerInte: number;
  /** Raden att visa, färdig. */
  rad: string;
  serInte: string;
};

const AVLASNING_SER_INTE =
  "Utfallen och det som ändrades är vad webbläsaren skickade: ett kort i en flik som stängdes innan utfallet skickades står utan utfall. Kort i frågor som loggades innan kortens märke fanns räknas inte.";

const antal = (n: number, en: string, flera: string) => `${n} ${n === 1 ? en : flera}`;

/**
 * Räknar avläsningen ur loggens rader. Ren, så att provet håller den. `rader` är loggrader med kort, `rapporterade` är
 * loggraderna som Stämmer inte-ärendena pekar på, båda redan i den här miljön. Bara rader i `nu`:s svenska månad räknas.
 */
export function raknaAvlasning(i: { rader: readonly { id: string; nar: unknown; verktyg: unknown }[]; rapporterade: readonly { id: string; nar: unknown }[]; nu: Date }): ChattAvlasning {
  const dataPer = svensktDatum(i.nu);
  const manad = dataPer.slice(0, 7);
  const iManaden = (nar: unknown) => typeof nar === "string" && !Number.isNaN(Date.parse(nar)) && svensktDatum(new Date(nar)).slice(0, 7) === manad;
  const k = { visade: 0, godkanda: 0, godkandaAndrade: 0, delvis: 0, avbrutna: 0, angrade: 0, utanUtfall: 0, andrade: 0 };
  const sedda = new Set<string>();
  for (const r of i.rader) {
    if (sedda.has(r.id) || !iManaden(r.nar) || !Array.isArray(r.verktyg)) continue;
    sedda.add(r.id);
    for (const a of r.verktyg) {
      if (!visatKort(a)) continue;
      const x = a as Record<string, unknown>;
      const andrat = Array.isArray(x.andrat) && x.andrat.length > 0;
      k.visade++;
      if (x.utfall === "godkant") {
        k.godkanda++;
        if (andrat) k.godkandaAndrade++;
      } else if (x.utfall === "delvis") k.delvis++;
      else if (x.utfall === "avbrutet") k.avbrutna++;
      else if (x.utfall === "angrat") k.angrade++;
      else k.utanUtfall++;
      if (andrat) k.andrade++;
    }
  }
  const stammerInte = new Set(i.rapporterade.filter((r) => iManaden(r.nar)).map((r) => r.id)).size;
  const kortDel = k.visade === 0
    ? "Kort i månaden: inga visade"
    : `Kort i månaden: ${antal(k.godkanda, "godkänt", "godkända")}${k.godkanda ? ` (${k.godkandaAndrade} efter ändring)` : ""}, ${k.delvis} delvis, ${antal(k.avbrutna, "avbrutet", "avbrutna")}, ${antal(k.angrade, "ångrat", "ångrade")}, ${k.utanUtfall} utan utfall · Ändrade före beslutet: ${k.andrade}`;
  return { manad, dataPer, kort: k, stammerInte, rad: `${kortDel} · Stämmer inte: ${stammerInte} · data per ${dataPer}`, serInte: AVLASNING_SER_INTE };
}

type Sida<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** Läser avläsningen. Går något inte att läsa blir den null, och resten av chattens läge visas ändå. */
async function lasAvlasning(db: SupabaseClient, miljo: string, nu: Date): Promise<ChattAvlasning | null> {
  try {
    // Svensk midnatt den första i månaden, som gränsernas månad. Raderna prövas mot månaden igen i raknaAvlasning.
    const fran = svenskTidpunkt(`${svensktDatum(nu).slice(0, 7)}-01`, "00:00").toISOString();
    type Rad = { id: string; nar: unknown; verktyg: unknown };
    const [rader, rapporter] = await Promise.all([
      // Bara rader med ett kort som visades: jsonb-villkoret `verktyg @> [{"kort": true}]`.
      lasSidvis<Rad>((a, b) => db.from("nav_chatt_logg").select("id, nar, verktyg").eq("miljo", miljo).gte("nar", fran).contains("verktyg", JSON.stringify([{ kort: true }])).order("id").range(a, b) as unknown as Sida<Rad>),
      // Ärendena har ingen miljö (förhandsvisningen delar databas med produktionen): de räknas bara via sin loggrad nedan.
      lasSidvis<{ id: string; body: unknown }>((a, b) => db.from("error_report").select("id, body").eq("kind", "manual").like("body", `${STAMMER_INTE_HUVUD}%`).gte("first_seen_at", fran).order("id").range(a, b) as unknown as Sida<{ id: string; body: unknown }>),
    ]);
    const ids = [...new Set(rapporter.flatMap((r) => { const id = stammerInteId(r.body); return id ? [id] : []; }))];
    const rapporterade = (
      await Promise.all(
        delaUpp(ids, 100).map(async (del) => {
          const { data, error } = await db.from("nav_chatt_logg").select("id, nar").eq("miljo", miljo).in("id", del);
          if (error) throw new Error(error.message);
          return (data ?? []) as { id: string; nar: unknown }[];
        }),
      )
    ).flat();
    return raknaAvlasning({ rader, rapporterade, nu });
  } catch (e) {
    console.error(`chatt: avläsningen gick inte att läsa: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/**
 * Chattens läge: är den påslagen, och får den vara det? Samma prövning som
 * rutten gör vid varje fråga (`farSlasPa`), så att skrivrutan bara frågar
 * Claude när rutten kommer att svara. Med läget följer månadens utrymme för
 * personen, och allas förbrukning och avläsningen (A1-5) för den som sätter gränserna.
 */
export async function chattLage(db: SupabaseClient, mig: string, allas: boolean, nu: Date = new Date()): Promise<ChattLage> {
  const miljo = chattMiljo();
  const [{ data: rader }, { data: prov }, { data: utr }, { data: lista }, avlasning] = await Promise.all([
    db.from("nav_setting").select("key, value").like("key", "chatt.%").limit(50),
    db.from("nav_chatt_prov").select("modell, avtryck, godkand").eq("godkand", true).limit(200),
    db.rpc("nav_chatt_utrymme", { p_miljo: miljo, p_employee: mig }),
    allas ? db.rpc("nav_chatt_forbrukning_alla", { p_miljo: miljo }) : Promise.resolve({ data: null }),
    allas ? lasAvlasning(db, miljo, nu) : Promise.resolve(null),
  ]);
  const inst = lasChattInst((rader ?? []) as { key: string; value: unknown }[]);
  const far = farSlasPa({
    nyckel: !!process.env.ANTHROPIC_API_KEY, avtal: inst.avtal, modell: inst.modell, avtryck: avtryck(),
    godkandaProv: ((prov ?? []) as { modell: string; avtryck: string; godkand: boolean }[]).filter((p) => p.godkand === true).map((p) => provNyckel(p.modell, p.avtryck)),
  });
  const folk = Array.isArray(lista)
    ? (lista as Record<string, unknown>[]).flatMap((x) => (typeof x?.namn === "string" && typeof x.usd === "number" && typeof x.fragor === "number" ? [{ namn: x.namn, usd: x.usd, fragor: x.fragor }] : []))
    : null;
  return { pa: inst.pa, skal: far.ok ? null : far.skal, modell: inst.modell, utrymme: lasUtrymme(utr), allas: allas ? folk : null, avlasning: allas ? avlasning : null };
}
