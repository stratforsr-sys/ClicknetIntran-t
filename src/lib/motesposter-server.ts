import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fullName } from "@/lib/auth";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import type { Motespost } from "@/lib/provision-motor";
import { lasInstallningar, lokalDag, manadFor } from "@/lib/nav2/motesflode";
import { hallatSkal, vantandeFor, type MotesvyIndata, type MotesvyRad, type VantandeMote } from "@/lib/nav2/motesprovision";

/**
 * Mötesprovisionens hämtningar (Möten, uppgift 7).
 *
 * ===========================================================================
 * TVÅ LÄSNINGAR, OLIKA KRETS.
 *
 * `hamtaMotesposter` är motorns: de låsta beloppen (`mote_provision` med en nivå
 * och ett belopp över noll) som `raknaUnderlag` räknar in i sin månad. Med den
 * inloggades token i sidorna (RLS: egna rader, ekonomi/superadmin allas), med
 * service role i `faststallPeriod` (bokföringen måste vara fullständig, samma
 * skäl som hos `hamtaAllaChefsposter`).
 *
 * `hamtaMotesvy` är Provision-vyns sektion: betraktarens EGNA rader, tappade
 * möten och väntande bedömningar. Aldrig någon annans.
 *
 * BOLAGETS NAMN, DAGEN OCH NAMNEN LÄSES MED SERVICE ROLE. RLS på `mote` släpper
 * inte in ekonomi som inte är med i kedjan, och en `!inner`-join mot den hade
 * tyst tappat deras mötesposter ur motorn — pengar som uteblir utan att något
 * ser fel ut. Raderna avgörs alltså av `mote_provision`, och det service role
 * läser bredvid är bara bolagsnamn, mötesdag och för- och efternamn på dem
 * raderna redan pekar på.
 *
 * ALDRIG EN FRÅGA PER MÖTE. Allt som hör till flera möten läses med `in(...)` i
 * bitar, och PostgREST kapar tyst vid 1000 rader, så varje läsning som kan bli
 * större går sida för sida (`lasAlla`).
 * ===========================================================================
 */

const SIDA = 1000;
const BIT = 100;

type Rad = Record<string, unknown>;

