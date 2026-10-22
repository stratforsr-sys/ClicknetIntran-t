import { redirect } from "next/navigation";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/env";
import { Skal } from "@/app/logga-in/Skal";
import { Knapp } from "@/app/logga-in/falt";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sätt upp navet — Clicknet Nav" };

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

/** I inloggningens skal: det är fortfarande ytterdörren, bara första gången. */
export default async function Uppstart() {
  if (!isConfigured) redirect("/");

  const db = supabaseAdmin();
  const { count } = await db.from("employee").select("id", { count: "exact", head: true });
  if ((count ?? 0) > 0) redirect("/");

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/logga-in");

  return (
    <Skal
      fot={
        <form action="/auth/logga-ut" method="post">
          Inloggad som {user.email}. Fel person?{" "}
          <button type="submit" className="in-lank">
            Logga ut
          </button>
        </form>
      }
    >
      <h1 className="in-rubrik">Sätt upp navet</h1>
      <p className="in-ingress">
        Personalregistret är tomt. Du blir första användaren och får rollerna säljchef och administratör, så att du
        kan lägga upp resten.
      </p>
      <form action={skapaForstaAnvandaren} className="in-form">
        <div className="in-tva">
          <div className="in-falt">
            <label className="in-etikett" htmlFor="fornamn">
              Förnamn
            </label>
            <div className="in-ruta">
              <input id="fornamn" name="fornamn" className="in-input" autoComplete="given-name" required />
            </div>
          </div>
          <div className="in-falt">
            <label className="in-etikett" htmlFor="efternamn">
              Efternamn
            </label>
            <div className="in-ruta">
              <input id="efternamn" name="efternamn" className="in-input" autoComplete="family-name" required />
            </div>
          </div>
        </div>
        <p className="in-hjalp">
          Kontot kopplas till <b>{user.email}</b>. Sidan stänger sig själv så fort den första anställda finns.
        </p>
        <Knapp vantar="Skapar kontot…">Skapa mitt konto</Knapp>
      </form>
    </Skal>
  );
}
