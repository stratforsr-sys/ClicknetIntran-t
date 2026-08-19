import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/Card";
import { Notis } from "@/components/ui/Notis";
import { Ikon } from "@/components/shell/Ikon";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { hamtaSparrar } from "@/lib/sparrar";
import { Sparrkort } from "./Sparrkort";

export const dynamic = "force-dynamic";
export const metadata = { title: "Spärrar — Clicknet Nav" };

/**
 * Var K12 bor numera.
 *
 * Tidigare låg spärren som en kommentar i `src/lib/tid.ts` och en konstant som
 * någon skulle komma ihåg att ändra i samma stund som juridiken blev klar. Två
 * saker som ska hända samtidigt, på två olika ställen, av två olika personer —
 * det håller inte över tid.
 *
 * Nu är underlaget dokument i rutinbiblioteket, villkoren en trigger i
 * databasen, och påslaget ett knapptryck som loggas med namn och datum.
 */
export default async function SparrSida() {
  const user = await getCurrentUser();
  if (!hasRole(user, "sales_manager", "ceo") || !user?.employee) redirect("/tid");

  const sparrar = await hamtaSparrar();
  const supabase = await supabaseServer();

  const { data: dokument } = await supabase
    .from("document")
    .select("id, title, status, doc_type, decided_on")
    .in("doc_type", ["interest_assessment", "staff_information"])
    .order("title");

  const avvagningar = (dokument ?? []).filter((d) => d.doc_type === "interest_assessment");
  const informationer = (dokument ?? []).filter((d) => d.doc_type === "staff_information");

  return (
    <div className="flex flex-col gap-4 pt-2">
      <Link
        href="/tid"
        className="inline-flex items-center gap-2 text-small font-semibold text-ink-500 hover:text-ink-900"
      >
        <Ikon namn="tillbaka" className="size-4" />
        Tillbaka till tid
      </Link>

      <div>
        <h1 className="text-display text-ink-900">Spärrar</h1>
        <p className="mt-1 max-w-[70ch] text-body text-ink-500">
          Vad som är påslaget, på vilken grund, och vad som saknas för resten. Villkoren
          kontrolleras i databasen — den här sidan visar dem, den bestämmer dem inte.
        </p>
      </div>

      {avvagningar.length === 0 && (
        <Notis ton="info">
          Ingen intresseavvägning finns i rutinbiblioteket än. Skapa den under Rutiner med typen
          “Intresseavvägning”, sätt beslutsdatum och publicera. Utkast att utgå från ligger i
          <code> docs/K12_INTRESSEAVVAGNING_UTKAST.md</code>.
        </Notis>
      )}

      {sparrar.map((s) => (
        <Sparrkort
          key={s.key}
          sparr={s}
          avvagningar={avvagningar}
          informationer={informationer}
        />
      ))}

      <Card>
        <CardHeader titel="Varför det ser ut så här" />
        <div className="flex max-w-[70ch] flex-col gap-3 text-small text-ink-700">
          <p>
            In- och utstämpling vilar på anställningsavtalet och arbetstidslagens krav på förda
            anteckningar. Den behöver ingen intresseavvägning och står därför påslagen.
          </p>
          <p>
            Raststämpling är något annat: det är registrering av när en människa äter lunch. Den
            behandlingen vilar på en intresseavvägning, och den ska vara skriven och daterad{" "}
            <strong>innan</strong> den första rasten stämplas — inte efteråt, när det redan finns
            data att förklara.
          </p>
          <p>
            Därför kräver påslaget tre saker i databasen: en daterad avvägning (K12), en
            information till personalen som var och en kvitterat (K14), och ett upplagt rastschema
            (K29). Villkoren kontrolleras av en trigger, inte av koden som ritar knappen — navets
            alla skrivningar sker med en nyckel som går förbi vanliga rättigheter, och en regel som
            bara finns i en server action gäller tills någon skriver en annan.
          </p>
          <p>
            Att slå <em>av</em> kräver ingenting alls. En spärr ska aldrig vara svårare att stänga
            än att öppna.
          </p>
        </div>
      </Card>
    </div>
  );
}
