import { redirect } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Notis } from "@/components/ui/Notis";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Nagon maste kunna bli forst. Vyn ar tillganglig ENDAST sa lange registret ar
 * tomt — darefter blockerar den sig sjalv. Utan den finns ingen vag in i ett
 * nyuppsatt nav, eftersom bara en saljchef far lagga upp anstallda.
 */
async function skapaForstaAnvandaren(form: FormData) {
  "use server";

  const db = supabaseAdmin();
  const { count } = await db.from("employee").select("id", { count: "exact", head: true });
  if ((count ?? 0) > 0) redirect("/");

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/logga-in");

  const fornamn = String(form.get("fornamn") ?? "").trim() || "Namnlös";
  const efternamn = String(form.get("efternamn") ?? "").trim() || "Användare";

  const { data: rad } = await db
    .from("employee")
    .insert({
      auth_user_id: user.id,
      email: user.email,
      first_name: fornamn,
      last_name: efternamn,
      status: "active",
      start_date: new Date().toISOString().slice(0, 10),
    })
    .select("id")
    .single();

  if (rad) {
    await db.from("employee_role").insert([
      { employee_id: rad.id, role: "sales_manager", granted_by: rad.id },
      { employee_id: rad.id, role: "admin", granted_by: rad.id },
    ]);
    await db.from("audit_log").insert({
      actor_id: rad.id,
      action: "employee.created",
      object_type: "employee",
      object_id: rad.id,
      reason: "Första användaren, skapad via uppstartsvyn",
      meta: { roll: "sales_manager, admin" },
    });
  }

  redirect("/");
}

export default async function Uppstart() {
  if (!isConfigured) redirect("/");

  const db = supabaseAdmin();
  const { count } = await db.from("employee").select("id", { count: "exact", head: true });
  if ((count ?? 0) > 0) redirect("/");

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/logga-in");

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-12">
      <Card className="w-full max-w-[32rem]">
        <h1 className="text-h1 text-ink-900">Sätt upp navet</h1>
        <p className="mt-3 text-body text-ink-500">
          Personalregistret är tomt. Du blir första användaren och får rollerna säljchef och
          administratör, så att du kan lägga upp resten.
        </p>

        <Notis ton="info">
          Den här sidan stänger sig själv så fort den första anställda finns.
        </Notis>

        <form action={skapaForstaAnvandaren} className="mt-5 flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="fornamn" className="text-small font-semibold text-ink-700">Förnamn</label>
              <input
                id="fornamn"
                name="fornamn"
                required
                className="rounded-sm bg-surface px-4 py-2.5 text-body text-ink-900 shadow-elev-1 focus:outline-none focus:ring-2 focus:ring-brand-600"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="efternamn" className="text-small font-semibold text-ink-700">Efternamn</label>
              <input
                id="efternamn"
                name="efternamn"
                required
                className="rounded-sm bg-surface px-4 py-2.5 text-body text-ink-900 shadow-elev-1 focus:outline-none focus:ring-2 focus:ring-brand-600"
              />
            </div>
          </div>
          <p className="text-small text-ink-500">
            Kontot kopplas till <span className="font-semibold text-ink-700">{user.email}</span>.
          </p>
          <Button type="submit" className="mt-1">Skapa mitt konto</Button>
        </form>
      </Card>
    </main>
  );
}
