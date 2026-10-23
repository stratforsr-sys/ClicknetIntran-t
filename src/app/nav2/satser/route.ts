import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { svensktDatum } from "@/lib/klocka";
import { farSeLonekostnad } from "@/lib/lonekostnad-server";
import { raknaPeriod, sparaFodelsear, sparaIntakt, sparaLon, sparaSats } from "@/app/(app)/lonekostnad/actions";
import { nivaFor } from "@/lib/nav2/forma";
import { LASLAGE_TEXT, SKRIVLAGE, sammaUrsprung } from "@/lib/nav2/skrivlage";
import { BARANDE, kanSluta, satsNyckel, slutNekas } from "@/lib/nav2/satsforma";

export const dynamic = "force-dynamic";

/**
 * Nav 2.0: Satser och löner (Inställningar), allt som ändrar dem.
 *
 * ===========================================================================
 * REPOTS ACTIONS, MED SAMMA FÄLT. En ny sats är `sparaSats`, en lön
 * `sparaLon`, ett födelseår `sparaFodelsear` — samma kontroller, samma logg
 * (`cost.rate_set`, `cost.salary_set`, `cost.birth_year_set`).
 *
 * Det utkastet gör utöver repot, och som byggs här:
 *   - Gäller till: `valid_to` på raden (kolumnen finns sedan 0025).
 *   - Ägare, översyn och slut på en befintlig rad, eller ägare och översyn
 *     på alla gällande rader utan ägare (`cost.rate_changed`).
 *   - Ersätt: en sats från samma dag rättas. Den gamla raden sparas i
 *     `cost_rate_replaced` (0190) och tas bort, och den nya läggs in med
 *     `sparaSats` (`cost.rate_replaced`). Den unika nyckeln släpper igenom
 *     två rader med samma dag när `applies_to` är null, så repots upsert
 *     ersätter inte av sig själv.
 *   - Skatteverkets rättelse: samma två rörelser för varje rad.
 *
 * Gamla Nav G steg 3 (svar 14): intäkterna per löneperiod (`intakt` =
 * `sparaIntakt`, en rad per person) och beräkningen (`rakna` = `raknaPeriod`),
 * alltså täckningsgraden som gamla /lonekostnad visade.
 * ===========================================================================
 *
 * VEM: den som har `payroll_cost_viewer` (repots krav, K26) och är superadmin
 * (utkastets behörighetsmatris). Rutten frågar om båda innan läsläget prövas.
 *
 * LÄSLÄGE: står `SKRIVLAGE.satser` på false svarar rutten 423 innan något
 * skrivs. `employer_fee_young`, `no_fee_age_min` och Ersatta kräver 0190.
 *
 * Granskningen S06 (D8): ett slutdatum på en bärande sats (full avgift och
 * åldersgränsen för äldre; `BARANDE` i satsforma.ts) nekas med 400 innan något sparas,
 * om ingen rad med samma nyckel tar vid senast dagen efter (`kanSluta`).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATUM = /^\d{4}-\d{2}-\d{2}$/;
/** Enheten följer satsen. Klienten skickar den inte. */
const ENHET: Record<string, string> = {
  employer_fee_standard: "percent",
  employer_fee_reduced: "percent",
  employer_fee_reduced_cap: "amount",
  young_age_min: "years",
  young_age_max: "years",
  senior_age_min: "years",
  contribution_margin: "percent",
  absence_cost_factor: "percent",
  employer_fee_young: "percent",
  no_fee_age_min: "years",
};
const UTAN_0190 = "Den här satsen kräver migration 0190, som inte är körd än. Ingenting ändrades.";

type Svar = { ok?: string; fel?: string; [k: string]: unknown };
const svar = (data: Svar, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });
const str = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);
const datumEllerNull = (v: unknown) => (DATUM.test(String(v ?? "")) ? String(v) : null);

function form(falt: Record<string, unknown>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(falt)) if (v !== undefined && v !== null) f.set(k, String(v));
  return f;
}

