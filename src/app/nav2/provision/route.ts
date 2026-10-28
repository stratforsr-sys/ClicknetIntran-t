import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { svensktDatum } from "@/lib/klocka";
import { laggOvrigBonus } from "@/app/(app)/provision/actions";
import { faststallPeriod, markeraUtbetald } from "@/app/(app)/provision/stangning";
import { sparaMal, taBortMal } from "@/app/(app)/provision/mal/actions";
import { sparaChefssats, sparaKonsekvenssteg, sparaNiva, stangNiva, taBortKonsekvenssteg } from "@/app/(app)/provision/regler/actions";
import { skapaMote } from "@/app/(app)/kalender/moten/actions";
import { nivaFor } from "@/lib/nav2/forma";
import { LASLAGE_TEXT, SKRIVLAGE, sammaUrsprung } from "@/lib/nav2/skrivlage";
import { medNyckel } from "@/lib/nav2/nyckel";

export const dynamic = "force-dynamic";

/**
 * Nav 2.0: allt som ändrar provisionen, i en rutt.
 *
 * ===========================================================================
 * REPOTS ACTIONS, MED SAMMA FÄLT. Fastställa (`faststallPeriod`), övrig bonus
 * (`laggOvrigBonus`), målen (`sparaMal`, `taBortMal`) och trappan (`sparaNiva`,
 * `stangNiva` med samma `verkan` som utkastets tre val) går genom repots egna
 * actions — samma behörighet, samma logg.
 *
 * Det nya (0087): att ta bort en övrig bonus i en öppen månad. En post skrivs
 * aldrig om (`commission_entry_ar_last`), så borttagningen är en negativ post
 * med samma skäl och en rad i `commission_entry_reversal`, båda skrivna i ett
 * steg av `ta_bort_ovrig_bonus` (0215). Att lägga en övrig bonus går genom
 * `medNyckel`, så samma begäran två gånger blir en post. Att ta bort en
 * kommande trappa tar bort nivåerna som inte börjat gälla och öppnar de som
 * de skulle ersätta. "Påminn mig" om fastställandet är ett möte i kalendern
 * (`skapaMote`), som utkastets kalenderpost.
 *
 * Chefens sats (beställaren 2026-10-20): bara superadmin, och rutten frågar
 * själv innan något annat. `sparaChefssats` kräver dessutom säljchef eller VD,
 * som på /provision/regler. En sats som inte börjat gälla går att ta tillbaka,
 * som en kommande trappa.
 *
 * Gamla Nav G (svar 13): konsekvenstrappan för ogiltig frånvaro
 * (`konsekvens` = repots `sparaKonsekvenssteg` och `taBortKonsekvenssteg`,
 * säljchef och VD) och att markera en fastställd månad som utbetald
 * (`utbetald` = `markeraUtbetald`, ekonomi och VD).
 * ===========================================================================
 *
 * LÄSLÄGE: står `SKRIVLAGE.provision` på false svarar rutten 423 innan något
 * skrivs.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MANAD = /^\d{4}-\d{2}$/;
const VERKAN: Record<string, string> = { manad: "denna_manad", nu: "nu", nasta: "nasta_manad" };

type Svar = { ok?: string; fel?: string; [k: string]: unknown };
const svar = (data: Svar, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });
const fran = (s: { fel?: string; ok?: string }, okText: string) => (s.fel ? svar({ fel: s.fel }, 400) : svar({ ok: s.ok ?? okText }));

function form(falt: Record<string, unknown>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(falt)) if (v !== undefined && v !== null) f.set(k, String(v));
  return f;
}

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
  const manad = String(b.manad ?? "");

  if ((handling === "chefssats" || handling === "chefssats-bort") && nivaFor(user.roles) !== "superadmin") {
    return svar({ fel: "Bara en superadmin sätter chefens sats." }, 403);
  }
  if (!SKRIVLAGE.provision) return svar({ fel: LASLAGE_TEXT, laslage: true }, 423);
  const db = supabaseAdmin();

  try {
    switch (handling) {
      case "faststall":
        if (!MANAD.test(manad)) return svar({ fel: "Okänd månad." }, 400);
        return fran(await faststallPeriod({}, form({ period_month: `${manad}-01` })), "Månaden är fastställd och bokförd.");

      case "bonus":
        if (!MANAD.test(manad)) return svar({ fel: "Okänd månad." }, 400);
        // Granskningen S06 (G1): ett dubbelklick eller ett nytt försök efter
        // tidsgränsen bär samma X-Nav-Nyckel och får samma svar, inte en post till.
        return medNyckel(request, mig, async () =>
          fran(
            await laggOvrigBonus({}, form({ employee_id: b.vem, period_month: `${manad}-01`, amount: b.belopp, note: b.skal, sales_order_id: b.order ?? "" })),
            "Bonusen är bokförd.",
          ),
        );

      case "bonus-bort": {
        // Samma krets som laggOvrigBonus.
        if (!hasRole(user, "sales_manager", "finance", "ceo")) return svar({ fel: "Bara säljchef, ekonomi och VD får ta bort en övrig bonus." }, 403);
        const id = String(b.id ?? "");
        if (!UUID.test(id)) return svar({ fel: "Okänd bonus." }, 400);
        // Granskningen S06 (D4/C5): låset, prövningen, motposten och kopplingen
        // i en transaktion (0215). Ett andra anrop väntar på det första och får
        // pv:redan_borttagen; faller kopplingen rullas motposten tillbaka.
        const { data: motpost, error } = await db.rpc("ta_bort_ovrig_bonus", { p_aktor: mig, p_post: id });
        if (error || typeof motpost !== "string") {
          const kod = error?.message ?? "";
          if (kod.includes("pv:ogiltig")) return svar({ fel: "Bonusen finns inte." }, 404);
          if (kod.includes("pv:redan_borttagen")) return svar({ fel: "Bonusen är redan borttagen." }, 400);
          if (kod.includes("pv:faststalld")) return svar({ fel: "Månaden är fastställd. En bonus i en fastställd månad rättas med en ny post i den öppna månaden." }, 400);
          return svar({ fel: `Bonusen togs inte bort: ${kod || "okänt fel"}` }, 500);
        }
        await db.from("audit_log").insert({ actor_id: mig, action: "commission.bonus_removed", object_type: "commission_entry", object_id: id, meta: { reversal: motpost } });
        revalidatePath("/provision");
        return svar({ ok: "Bonusen är borttagen. Huvudboken visar en negativ post med samma skäl." });
      }

      case "mal": {
        if (!MANAD.test(manad)) return svar({ fel: "Okänd månad." }, 400);
        const rader = Array.isArray(b.rader) ? (b.rader as { id: string; o: number | null; k: number | null }[]) : [];
        let n = 0;
        for (const r of rader.slice(0, 100)) {
          if (!UUID.test(String(r.id))) continue;
          const s =
            r.o === null && r.k === null
              ? await taBortMal({}, form({ employee_id: r.id, period_month: `${manad}-01` }))
              : await sparaMal({}, form({ employee_id: r.id, period_month: `${manad}-01`, target_orders: r.o ?? "", target_amount: r.k ?? "" }));
          if (s.fel) return svar({ fel: s.fel }, 400);
          n++;
        }
        return svar({ ok: `${n} mål för månaden är sparade.` });
      }

      case "trappa": {
        const verkan = VERKAN[String(b.fran ?? "")];
        if (!verkan) return svar({ fel: "Välj från när trappan ska gälla." }, 400);
        const nivaer = Array.isArray(b.nivaer) ? (b.nivaer as { t: number; a: number; enhet?: string }[]) : [];
        const borta = Array.isArray(b.borta) ? (b.borta as number[]) : [];
        for (const t of borta) {
          const s = await stangNiva({}, form({ threshold: t, verkan }));
          if (s.fel) return svar({ fel: s.fel }, 400);
        }
        for (const n of nivaer) {
          const s = await sparaNiva({}, form({ threshold: n.t, amount: n.a, unit: n.enhet || "amount_fixed", verkan }));
          if (s.fel) return svar({ fel: s.fel }, 400);
        }
        return svar({ ok: verkan === "nasta_manad" ? "Den nya trappan gäller från nästa månad." : verkan === "nu" ? "Den nya trappan gäller från i dag." : "Den nya trappan gäller allt intjänat den här månaden." });
      }

      case "trappa-bort": {
        // B13 (beställaren 2026-10-23): bara Superadmin. Samma vakt som repots kravRegelagare.
        if (nivaFor(user.roles) !== "superadmin") return svar({ fel: "Bara en superadmin ändrar provisionsreglerna." }, 403);
        const idag = svensktDatum(new Date());
        const { data: kommande } = await db.from("commission_bonus_level").select("id, valid_from").gt("valid_from", idag);
        if (!kommande || !kommande.length) return svar({ fel: "Det finns ingen kommande trappa." }, 400);
        const datum = [...new Set(kommande.map((k) => k.valid_from as string))];
        await db.from("commission_bonus_level").delete().gt("valid_from", idag);
        await db.from("commission_bonus_level").update({ valid_to: null }).in("valid_to", datum);
        await db.from("audit_log").insert({ actor_id: mig, action: "commission_bonus_level.future_removed", object_type: "commission_bonus_level", object_id: "kommande", meta: { fran: datum } });
        revalidatePath("/provision");
        return svar({ ok: "Den kommande trappan är borttagen." });
      }

      case "chefssats": {
        const verkan = VERKAN[String(b.fran ?? "")];
        if (!verkan) return svar({ fel: "Välj från när satsen ska gälla." }, 400);
        if (!UUID.test(String(b.vem ?? ""))) return svar({ fel: "Välj vem som får övertäcket." }, 400);
        return fran(
          await sparaChefssats({}, form({ employee_id: b.vem, override_percent: b.overtack, own_sale_percent: b.egen, verkan })),
          "Chefens sats är sparad.",
        );
      }

      case "chefssats-bort": {
        // Samma krets som sparaChefssats. Den öppna raden har inte börjat gälla; raden före den gäller vidare.
        // B13 (beställaren 2026-10-23): bara Superadmin. Samma vakt som repots kravRegelagare.
        if (nivaFor(user.roles) !== "superadmin") return svar({ fel: "Bara en superadmin ändrar provisionsreglerna." }, 403);
        const idag = svensktDatum(new Date());
        const { data: kommande } = await db.from("manager_commission_rate").select("id, valid_from").is("valid_to", null).gt("valid_from", idag).maybeSingle();
        if (!kommande) return svar({ fel: "Det finns ingen kommande sats." }, 400);
        const dag = String(kommande.valid_from);
        const { error } = await db.from("manager_commission_rate").delete().eq("id", kommande.id);
        if (error) return svar({ fel: `Satsen togs inte bort: ${error.message}` }, 500);
        await db.from("manager_commission_rate").update({ valid_to: null }).eq("valid_to", dag);
        await db.from("audit_log").insert({ actor_id: mig, action: "manager_commission_rate.future_removed", object_type: "manager_commission_rate", object_id: kommande.id, meta: { valid_from: dag } });
        revalidatePath("/provision/regler");
        revalidatePath("/provision");
        revalidatePath("/order");
        return svar({ ok: "Den kommande satsen är borttagen. Satsen som gäller i dag gäller vidare." });
      }

      case "konsekvens": {
        // Hela trappan på en gång: de borttagna stegen först, sedan varje steg som det står.
        const steg = Array.isArray(b.steg) ? (b.steg as { ordning: number; antal: number; manader: number; atgard: string; notifiera: boolean }[]).slice(0, 10) : [];
        const borta = Array.isArray(b.borta) ? (b.borta as number[]).slice(0, 10) : [];
        for (const o of borta) {
          const s = await taBortKonsekvenssteg({}, form({ ordning: o }));
          if (s.fel) return svar({ fel: s.fel }, 400);
        }
        for (const x of steg) {
          const s = await sparaKonsekvenssteg({}, form({ ordning: x.ordning, antal_handelser: x.antal, periodlangd_manader: x.manader, atgard: x.atgard, notifiera: x.notifiera ? "on" : undefined }));
          if (s.fel) return svar({ fel: s.fel }, 400);
        }
        return svar({ ok: "Trappan för ogiltig frånvaro är sparad. Den gäller framåt; beslutade händelser behåller sitt steg." });
      }

      case "utbetald":
        if (!MANAD.test(manad)) return svar({ fel: "Okänd månad." }, 400);
        return fran(await markeraUtbetald({}, form({ period_month: `${manad}-01` })), "Månaden är markerad som utbetald.");

      case "pamin": {
        const dag = String(b.dag ?? "");
        const s = await skapaMote({
          rubrik: `Fastställ provisionen för ${String(b.manadNamn ?? "månaden")}`.slice(0, 200),
          dag,
          start: 900,
          minuter: 15,
          deltagare: [],
          agenda: "Perioder och underlag i provisionsvyn.",
        });
        return "fel" in s && s.fel ? svar({ fel: s.fel }, 400) : svar({ ok: `Påminnelsen ligger i kalendern ${dag} 15:00.` });
      }

      default:
        return svar({ fel: "Okänd handling." }, 400);
    }
  } catch (e) {
    return svar({ fel: e instanceof Error ? e.message : "Något gick fel." }, 500);
  }
}
