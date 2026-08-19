import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Skal } from "@/components/shell/Skal";
import { navFor } from "@/components/shell/nav-items";
import { hamtaLage } from "@/lib/sparrar";
import { getCurrentUser, fullName } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/roles";
import { isConfigured } from "@/lib/env";
import { kraverMfa, kvittoGiltigt, STEG2_KAKA } from "@/lib/mfa";
import { supabaseAdmin } from "@/lib/supabase/server";
import { VantarPaAktivering } from "./VantarPaAktivering";
import { EjKonfigurerad } from "./EjKonfigurerad";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!isConfigured) return <EjKonfigurerad />;

  const user = await getCurrentUser();
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
  const lage = await hamtaLage();


  return (
    <Skal items={navFor(user, lage.stampling)} namn={fullName(user.employee)} roll={roll}>
      {children}
    </Skal>
  );
}
