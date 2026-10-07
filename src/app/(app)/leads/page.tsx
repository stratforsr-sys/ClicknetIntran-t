import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { getCurrentUser, hasRole, fullName } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import {
  alder,
  leadTitel,
  leadUndertitel,
  OPPNA,
  STATUS_ETIKETT,
  STATUS_TON,
  type Leadstatus,
} from "@/lib/leads";

export const dynamic = "force-dynamic";
export const metadata = { title: "Leads — Clicknet Nav" };

type Rad = {
  id: string;
  created_at: string;
  source: string;
  name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  status: Leadstatus;
  assigned_to: string | null;
  duplicate_of: string | null;
};

const VYER = [
  { id: "oppna", etikett: "Att hantera" },
  { id: "otilldelade", etikett: "Otilldelade" },
  { id: "mina", etikett: "Mina" },
  { id: "avslutade", etikett: "Avslutade" },
  { id: "alla", etikett: "Alla" },
] as const;

type Vy = (typeof VYER)[number]["id"];

function arVy(v: unknown): v is Vy {
  return VYER.some((x) => x.id === v);
}

/**
 * Inkorgsmönstret från ärendena: ett otilldelat nytt lead har en gul kant, för
 * det är det enda i listan som ingen ännu tagit ansvar för.
 */
function kant(r: Rad): string {
  if (r.status === "new" && !r.assigned_to) return "border-l-warn";
  if (r.status === "won") return "border-l-ok";
  if (r.status === "lost" || r.status === "spam") return "border-l-ink-300";
  return "border-l-brand-500";
}

export default async function LeadsSida({ searchParams }: { searchParams: Promise<{ visa?: string }> }) {
  const user = await getCurrentUser();
  if (!user?.employee) redirect("/");
  if (!hasRole(user, "salesperson", "sales_manager", "ceo", "team_lead")) redirect("/");

  const fordelar = hasRole(user, "sales_manager", "ceo", "team_lead");
  const { visa } = await searchParams;
  // Säljaren ser bara sina egna (RLS), så "Otilldelade" är alltid tom för hen.
  const vy: Vy = arVy(visa) && (fordelar || visa !== "otilldelade") ? visa : "oppna";

  const supabase = await supabaseServer();

  // RLS avgör: fördelarna får alla, säljaren de leads hen fått.
  let fraga = supabase
    .from("lead")
    .select("id, created_at, source, name, company, email, phone, status, assigned_to, duplicate_of")
    .order("created_at", { ascending: false })
    .limit(300);

  if (vy === "oppna") fraga = fraga.in("status", OPPNA);
  if (vy === "otilldelade") fraga = fraga.is("assigned_to", null).in("status", OPPNA);
  if (vy === "mina") fraga = fraga.eq("assigned_to", user.employee.id);
  if (vy === "avslutade") fraga = fraga.in("status", ["won", "lost", "spam"]);

  const [{ data }, { data: personal }] = await Promise.all([
    fraga,
    supabase.from("employee").select("id, first_name, last_name"),
  ]);

  const lista = (data ?? []) as unknown as Rad[];
  const namn = new Map((personal ?? []).map((p) => [p.id, fullName(p)]));
  const nyaOtilldelade = lista.filter((r) => r.status === "new" && !r.assigned_to).length;

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div>
        <h1 className="text-display text-ink-900">Leads</h1>
        <p className="mt-1 max-w-[70ch] text-body text-ink-500">
          {fordelar
            ? "Förfrågningar från hemsidans formulär. Ge varje lead till en säljare — den som får det ser det här och får ett mejl."
            : "Förfrågningar från hemsidan som du fått. Sätt status när du har ringt, så ser alla var det står."}
        </p>
      </div>

      <nav aria-label="Urval" className="flex flex-wrap gap-2">
        {VYER.filter((v) => fordelar || v.id !== "otilldelade").map((v) => (
          <Link
            key={v.id}
            href={v.id === "oppna" ? "/leads" : `/leads?visa=${v.id}`}
            aria-current={vy === v.id ? "page" : undefined}
            className={`rounded-full px-4 py-1.5 text-small font-semibold ${
              vy === v.id ? "bg-brand-600 text-ink-inv" : "bg-surface text-ink-700 shadow-elev-1 hover:bg-surface-alt"
            }`}
          >
            {v.etikett}
          </Link>
        ))}
      </nav>

      {fordelar && nyaOtilldelade > 0 && vy !== "avslutade" && (
        <div className="flex flex-wrap gap-2">
          <Badge ton="warn">{nyaOtilldelade} nya utan säljare</Badge>
        </div>
      )}

      {lista.length === 0 ? (
        <Card>
          <EmptyState
            rubrik={vy === "oppna" ? "Inga leads att hantera" : "Inga leads här"}
            text={
              fordelar
                ? "När någon fyller i formuläret på hemsidan hamnar förfrågan här, och du får ett mejl."
                : "När du får ett lead tilldelat hamnar det här, och du får ett mejl."
            }
          />
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {lista.map((r) => (
            <li key={r.id}>
              <Link href={`/leads/${r.id}`} className="block">
                <div
                  className={`lift flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border-l-[3px] bg-surface p-4 shadow-elev-1 ${kant(r)}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body font-semibold text-ink-900">{leadTitel(r)}</p>
                    <p className="mt-0.5 truncate text-small text-ink-500">
                      {leadUndertitel(r) || r.source}
                    </p>
                  </div>

                  {r.duplicate_of && <Badge ton="info">Dubblett</Badge>}
                  {fordelar && (
                    <span className="text-small text-ink-500">
                      {r.assigned_to ? (namn.get(r.assigned_to) ?? "Okänd") : "Ingen säljare"}
                    </span>
                  )}
                  <Badge ton={STATUS_TON[r.status]}>{STATUS_ETIKETT[r.status]}</Badge>
                  <span className="w-16 text-right text-small tabular-nums text-ink-500" title={new Date(r.created_at).toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" })}>
                    {alder(r.created_at)}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
