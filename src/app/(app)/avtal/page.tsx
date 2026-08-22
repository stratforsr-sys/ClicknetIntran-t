import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notis } from "@/components/ui/Notis";
import { supabaseServer } from "@/lib/supabase/server";
import { getCurrentUser, fullName, hasRole } from "@/lib/auth";
import { AVTALSSTATUS_ETIKETT, type Avtalsstatus } from "@/lib/avtal";

export const dynamic = "force-dynamic";

const TON: Record<Avtalsstatus, "warn" | "ok" | "danger"> = {
  draft: "warn",
  issued: "ok",
  withdrawn: "danger",
};

/**
 * E9.1. Avtalen.
 *
 * RLS i 0028 avgor vad som syns: den som far hantera avtal ser alla, och den
 * anstallda ser sina egna men forst nar de ar UTFARDADE. Sidan har darfor
 * inget eget filter pa fragan — bara pa vad rubriken heter.
 */
export default async function Avtal() {
  const user = await getCurrentUser();
  const hanterar = hasRole(user, "sales_manager", "ceo", "admin");

  const supabase = await supabaseServer();
  const { data: avtal } = await supabase
    .from("contract")
    .select("id, employee_id, title, template_slug, status, created_at, issued_at, withdrawn_reason")
    .order("created_at", { ascending: false })
    .limit(200);

  const { data: personer } = await supabase.from("employee").select("id, first_name, last_name");
  const namnPer = new Map((personer ?? []).map((p) => [p.id, fullName(p)]));

  const rader = avtal ?? [];

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-display text-ink-900">{hanterar ? "Avtal" : "Mina avtal"}</h1>
          <p className="mt-1 max-w-[70ch] text-body text-ink-500">
            {hanterar
              ? "Anställningsavtal skapade ur en mall. Texten fryses när avtalet utfärdas — en mall som ändras sedan rör inte det som redan är utfärdat."
              : "Avtal som gäller dig. Ett avtal syns här när det är utfärdat."}
          </p>
        </div>
        {hanterar && (
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/avtal/mallar" variant="sekundar">
              Mallar
            </ButtonLink>
            <ButtonLink href="/avtal/nytt" variant="primar">
              Nytt avtal
            </ButtonLink>
          </div>
        )}
      </div>

      {hanterar && (
        <Notis ton="info">
          E9.2 e-signering är inte byggd — leverantören är inte vald (A14). Ett
          utfärdat avtal skrivs ut och skrivs under på papper, och personnumret
          fylls i för hand: navet lagrar inga personnummer.
        </Notis>
      )}

      <Card className="p-0 md:p-0">
        {rader.length === 0 ? (
          <div className="p-6">
            <EmptyState
              rubrik={hanterar ? "Inga avtal än" : "Du har inga avtal här"}
              text={
                hanterar
                  ? "Skriv en mall först, publicera den, och skapa sedan avtalet från personens sida eller härifrån."
                  : "Ett anställningsavtal dyker upp här när det är utfärdat."
              }
              handling={hanterar ? <ButtonLink href="/avtal/mallar/ny">Skriv en mall</ButtonLink> : undefined}
            />
          </div>
        ) : (
          <ul className="flex flex-col">
            {rader.map((a) => (
              <li key={a.id} className="border-b border-canvas last:border-0">
                <Link
                  href={`/avtal/${a.id}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-6 py-4 hover:bg-surface-alt"
                >
                  <Badge ton={TON[a.status as Avtalsstatus]}>
                    {AVTALSSTATUS_ETIKETT[a.status as Avtalsstatus]}
                  </Badge>
                  <span className="min-w-0 flex-1 text-body text-ink-900">
                    {namnPer.get(a.employee_id) ?? "okänd"}
                    <span className="text-ink-500"> · {a.title}</span>
                  </span>
                  <time className="tnum text-small text-ink-500">
                    {new Date(a.issued_at ?? a.created_at).toLocaleDateString("sv-SE")}
                  </time>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
