import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { hasRole, type CurrentUser } from "@/lib/auth";
import { svensktDatum } from "@/lib/klocka";
import { hamtaAllProvision, hamtaProvision } from "@/lib/provision-server";
import { manadFore, manadsnyckel } from "@/lib/provision";
import { hamtaChefsposter, hamtaOrder, hamtaOrderFor, type Orderrad } from "@/lib/order-server";
import { hamtaNivaer, hamtaPerioder } from "@/lib/bonus-server";
import { hamtaKriterier, hamtaKvPerManad, hamtaPolicyer, hamtaSamtal } from "@/lib/kv-server";
import { hamtaMal } from "@/lib/saljmal-server";
import { hamtaGodkandaFran, hamtaMinaHandelser, hamtaRegler } from "@/lib/konsekvens-server";
import { formaProvision, type NdProvision, type Post } from "./provisionforma";

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
 */

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

  return formaProvision({
    mig, provisionschef, malchef, bokforare, idag, idagsDatum,
    poster: poster as Post[],
    material: material as Orderrad[],
    nivaer, perioder, minaHandelser, regler, godkanda, kvPerManad, mal, chefsposter,
    kvSamtal, policyer, kriterier, personrader: personer,
  });
}
