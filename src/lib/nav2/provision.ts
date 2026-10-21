import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { fullName, hasRole, type CurrentUser } from "@/lib/auth";
import { svensktDatum } from "@/lib/klocka";
import { hamtaAllProvision, hamtaProvision } from "@/lib/provision-server";
import { manadFore, manadsnyckel } from "@/lib/provision";
import { hamtaChefsposter, hamtaOrder, hamtaOrderFor, type Orderrad } from "@/lib/order-server";
import { hamtaNivaer, hamtaPerioder } from "@/lib/bonus-server";
import { hamtaKriterier, hamtaKvPerManad, hamtaPolicyer, hamtaSamtal } from "@/lib/kv-server";
import { hamtaMal } from "@/lib/saljmal-server";
import { hamtaGodkandaFran, hamtaMinaHandelser, hamtaRegler } from "@/lib/konsekvens-server";
import { formaProvision, type NdChefssats, type NdProvision, type Post } from "./provisionforma";
import { nivaFor } from "./forma";
import { SKRIVLAGE } from "./skrivlage";

export type { NdProvision } from "./provisionforma";

/**
 * Nav 2.0: Provision, med samma motor som /provision.
 *
 * ===========================================================================
 * UTKASTETS EGEN MOTOR ANVANDS INTE. Varje manad, varje person, raknas har med
 * repots `raknaUnderlag` / `underlagForAlla` pa samma material som sidan:
 * orderna (RLS), trappan (`hamtaNivaer`), K&V (`hamtaKvPerManad`),
 * konsekvenslaget (`lagenPerPerson`) och overtacken (`hamtaChefsposter`).
 *
 * En STANGD manad ar huvudboken (`commission_entry`), precis som pa sidan:
 * summan ar det bokforda och raderna ar posterna. En OPPEN manad ar motorns
 * rader plus det som bokforts for hand i den, och summan ar bada.
 *
 * Takten ar `takta`, malen `hamtaMal`, varningen `varningslage`. Utkastet far
 * de fardiga talen och ritar dem i sina former.
 * ===========================================================================
 *
 * Krets som pa sidan: saljchef, VD och ekonomi ser alla (`provisionschef`),
 * alla andra bara sig sjalva. RLS avgor dessutom vad som gar att lasa.
 *
 * 0087: en ovrig bonus som tagits bort ar tva poster i huvudboken (bonusen och
 * den negativa rattelsen); listan visar ingen av dem, summorna ar oforandrade.
 * Historiken fore motorn ar lonesystemets summor (`commission_history`).
 * Skrivningar gar genom /nav2/provision, bakom SKRIVLAGE.provision.
 *
 * Chefens sats (bestallaren 2026-10-20): superadmin satter den, sa bara
 * superadmin far alla versioner och mottagarna. Mottagarna ar som repots
 * `hamtaSaljbara`: aktiva med rollen saljchef eller VD.
 */

type Chefsrad = { id: string; employee_id: string; override_percent: number | string; own_sale_percent: number | string; valid_from: string; valid_to: string | null; set_by: string | null };

