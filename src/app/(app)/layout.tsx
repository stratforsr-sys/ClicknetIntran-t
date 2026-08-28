import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Skal } from "@/components/shell/Skal";
import { Klocka, KlockaSkelett } from "@/components/shell/Klocka";
import { navFor } from "@/components/shell/nav-items";
import { SIDOPANEL_KAKA, arHopfalld } from "@/components/shell/sidopanel";
import { hamtaLage } from "@/lib/sparrar";
import { stampelfri } from "@/lib/stampelfri";
import { getCurrentUser, fullName } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/roles";
import { isConfigured } from "@/lib/env";
import { kraverMfa, kvittoGiltigt, STEG2_KAKA } from "@/lib/mfa";
import { supabaseAdmin } from "@/lib/supabase/server";
import { TOAST_KAKA, franKaka } from "@/lib/toast";
import { VantarPaAktivering } from "./VantarPaAktivering";
import { EjKonfigurerad } from "./EjKonfigurerad";

/**
 * `ruta` ar en parallell rutt (`@ruta`) och inte en vanlig komponent.
 *
 * Den bar installningsrutan. Next fyller den bara nar adressen matchar en av
 * panelerna OCH man kom dit genom en klick i navet — annars star `default.tsx`
 * dar och lamnar den tom, sa att en full laddning av t.ex. /tid/sparrar ger
 * helsidan. Se src/app/(app)/@ruta/.
 */
export default async function AppLayout({
  children,
  ruta,
}: {
  children: React.ReactNode;
  ruta: React.ReactNode;
}) {
  if (!isConfigured) return <EjKonfigurerad />;

  /**
   * Bada startas samtidigt. `hamtaLage()` fragar efter `compliance_gate` och
   * behover inte veta vem som last — den stod bara langre ner i filen och
   * vantade darfor i onodan pa att anvandaren skulle bli klar.
   *
   * Att lasa laget aven for den som strax omdirigeras kostar ingenting: bada
   * anropen ar cache()ade per begaran, och sidan under layouten fragar anda
   * efter samma tva saker.
   */
  const [user, lage] = await Promise.all([getCurrentUser(), hamtaLage()]);
  if (!user) redirect("/logga-in");

  // AC-1.2: inloggad utan employee-rad ser endast "vantar pa aktivering".
  if (!user.employee) {
    // Undantag: ar registret tomt maste nagon kunna bli forst. Se /uppstart.
    const { count } = await supabaseAdmin()
      .from("employee")
      .select("id", { count: "exact", head: true });
    if ((count ?? 0) === 0) redirect("/uppstart");
    return <VantarPaAktivering epost={user.email} />;
  }

  if (user.employee.status === "offboarded") redirect("/auth/logga-ut");

  // AC-1.1, K33: andra ledet. Mellanvaran stoppar redan den som saknar kvitto,
  // men den faller tillbaka pa "slapp igenom" om Supabase inte svarar. Har,
  // dar rollerna redan ar hamtade, kostar kontrollen ingenting extra.
  if (kraverMfa(user)) {
    const kvitto = (await cookies()).get(STEG2_KAKA)?.value;
    if (!(await kvittoGiltigt(kvitto, user.authUserId))) redirect("/logga-in/verifiera");
  }

  const roll = user.roles.length ? ROLE_LABEL[user.roles[0]] : "Väntar på roll";

  /**
   * Bottennavets stampelknapp ar PERSONENS och inte modulens: den som inte
   * stamplar ska inte ha en genvag till det langst ner pa telefonen.
   *
   * Sidopanelen far DAREMOT hela modullaget och gor sin egen bedomning — dar
   * ar /tid ocksa chefens vy, och saljchefen och VD behaller den. Se
   * `lib/stampelfri.ts` och `nav-items.ts`.
   */
  const stamplarSjalv = lage.stampling && !stampelfri(user.roles);

  const kakor = await cookies();

  // Sidopanelens lage lases har och inte i webblasaren, sa att en hopfalld
  // panel ritas hopfalld pa en gang i stallet for att fallas ihop efterat.
  const hopfalld = arHopfalld(kakor.get(SIDOPANEL_KAKA)?.value);

  // E5.7. Kvittot for den atgard som just utfordes. Ligger i en kortlivad kaka
  // eftersom atgarderna ar server actions som omdirigerar — ett tillstand satt
  // fore navigeringen hade forsvunnit med den.
  const kvitto = franKaka(kakor.get(TOAST_KAKA)?.value);

  /**
   * Klockan hamtas INTE har. Den ar sexton fragor som ingen bett om, och en
   * layout maste vara fardig innan nagon del av sidan far skickas — sa lange de
   * lag har holl de tillbaka hela navet vid varje sidvisning.
   *
   * Nu gar skalet och sidan ivag med en gang och klockan fylls i efterat. Se
   * shell/Klocka.tsx.
   *
   * Installningsrutan hamtas inte har heller, men av ett annat skal: den ar
   * en egen rutt. Panelen som visas ar den adressen pekar pa, sa bara den
   * hamtas — och en panel man aldrig oppnar kostar ingenting alls.
   */
  return (
    <Skal
      items={navFor(user, lage.stampling)}
      namn={fullName(user.employee)}
      roll={roll}
      stamplingPa={stamplarSjalv}
      hopfalldFranStart={hopfalld}
      klocka={
        <Suspense fallback={<KlockaSkelett />}>
          <Klocka user={user} />
        </Suspense>
      }
      kvitto={kvitto}
      ruta={ruta}
    >
      {children}
    </Skal>
  );
}