type Rad = {
  id: string; kind: string; applies_to: string | null; unit: string; value: number | string; valid_from: string; valid_to: string | null;
  owner_id: string | null; review_due: string | null; note: string | null; created_by: string | null; created_at: string;
};
const RAD = "id, kind, applies_to, unit, value, valid_from, valid_to, owner_id, review_due, note, created_by, created_at";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user?.employee) return svar({ fel: "Du måste vara inloggad." }, 401);
  if (!sammaUrsprung(request)) return svar({ fel: "Fel ursprung." }, 403);
  const mig = user.employee.id;

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return svar({ fel: "Ogiltig begäran." }, 400);
  }
  const handling = String(b.handling ?? "");

  if (!farSeLonekostnad(user) || nivaFor(user.roles) !== "superadmin") {
    return svar({ fel: "Satser och löner ändras av en superadmin med behörigheten för lönekostnad." }, 403);
  }
  if (!SKRIVLAGE.satser) return svar({ fel: LASLAGE_TEXT, laslage: true }, 423);
  const db = supabaseAdmin();
  const logga = (action: string, objectId: string, meta: unknown) =>
    db.from("audit_log").insert({ actor_id: mig, action, object_type: "cost", object_id: objectId, meta });

  /** Raden för en sats från en dag, om den finns. */
  async function radFran(kind: string, applies: string | null, fran: string): Promise<Rad | null> {
    const q = db.from("cost_rate").select(RAD).eq("kind", kind).eq("valid_from", fran);
    const { data } = await (applies === null ? q.is("applies_to", null) : q.eq("applies_to", applies)).limit(1);
    return ((data ?? [])[0] as unknown as Rad | undefined) ?? null;
  }

  /** Den gamla raden till Ersatta, sedan bort ur cost_rate. */
  async function ersatt(rad: Rad, skal: string): Promise<string | null> {
    const { error: kopiaFel } = await db.from("cost_rate_replaced").insert({
      rate_id: rad.id, kind: rad.kind, applies_to: rad.applies_to, unit: rad.unit, value: rad.value,
      valid_from: rad.valid_from, valid_to: rad.valid_to, owner_id: rad.owner_id, review_due: rad.review_due,
      note: rad.note, created_by: rad.created_by, created_at: rad.created_at, replaced_by: mig, reason: skal.slice(0, 300),
    });
    if (kopiaFel) return /cost_rate_replaced/.test(kopiaFel.message) ? UTAN_0190 : kopiaFel.message;
    const { error } = await db.from("cost_rate").delete().eq("id", rad.id);
    if (error) {
      await db.from("cost_rate_replaced").delete().eq("rate_id", rad.id).eq("replaced_by", mig);
      return error.message;
    }
    await logga("cost.rate_replaced", rad.kind, { varde: Number(rad.value), galler_fran: rad.valid_from, galler: rad.applies_to, skal });
    return null;
  }

  /** Ångrar `ersatt` när den nya raden inte gick att lägga in: den gamla tillbaka, kopian bort. */
  async function aterstall(rad: Rad) {
    await db.from("cost_rate").insert({
      id: rad.id, kind: rad.kind, applies_to: rad.applies_to, unit: rad.unit, value: rad.value, valid_from: rad.valid_from, valid_to: rad.valid_to,
      owner_id: rad.owner_id, review_due: rad.review_due, note: rad.note, created_by: rad.created_by, created_at: rad.created_at,
    });
    await db.from("cost_rate_replaced").delete().eq("rate_id", rad.id).eq("replaced_by", mig);
  }

  /**
   * Granskningen S06 (D8): får en bärande sats sluta `till`? Null betyder ja,
   * annars texten att neka med. `extra` är rader som läggs in i samma begäran
   * (Skatteverkets rättelse), `utom` rader som tas bort i den.
   */
  async function slutFel(
    kind: string,
    applies: string | null,
    fran: string,
    till: string | null,
    extra: { kind: string; applies: string | null; fran: string }[] = [],
    utom: { kind: string; fran: string }[] = [],
  ): Promise<string | null> {
    if (!till || !BARANDE.has(kind)) return null;
    const q = db.from("cost_rate").select("kind, applies_to, valid_from").eq("kind", kind);
    const { data } = await (applies === null ? q.is("applies_to", null) : q.eq("applies_to", applies));
    const alla = [
      ...((data ?? []) as { kind: string; applies_to: string | null; valid_from: string }[])
        .filter((r) => !utom.some((u) => u.kind === r.kind && u.fran === String(r.valid_from).slice(0, 10)))
        .map((r) => ({ nyckel: satsNyckel(r.kind, r.applies_to), giltig_fran: String(r.valid_from).slice(0, 10) })),
      ...extra.map((r) => ({ nyckel: satsNyckel(r.kind, r.applies), giltig_fran: r.fran })),
    ];
    return kanSluta({ nyckel: satsNyckel(kind, applies), giltig_fran: fran, giltig_till: till }, alla) ? null : slutNekas(till);
  }

  /** En ny rad med repots sparaSats, och slutdatumet på den. */
  async function nySats(x: { kind: string; applies: string | null; value: number; fran: string; till: string | null; agare: string | null; oversyn: string | null; note: string }): Promise<string | null> {
    const s = await sparaSats({}, form({ kind: x.kind, applies_to: x.applies ?? "", unit: ENHET[x.kind], value: x.value, valid_from: x.fran, review_due: x.oversyn ?? "", owner_id: x.agare ?? "", note: x.note }));
    if (s.fel) return /cost_rate_kind_check/.test(s.fel) ? UTAN_0190 : s.fel;
    if (x.till) {
      const ny = await radFran(x.kind, x.applies, x.fran);
      if (ny) {
        const { error } = await db.from("cost_rate").update({ valid_to: x.till }).eq("id", ny.id);
        if (error) return `Satsen sparades, men inte slutdatumet: ${error.message}`;
      }
    }
    return null;
  }

  function lasSats(r: Record<string, unknown>): { fel: string } | { kind: string; applies: string | null; value: number; fran: string; till: string | null; agare: string | null; oversyn: string | null; note: string } {
    const kind = str(r.kind, 40);
    if (!ENHET[kind]) return { fel: "Okänd sats." };
    const applies = kind === "absence_cost_factor" ? str(r.applies, 40) || null : null;
    if (kind === "absence_cost_factor" && !applies) return { fel: "Välj frånvarotyp." };
    const value = Number(String(r.value ?? "").replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(value) || value < 0) return { fel: "Värdet måste vara ett tal som inte är negativt." };
    if (ENHET[kind] === "percent" && value > 100) return { fel: "En procentsats ligger mellan 0 och 100." };
    const fran = datumEllerNull(r.fran);
    if (!fran) return { fel: "Välj vilket datum satsen gäller från." };
    const till = datumEllerNull(r.till);
    if (till && till < fran) return { fel: "Slutdatumet kan inte ligga före startdatumet." };
    const agare = UUID.test(String(r.agare ?? "")) ? String(r.agare) : null;
    return { kind, applies, value, fran, till, agare, oversyn: datumEllerNull(r.oversyn), note: str(r.note) };
  }

  try {
    switch (handling) {
      case "sats": {
        const x = lasSats(b);
        if ("fel" in x) return svar({ fel: x.fel }, 400);
        const nej = await slutFel(x.kind, x.applies, x.fran, x.till);
        if (nej) return svar({ fel: nej }, 400);
        const gammal = await radFran(x.kind, x.applies, x.fran);
        if (gammal && b.ersatt !== true) return svar({ fel: `Det finns redan en sats från ${x.fran}. Ersätt den, eller välj ett annat datum.` }, 400);
        if (gammal) {
          const fel = await ersatt(gammal, "Rättad samma dag i Satser och löner.");
          if (fel) return svar({ fel }, 400);
        }
        const fel = await nySats(x);
        if (fel) {
          if (gammal) await aterstall(gammal);
          return svar({ fel }, 400);
        }
        return svar({ ok: `Satsen är sparad från ${x.fran}.${gammal ? " Den gamla står kvar under Ersatta." : ""}` });
      }

      case "skv": {
        // Skatteverkets rättelse: raderna den ersätter, sedan raderna den lägger in.
        const skal = `Skatteverket: ${str(b.regel, 120) || "rättelse"}`;
        const bort = Array.isArray(b.ersatt) ? (b.ersatt as unknown[]).slice(0, 20) : [];
        const in_ = Array.isArray(b.rader) ? (b.rader as unknown[]).slice(0, 20) : [];
        const lasta = in_.map((r) => lasSats((r ?? {}) as Record<string, unknown>));
        const fel0 = lasta.find((x) => "fel" in x) as { fel: string } | undefined;
        if (fel0) return svar({ fel: fel0.fel }, 400);
        {
          // Slutdatumen prövas innan något ersätts: raderna i rättelsen räknas
          // som efterföljare, och de som den tar bort gör det inte.
          const nya = lasta as Exclude<ReturnType<typeof lasSats>, { fel: string }>[];
          const utom = bort.map((r) => (Array.isArray(r) ? (r as unknown[]).map(String) : ["", ""])).map(([kind, fran]) => ({ kind, fran }));
          for (const x of nya) {
            const nej = await slutFel(x.kind, x.applies, x.fran, x.till, nya.filter((y) => y !== x), utom);
            if (nej) return svar({ fel: nej }, 400);
          }
        }
        for (const r of bort) {
          const [kind, fran] = Array.isArray(r) ? (r as unknown[]).map(String) : ["", ""];
          if (!ENHET[kind] || !DATUM.test(fran)) continue;
          const g = await radFran(kind, null, fran);
          if (g) {
            const fel = await ersatt(g, skal);
            if (fel) return svar({ fel }, 400);
          }
        }
        let n = 0;
        for (const x of lasta as Exclude<ReturnType<typeof lasSats>, { fel: string }>[]) {
          const g = await radFran(x.kind, x.applies, x.fran);
          if (g) {
            const fel = await ersatt(g, skal);
            if (fel) return svar({ fel }, 400);
          }
          const fel = await nySats(x);
          if (fel) {
            if (g) await aterstall(g);
            return svar({ fel: n ? `${n} rader är inlagda, sedan: ${fel}` : fel }, 400);
          }
          n++;
        }
        return svar({ ok: `${n} ${n === 1 ? "rad" : "rader"} enligt Skatteverket. Det som ersattes står kvar under Ersatta.` });
      }

      case "agare": {
        const agare = UUID.test(String(b.agare ?? "")) ? String(b.agare) : null;
        const oversyn = datumEllerNull(b.oversyn);
        if (b.id === "alla") {
          // Ägare och översyn på de gällande raderna som saknar ägare.
          const ids = (Array.isArray(b.ids) ? (b.ids as unknown[]) : []).map(String).filter((x) => UUID.test(x)).slice(0, 60);
          if (!agare || !ids.length) return svar({ fel: "Välj en ägare." }, 400);
          const { data: andrade, error } = await db.from("cost_rate").update({ owner_id: agare, ...(oversyn ? { review_due: oversyn } : {}) }).in("id", ids).is("owner_id", null).select("id");
          if (error) return svar({ fel: error.message }, 400);
          const n = (andrade ?? []).length;
          await logga("cost.rate_changed", "alla", { agare, oversyn, antal: n });
          return svar({ ok: `${n} ${n === 1 ? "sats har" : "satser har"} fått en ägare.` });
        }
        const id = String(b.id ?? "");
        if (!UUID.test(id)) return svar({ fel: "Okänd sats." }, 400);
        const { data: r0 } = await db.from("cost_rate").select(RAD).eq("id", id).maybeSingle();
        const rad = r0 as unknown as Rad | null;
        if (!rad) return svar({ fel: "Satsen finns inte." }, 404);
        const till = datumEllerNull(b.till);
        if (till && till < String(rad.valid_from).slice(0, 10)) return svar({ fel: "Slutdatumet kan inte ligga före startdatumet." }, 400);
        // Ett oförändrat slutdatum prövas inte igen: ägare och översyn ska gå att sätta på en äldre rad.
        if (till && till !== (rad.valid_to ? String(rad.valid_to).slice(0, 10) : null)) {
          const nej = await slutFel(rad.kind, rad.applies_to, String(rad.valid_from).slice(0, 10), till);
          if (nej) return svar({ fel: nej }, 400);
        }
        const { error } = await db.from("cost_rate").update({ owner_id: agare, review_due: oversyn, valid_to: till }).eq("id", id);
        if (error) return svar({ fel: error.message }, 400);
        await logga("cost.rate_changed", rad.kind, { agare, oversyn, galler_till: till, galler_fran: rad.valid_from, galler: rad.applies_to });
        return svar({ ok: "Satsen är ändrad." });
      }

      case "lon": {
        const vem = String(b.vem ?? "");
        if (!UUID.test(vem)) return svar({ fel: "Okänd person." }, 400);
        const belopp = String(b.belopp ?? "").replace(/\s/g, "");
        if (!/^\d+$/.test(belopp)) return svar({ fel: "Skriv lönen i hela kronor, till exempel 27500." }, 400);
        const fran = datumEllerNull(b.fran);
        if (!fran) return svar({ fel: "Välj vilket datum lönen gäller från." }, 400);
        const s = await sparaLon({}, form({ employee_id: vem, monthly_salary: belopp, valid_from: fran }));
        return s.fel ? svar({ fel: s.fel }, 400) : svar({ ok: `Löneuppgiften är sparad. Den gäller från ${fran}.` });
      }

      case "ar": {
        const vem = String(b.vem ?? "");
        if (!UUID.test(vem)) return svar({ fel: "Okänd person." }, 400);
        const ar = String(b.ar ?? "").trim();
        const max = Number(svensktDatum(new Date()).slice(0, 4)) - 15;
        if (!/^\d{4}$/.test(ar) || +ar < 1900 || +ar > max) return svar({ fel: "Året ser inte rimligt ut. Det ska vara ett fyrsiffrigt årtal för någon som är minst 15 år." }, 400);
        const s = await sparaFodelsear({}, form({ employee_id: vem, birth_year: ar }));
        return s.fel ? svar({ fel: s.fel }, 400) : svar({ ok: s.ok ?? "Födelseåret är sparat." });
      }

      case "intakt": {
        const period = String(b.period ?? "");
        if (!UUID.test(period)) return svar({ fel: "Okänd löneperiod." }, 400);
        const rader = (Array.isArray(b.rader) ? (b.rader as { vem: string; belopp: unknown }[]) : []).slice(0, 100);
        let n = 0;
        for (const r of rader) {
          const belopp = String(r.belopp ?? "").replace(/\s/g, "");
          if (!UUID.test(String(r.vem ?? "")) || !/^\d+$/.test(belopp)) continue;
          const s = await sparaIntakt({}, form({ period_id: period, employee_id: r.vem, amount: belopp }));
          if (s.fel) return svar({ fel: n ? `${n} intäkter sparade, sedan: ${s.fel}` : s.fel }, 400);
          n++;
        }
        return n ? svar({ ok: `${n} ${n === 1 ? "intäkt" : "intäkter"} sparade. Räkna perioden för att se täckningsbidraget.` }) : svar({ fel: "Skriv intäkten i hela kronor." }, 400);
      }

      case "rakna": {
        const period = String(b.period ?? "");
        if (!UUID.test(period)) return svar({ fel: "Okänd löneperiod." }, 400);
        const s = await raknaPeriod({}, form({ period_id: period }));
        return s.fel ? svar({ fel: s.fel }, 400) : svar({ ok: s.ok ?? "Perioden är räknad." });
      }

      default:
        return svar({ fel: "Okänd handling." }, 400);
    }
  } catch (e) {
    return svar({ fel: e instanceof Error ? e.message : "Något gick fel." }, 500);
  }
}
