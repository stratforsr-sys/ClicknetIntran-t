import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { fullName } from "@/lib/auth";
import { hamtaNivaer } from "@/lib/bonus-server";
import { hamtaOrder } from "@/lib/order-server";
import { hamtaGodkandaFran } from "@/lib/konsekvens-server";
import { lagenPerPerson } from "@/lib/konsekvens";
import { underlagForAlla } from "@/lib/provision-motor";
import { byggUnderlag, type Personunderlag, type Underlagsdokument } from "@/lib/provisionsunderlag";

/**
 * Hamtningen for det separata provisionsunderlaget (E13 steg 7).
 *
 * ===========================================================================
 * EN STANGD MANAD LASES UR HUVUDBOKEN. EN OPPEN RAKNAS LIVE.
 *
 * Det ar samma delning som resten av E13 gor, och den ar viktigare har an
 * nagon annanstans: det HAR dokumentet lamnar huset. En stangd manad maste
 * darfor visa exakt de poster som bokfordes vid attesten, inte motorns svar en
 * gang till — kors motorn om kan en installning som andrats sedan dess ge ett
 * annat tal an det som faktiskt bokfordes, och da ar underlaget och huvudboken
 * oense om vad som ska betalas ut.
 *
 * En OPPEN manad har ingen bokforing att lasa. Den raknas live, och dokumentet
 * markeras `faststalld: false` sa att det syns pa pappret.
 * ===========================================================================
 *
 * LASES MED ANVANDARENS EGEN TOKEN. RLS i 0031 ger ekonomi, VD och saljchef
 * allas rader och alla andra bara sina egna — en saljare som oppnar sidan far
 * darmed ett underlag med sig sjalv i, vilket ar ratt svar och inte ett fel.
 */
export async function hamtaUnderlag(manad: string): Promise<Underlagsdokument> {
  const rls = await supabaseServer();

  const [{ data: period }, { data: poster }, { data: personal }] = await Promise.all([
    rls.from("commission_period").select("period_month, status").eq("period_month", manad).maybeSingle(),
    rls
      .from("commission_entry")
      .select("employee_id, amount, source, note")
      .eq("period_month", manad),
    rls.from("employee").select("id, first_name, last_name, employee_number"),
  ]);

  const faststalld = Boolean(period);

  const namn = new Map(
    (personal ?? []).map((p) => [
      p.id,
      { namn: fullName(p), nummer: (p.employee_number as string | null) ?? "" },
    ]),
  );

  const per = new Map<string, Personunderlag>();

  const rad = (employee_id: string): Personunderlag => {
    const fanns = per.get(employee_id);
    if (fanns) return fanns;
    const uppgift = namn.get(employee_id);
    const ny: Personunderlag = {
      employee_id,
      namn: uppgift?.namn ?? "Okänd",
      anstallningsnummer: uppgift?.nummer ?? "",
      poster: [],
      summa: 0,
    };
    per.set(employee_id, ny);
    return ny;
  };

  // Huvudbokens poster. For en STANGD manad ar de hela svaret; for en oppen
  // ar de handinmatningen — ovrig bonus och rattelser — som laggs BREDVID
  // motorns live-rader nedan.
  for (const p of poster ?? []) {
    const r = rad(String(p.employee_id));
    r.poster.push({
      slag: String(p.source),
      text: (p.note as string | null) ?? "Bokförd post",
      belopp: Number(p.amount),
    });
  }

  if (!faststalld) {
    const [order, nivaer, godkanda] = await Promise.all([
      hamtaOrder(manad),
      hamtaNivaer(),
      hamtaGodkandaFran(manad),
    ]);

    // Samma anrop som `faststallPeriod` gor. Skulle de tva glida isar visar
    // det preliminara underlaget ett annat tal an attesten sedan bokfor, och
    // den avvikelsen upptacks forst nar nagon jamfor tva papper.
    for (const u of underlagForAlla(order, manad, nivaer, undefined, lagenPerPerson(godkanda, manad))) {
      const r = rad(u.employee_id);
      for (const post of u.rader) {
        r.poster.push({ slag: post.slag, text: post.text, belopp: post.belopp });
      }
    }
  }

  for (const r of per.values()) {
    r.summa = r.poster.reduce((s, p) => s + p.belopp, 0);
  }

  return byggUnderlag(manad, faststalld, [...per.values()]);
}