export async function byggProvision(supabase: SupabaseClient, user: CurrentUser): Promise<NdProvision> {
  const mig = user.employee!.id;
  const provisionschef = hasRole(user, "finance", "ceo", "sales_manager");
  const malchef = hasRole(user, "sales_manager", "ceo");
  const bokforare = hasRole(user, "finance", "ceo");
  const idag = manadsnyckel();
  const idagsDatum = svensktDatum(new Date());
  const manader = Array.from({ length: 12 }, (_, i) => manadFore(idag, i));
  const franOchMed = manader[manader.length - 1];

  const [poster, material, nivaer, perioder, minaHandelser, regler, godkanda, kvPerManad, mal, chefsposter, kvSamtal, policyer, kriterier, { data: personrader }] =
    await Promise.all([
      provisionschef ? hamtaAllProvision(franOchMed) : hamtaProvision(mig, franOchMed),
      provisionschef ? hamtaOrder(franOchMed) : hamtaOrderFor(mig, franOchMed),
      hamtaNivaer(),
      hamtaPerioder(franOchMed),
      hamtaMinaHandelser(mig),
      hamtaRegler(),
      provisionschef ? hamtaGodkandaFran(franOchMed) : Promise.resolve([] as Awaited<ReturnType<typeof hamtaGodkandaFran>>),
      hamtaKvPerManad(manader),
      hamtaMal(franOchMed),
      hamtaChefsposter(franOchMed),
      hamtaSamtal(franOchMed),
      hamtaPolicyer(),
      hamtaKriterier(),
      supabase.from("employee").select("id, first_name, last_name, status, employee_number, employee_role!employee_role_employee_id_fkey(role)"),
    ]);

  const personer = (personrader ?? []).map((p) => ({
    id: p.id as string,
    first_name: p.first_name as string,
    last_name: p.last_name as string,
    status: p.status as string,
    employee_number: (p.employee_number as string | null) ?? null,
    roller: ((p as unknown as { employee_role: { role: string }[] | null }).employee_role ?? []).map((r) => r.role),
  }));

  const superadmin = provisionschef && nivaFor(user.roles) === "superadmin";
  const [{ data: motbokningar }, { data: historikrader }, { data: chefsdata }] = await Promise.all([
    supabase.from("commission_entry_reversal").select("original_id, reversal_id"),
    supabase.from("commission_history").select("employee_id, period_month, amount"),
    superadmin
      ? supabase.from("manager_commission_rate").select("id, employee_id, override_percent, own_sale_percent, valid_from, valid_to, set_by")
      : Promise.resolve({ data: null }),
  ]);
  const chefsrader = superadmin ? ((chefsdata ?? []) as unknown as Chefsrad[]) : null;
  const borttagna = new Set(((motbokningar ?? []) as { original_id: string; reversal_id: string }[]).flatMap((m) => [m.original_id, m.reversal_id]));
  const historik: Record<string, Record<string, number>> = {};
  for (const h of (historikrader ?? []) as { employee_id: string; period_month: string; amount: number }[]) {
    const m = String(h.period_month).slice(0, 7);
    (historik[m] ??= {})[h.employee_id] = Number(h.amount);
  }

  const ut = formaProvision({
    mig, provisionschef, malchef, bokforare, idag, idagsDatum,
    poster: poster as Post[],
    material: material as Orderrad[],
    nivaer, perioder, minaHandelser, regler, godkanda, kvPerManad, mal, chefsposter,
    kvSamtal, policyer, kriterier, personrader: personer,
  });
  let chefssats: NdChefssats | null = null;
  if (chefsrader) {
    const namn = new Map(personer.map((p) => [p.id, fullName(p)]));
    chefssats = {
      rader: chefsrader
        .map((r) => ({
          id: r.id,
          vemId: r.employee_id,
          vem: namn.get(r.employee_id) ?? "Okänd",
          overtack: Number(r.override_percent),
          egen: Number(r.own_sale_percent),
          fran: String(r.valid_from).slice(0, 10),
          till: r.valid_to ? String(r.valid_to).slice(0, 10) : null,
          av: r.set_by ? namn.get(r.set_by) ?? null : null,
        }))
        .sort((a, b) => (a.fran < b.fran ? 1 : -1)),
      mottagare: personer
        .filter((p) => p.status === "active" && p.roller.some((r) => r === "sales_manager" || r === "ceo"))
        .map((p) => ({ id: p.id, namn: fullName(p) }))
        .sort((a, b) => a.namn.localeCompare(b.namn, "sv")),
    };
  }

  return { ...ut, ovriga: ut.ovriga.filter((x) => !borttagna.has(x.id)), historik, skriv: SKRIVLAGE.provision, chefssats };
}
