import { notFound } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Notis } from "@/components/ui/Notis";
import { Markdown } from "@/components/Markdown";
import { supabaseServer } from "@/lib/supabase/server";
import { getCurrentUser, fullName, hasRole } from "@/lib/auth";
import { AVTALSSTATUS_ETIKETT, type Avtalsstatus } from "@/lib/avtal";
import { draTillbakaAvtal, raderaUtkast, utfardaAvtal } from "../actions";

export const dynamic = "force-dynamic";

const TON: Record<Avtalsstatus, "warn" | "ok" | "danger"> = {
  draft: "warn",
  issued: "ok",
  withdrawn: "danger",
};

/**
 * E9.1. Avtalet.
 *
 * Sidan ar bade lasvy och utskrift. Det finns ingen PDF-generator i navet —
 * `pdf.ts` LASER en PDF, den skriver ingen — och att valja ett bibliotek for
 * att skriva en ar ett storre beslut an E9.1 behover fatta. Webblasarens egen
 * utskrift ger en PDF som duger att skriva under, och den ser likadan ut som
 * det man las pa skarmen.
 *
 * `print:`-klasserna tar bort skalet, knapparna och statusraden ur utskriften.
 * Det som skrivs ut ar avtalstexten och underskriftsraderna.
 */
export default async function Avtalet({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();

  const supabase = await supabaseServer();
  const { data: avtal } = await supabase
    .from("contract")
    .select(
      "id, employee_id, title, template_slug, body_md, status, created_at, issued_at, issued_by, withdrawn_reason, withdrawn_at",
    )
    .eq("id", id)
    .maybeSingle();

  // RLS har redan svarat pa behorighetsfragan: ar raden inte lasbar for den
  // har personen kommer den tillbaka som null. Ingen andra kontroll har.
  if (!avtal) notFound();

  const hanterar = hasRole(user, "sales_manager", "ceo", "admin");
  const status = avtal.status as Avtalsstatus;

  const { data: person } = await supabase
    .from("employee")
    .select("first_name, last_name")
    .eq("id", avtal.employee_id)
    .maybeSingle();

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div className="flex flex-wrap items-start justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-display text-ink-900">{avtal.title}</h1>
          <p className="mt-1 text-body text-ink-500">
            {person ? fullName(person) : "okänd"} · mall {avtal.template_slug}
          </p>
        </div>
        <Badge ton={TON[status]}>{AVTALSSTATUS_ETIKETT[status]}</Badge>
      </div>

      {status === "draft" && hanterar && (
        <Notis ton="warn">
          Utkast. Personen ser det inte än. Utfärda avtalet när texten stämmer —
          efter det går den inte att ändra.
        </Notis>
      )}

      {status === "withdrawn" && (
        <Notis ton="danger">
          Tillbakadraget{avtal.withdrawn_at ? ` ${new Date(avtal.withdrawn_at).toLocaleDateString("sv-SE")}` : ""}
          {avtal.withdrawn_reason ? `: ${avtal.withdrawn_reason}` : "."}
        </Notis>
      )}

      {/* Sjalva dokumentet. Vit yta, ingen ram i utskriften. */}
      <Card className="print:p-0 print:shadow-none">
        <article className="prosa mx-auto max-w-[75ch]">
          <Markdown text={avtal.body_md} />

          {/*
            Underskriftsraderna hor till DOKUMENTET och inte till mallen.
            Ligger de i mallen glommer nagon dem i en av dem, och ett avtal
            utan rad att skriva pa ar inte ett avtal.

            Personnumret star har for att det ar enda stallet det far finnas:
            pa papperet. Se rubriken i 0028.
          */}
          <div className="mt-16 grid gap-12 sm:grid-cols-2">
            <div>
              <p className="text-small text-ink-500">Personnummer</p>
              <div className="mt-8 border-t border-ink-900" />
              <p className="mt-1 text-small text-ink-500">Fylls i för hand</p>
            </div>
            <div />
            <div>
              <div className="mt-8 border-t border-ink-900" />
              <p className="mt-1 text-small text-ink-500">
                Arbetstagare · {person ? fullName(person) : ""}
              </p>
            </div>
            <div>
              <div className="mt-8 border-t border-ink-900" />
              <p className="mt-1 text-small text-ink-500">För arbetsgivaren</p>
            </div>
          </div>
        </article>
      </Card>

      <div className="flex flex-wrap gap-2 print:hidden">
        {status === "issued" && (
          <p className="w-full text-small text-ink-500">
            Utfärdat {avtal.issued_at ? new Date(avtal.issued_at).toLocaleDateString("sv-SE") : ""}.
            Skriv ut sidan för att skriva under. E-signering är inte byggd (E9.2, blockerad av A14).
          </p>
        )}

        {hanterar && status === "draft" && (
          <>
            <form action={utfardaAvtal}>
              <input type="hidden" name="avtal_id" value={avtal.id} />
              <Button type="submit">Utfärda avtalet</Button>
            </form>
            <form action={raderaUtkast}>
              <input type="hidden" name="avtal_id" value={avtal.id} />
              <Button type="submit" variant="diskret">
                Radera utkastet
              </Button>
            </form>
          </>
        )}

        {hanterar && status === "issued" && (
          <form action={draTillbakaAvtal} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="avtal_id" value={avtal.id} />
            <label className="flex flex-col gap-1 text-small text-ink-700">
              Varför dras det tillbaka?
              <input
                name="skal"
                required
                className="min-h-11 w-72 rounded-sm bg-surface px-4 text-body shadow-elev-1 focus:outline-none focus:ring-2 focus:ring-brand-600"
              />
            </label>
            <Button type="submit" variant="destruktiv">
              Dra tillbaka
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
