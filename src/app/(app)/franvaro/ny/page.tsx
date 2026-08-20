import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { svensktDatum } from "@/lib/klocka";
import { reglerFor, saldoFor, saldotArGammalt, type Franvarotyp, type Regelverk, type Saldo } from "@/lib/franvaro";
import { hamtaRegelverk } from "@/lib/franvaro-server";
import { Ansokningsformular } from "./Ansokningsformular";

export const dynamic = "force-dynamic";
export const metadata = { title: "Söka ledigt — Clicknet Nav" };

/**
 * AC-3.13: den anställda ser reglerna INNAN hen skickar in.
 *
 * Reglerna räknas fram med samma `reglerFor()` som regelmotorn dömer efter, ur
 * samma tabellrader. Att skriva listan för hand i den här filen hade gett en
 * sida som säger en sak och ett avslag som säger en annan — samma resonemang
 * som `sparr_saknas` i 0016.
 */
export default async function NyAnsokan() {
  const user = await getCurrentUser();
  if (!user?.employee) redirect("/");

  const verk = await hamtaRegelverk();
  if (!verk) redirect("/franvaro");

  const { regler, typer } = verk;
  const sokbara = typer.filter((t) => t.requestable);
  const idag = svensktDatum();

  const db = supabaseAdmin();
  const { data: saldorader } = await db
    .from("absence_balance")
    .select("type_id, days, as_of, earned_year")
    .eq("employee_id", user.employee.id);

  const saldon: Saldo[] = ((saldorader ?? []) as { type_id: string; days: string | number; as_of: string; earned_year: number | null }[]).map(
    (s) => ({ ...s, days: Number(s.days) }),
  );

  // Reglerna per typ, färdigskrivna på servern. Klienten ska inte behöva
  // känna till semesterlagen för att kunna visa vad som gäller.
  const reglerPerTyp: Record<string, string[]> = {};
  const saldoPerTyp: Record<string, { dagar: number; asOf: string; gammalt: boolean } | null> = {};

  for (const t of sokbara) {
    reglerPerTyp[t.id] = reglerFor(t, regler);
    const s = saldoFor(saldon, t.id);
    saldoPerTyp[t.id] = s ? { dagar: s.days, asOf: s.as_of, gammalt: saldotArGammalt(s.as_of, regler, idag) } : null;
  }

  return (
    <Ansokningsformular
      typer={sokbara as Franvarotyp[]}
      regler={reglerPerTyp}
      saldon={saldoPerTyp}
      idag={idag}
      policy={regler as Regelverk}
    />
  );
}