/** Läser en fråga sida för sida så att inget kapas tyst vid 1000 rader. Ett fel kastas: en saknad mötespost är pengar som uteblir. */
async function lasAlla(sida: (fran: number, till: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<Rad[]> {
  const ut: Rad[] = [];
  for (let fran = 0; ; fran += SIDA) {
    const { data, error } = await sida(fran, fran + SIDA - 1);
    if (error) throw new Error(`Mötesprovisionen kunde inte läsas: ${error.message}`);
    const rader = (data ?? []) as unknown as Rad[];
    ut.push(...rader);
    if (rader.length < SIDA) return ut;
  }
}

/** `in(...)` i bitar, så att adressen inte blir för lång. */
async function lasIBitar(ider: string[], las: (bit: string[]) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<Rad[]> {
  const unika = [...new Set(ider)];
  const bitar: string[][] = [];
  for (let i = 0; i < unika.length; i += BIT) bitar.push(unika.slice(i, i + BIT));
  const svar = await Promise.all(
    bitar.map(async (bit) => {
      const { data, error } = await las(bit);
      if (error) throw new Error(`Mötesprovisionen kunde inte läsas: ${error.message}`);
      return (data ?? []) as unknown as Rad[];
    }),
  );
  return svar.flat();
}

const dagAv = (v: unknown): string => String(v).slice(0, 10);

async function lasTidszonOchInst(admin: SupabaseClient) {
  const { data } = await admin.from("nav_setting").select("key, value").like("key", "moten.%").limit(100);
  return lasInstallningar((data ?? []) as unknown as { key: string; value: unknown }[]);
}

type MoteInfo = { moteTid: string; hallsAv: string; kedjaId: string; svar: unknown };

/** Mötesdag, kedja och hållare för en mängd möten, och bolagens och personernas namn bredvid. Fyra läsningar oavsett antal. */
async function berika(admin: SupabaseClient, moteIds: string[], personIds: string[]) {
  const moten = new Map<string, MoteInfo>();
  for (const m of await lasIBitar(moteIds, (bit) => admin.from("mote").select("id, kedja_id, mote_tid, halls_av, niva_svar").in("id", bit))) {
    moten.set(String(m.id), { moteTid: String(m.mote_tid), hallsAv: String(m.halls_av), kedjaId: String(m.kedja_id), svar: m.niva_svar });
  }
  const bolagAvKedja = new Map<string, string>();
  for (const k of await lasIBitar([...moten.values()].map((m) => m.kedjaId), (bit) => admin.from("mote_kedja").select("id, bolag_id").in("id", bit))) {
    bolagAvKedja.set(String(k.id), String(k.bolag_id));
  }
  const bolagNamn = new Map<string, string>();
  for (const b of await lasIBitar([...bolagAvKedja.values()], (bit) => admin.from("mote_bolag").select("id, namn").in("id", bit))) {
    bolagNamn.set(String(b.id), String(b.namn));
  }
  const namn = new Map<string, string>();
  const personer = [...personIds, ...[...moten.values()].map((m) => m.hallsAv)];
  for (const p of await lasIBitar(personer, (bit) => admin.from("employee").select("id, first_name, last_name").in("id", bit))) {
    namn.set(String(p.id), fullName({ first_name: String(p.first_name), last_name: String(p.last_name) }));
  }
  const bolagFor = (moteId: string): string => {
    const m = moten.get(moteId);
    const b = m ? bolagAvKedja.get(m.kedjaId) : undefined;
    return (b && bolagNamn.get(b)) || "Bolaget";
  };
  return { moten, namn, bolagFor };
}

/**
 * De låsta mötesbeloppen som motorn räknar in: rader med en nivå och ett belopp
 * över noll, från månaden `franOchMed` ("YYYY-MM-01") och framåt. Motorn räknar var
 * post bara i sin egen månad (`manad`); en rad vars månad redan är fastställd
 * räknas aldrig om, en ändring av den bokas som rättelse i innevarande månad.
 *
 * `klient` är den som läser raderna: den inloggades token (RLS) som standard,
 * service role vid stängningen. Läsfel: stängningen (klient skickad) kastar, vyerna
 * (ingen klient) loggar och ger `[]`.
 */
export async function hamtaMotesposter(franOchMed: string, klient?: SupabaseClient): Promise<Motespost[]> {
  // STÄNGNINGEN (en klient skickas med) KASTAR vid ett läsfel: en månad som fastställs utan sina mötesrader
  // betalar för lite, och fastställelsen går inte att ångra. VYERNA (ingen klient) FÅR ALDRIG KASTA: ett enda
  // läsfel hade tagit ned hela /nav2 och /provision (byggProvision ligger i en Promise.all utan catch).
  // Där blir mötesprovisionen tom och felet loggas, som grannarnas läsningar gör.
  if (klient) return lasMotesposter(franOchMed, klient);
  try {
    return await lasMotesposter(franOchMed, await supabaseServer());
  } catch (e) {
    console.error(`motesposter: läsningen misslyckades, vyn visar ingen mötesprovision: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}

async function lasMotesposter(franOchMed: string, las: SupabaseClient): Promise<Motespost[]> {
  const admin = supabaseAdmin();
  const [inst, rader] = await Promise.all([
    lasTidszonOchInst(admin),
    lasAlla((fran, till) =>
      las
        .from("mote_provision")
        .select("mote_id, employee_id, belopp, niva, delat_med, manad")
        .not("niva", "is", null)
        .gt("belopp", 0)
        .gte("manad", franOchMed)
        .order("mote_id")
        .order("employee_id")
        .range(fran, till),
    ),
  ]);
  if (rader.length === 0) return [];

  const { moten, namn, bolagFor } = await berika(admin, rader.map((r) => String(r.mote_id)), rader.map((r) => r.delat_med).filter((x): x is string => typeof x === "string"));

  return rader.map((r) => {
    const m = moten.get(String(r.mote_id));
    const manad = dagAv(r.manad);
    return {
      mote_id: String(r.mote_id),
      employee_id: String(r.employee_id),
      manad,
      // numeric kommer tillbaka som STRÄNG ur PostgREST: utan Number() blir summeringen en strängkonkatenering.
      belopp: Number(r.belopp),
      niva: r.niva === "hallet" ? "hallet" : "kvalificerat",
      bolag: bolagFor(String(r.mote_id)),
      dag: m ? lokalDag(m.moteTid, inst.tidszon) : manad,
      delat_med_namn: typeof r.delat_med === "string" ? namn.get(r.delat_med) ?? null : null,
    } satisfies Motespost;
  });
}

/**
 * Sektionen Mötesprovision för betraktaren: hens egna rader i `mote_provision`
 * (också tappade och med noll kronor), och de hållna möten där hen väntar på en
 * nivå. Väntande möten läses ur `mote`, eftersom ingen `mote_provision`-rad finns
 * före nivån; kedjorna läses en gång för alla kandidater.
 *
 * Tål en trasig eller saknad inställning (förvalet gäller). Ett fel i själva
 * läsningen ger ingen sektion hellre än en trasig Provision.
 */
export async function hamtaMotesvy(klient: SupabaseClient, jag: string, franOchMed: string): Promise<MotesvyIndata | null> {
  try {
    const admin = supabaseAdmin();
    const inst = await lasTidszonOchInst(admin);
    const mottagare = inst.mottagare.includes(jag);

    const rader = await lasAlla((fran, till) =>
      klient
        .from("mote_provision")
        .select("mote_id, niva, belopp, mojligt, skal, delat_med, manad, ifragasatt_nar, beslut_nar")
        .eq("employee_id", jag)
        .gte("manad", franOchMed)
        .order("mote_id")
        .range(fran, till),
    );

    // Väntande: hållna möten utan nivå efter `moten.galler-fran`, om betraktaren får mötesprovision.
    let kandidatRader: Rad[] = [];
    if (mottagare && inst.gallerFran) {
      const gf = inst.gallerFran;
      kandidatRader = await lasAlla((fran, till) =>
        admin.from("mote").select("id, kedja_id, mote_tid, bokat_av, halls_av, art, foregaende_id").eq("utfall", "hallet").is("niva", null).gte("mote_tid", gf).order("id").range(fran, till),
      );
    }
    if (rader.length === 0 && kandidatRader.length === 0) return { mottagare, rader: [], vantar: [] };

    const moteIds = [...rader.map((r) => String(r.mote_id)), ...kandidatRader.map((r) => String(r.id))];
    const { moten, namn, bolagFor } = await berika(admin, moteIds, rader.map((r) => r.delat_med).filter((x): x is string => typeof x === "string"));

    const vyRader: MotesvyRad[] = rader.map((r) => {
      const id = String(r.mote_id);
      const m = moten.get(id);
      const manad = dagAv(r.manad);
      return {
        moteId: id,
        bolag: bolagFor(id),
        dag: m ? lokalDag(m.moteTid, inst.tidszon) : manad,
        saljare: (m && namn.get(m.hallsAv)) || "",
        niva: r.niva === "kvalificerat" || r.niva === "hallet" ? r.niva : null,
        belopp: Number(r.belopp),
        mojligt: Number(r.mojligt),
        // Tappat: radens eget skäl. Hållet: frågorna som besvarats med nej, ur svaren som låstes.
        skal: typeof r.skal === "string" ? r.skal : r.niva === "hallet" && m ? hallatSkal(m.svar) : null,
        delatMed: typeof r.delat_med === "string" ? namn.get(r.delat_med) ?? null : null,
        manad,
        ifragasattNar: typeof r.ifragasatt_nar === "string" ? r.ifragasatt_nar : null,
        beslutNar: typeof r.beslut_nar === "string" ? r.beslut_nar : null,
      };
    });

    let vantar: MotesvyIndata["vantar"] = [];
    if (kandidatRader.length > 0) {
      // Kedjorna för alla kandidater, en gång: `ursprungligBokare` vandrar bakåt i dem.
      const kedjeRader = await lasIBitar(kandidatRader.map((r) => String(r.kedja_id)), (bit) =>
        admin.from("mote").select("id, art, foregaende_id, bokat_av").in("kedja_id", bit),
      );
      const karta = new Map(kedjeRader.map((m) => [String(m.id), { art: String(m.art), foregaende: typeof m.foregaende_id === "string" ? m.foregaende_id : null, bokatAv: String(m.bokat_av) }]));
      const kandidater: VantandeMote[] = kandidatRader.map((r) => {
        const id = String(r.id);
        const tid = String(r.mote_tid);
        return {
          id,
          art: String(r.art),
          foregaende: typeof r.foregaende_id === "string" ? r.foregaende_id : null,
          bokatAv: String(r.bokat_av),
          hallsAv: String(r.halls_av),
          moteTid: tid,
          bolag: bolagFor(id),
          dag: lokalDag(tid, inst.tidszon),
          manad: manadFor(tid, inst.tidszon),
          saljare: namn.get(String(r.halls_av)) ?? "",
        };
      });
      vantar = vantandeFor(jag, kandidater, karta, inst);
    }
    return { mottagare, rader: vyRader, vantar };
  } catch {
    return null;
  }
}
