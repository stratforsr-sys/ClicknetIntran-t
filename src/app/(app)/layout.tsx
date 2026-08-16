import { redirect } from "next/navigation";
import { Skal } from "@/components/shell/Skal";
import { navFor } from "@/components/shell/nav-items";
import { getCurrentUser, fullName } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/roles";
import { isConfigured } from "@/lib/env";
import { kraverMfa, harVerifieradFaktor } from "@/lib/mfa";
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

  // AC-1.1, K33: chefs- och ekonomiroller kommer inte in i navet forran
  // tvafaktorn ar inskriven. Grinden ligger utanfor den har gruppen, sa den
  // har varken meny eller genvagar.
  if (kraverMfa(user) && !harVerifieradFaktor(user)) redirect("/tvafaktor");

  const roll = user.roles.length ? ROLE_LABEL[user.roles[0]] : "Väntar på roll";

  return (
    <Skal items={navFor(user)} namn={fullName(user.employee)} roll={roll}>
      {children}
    </Skal>
  );
}
