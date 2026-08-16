import type { ReactNode } from "react";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Ikon } from "@/components/shell/Ikon";
import { getCurrentUser, canManageEmployees, hasRole } from "@/lib/auth";
import { ROLE_LABEL, STATUS_LABEL } from "@/lib/roles";
import { granskningslage } from "@/lib/dokument";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * UI-PRD §7: startsidan har ingen hero och ingen illustration.
 * Forsta skarmen ska ge handling, inte valkomnande.
 *
 * "Att gora" hamtar bara ur levererade moduler. En rad som inte gar att
 * atgarda hor inte hemma har — da blir listan nagot man slutar titta pa.
 */
export default async function Startsida() {
  const user = await getCurrentUser();
  if (!user?.employee) return null;

  const supabase = await supabaseServer();
  const { count: antalAktiva } = await supabase
    .from("employee")
    .select("id", { count: "exact", head: true })
    .eq("status", "active");
  const { count: antalOnboarding } = await supabase
    .from("employee")
    .select("id", { count: "exact", head: true })
    .eq("status", "onboarding");

  // RLS avgor vilka dokument som syns: audience_roles filtreras redan i
  // policyn, sa listan nedan behover inte upprepa den kontrollen.
  const [{ data: kravDok }, { data: minaAck }, { data: mittAgande }] = await Promise.all([
    supabase
      .from("document")
      .select("id, slug, title, version, review_due")
      .eq("status", "published")
      .eq("requires_ack", true)
      .order("review_due"),
    supabase
      .from("document_ack")
      .select("document_id, version")
      .eq("employee_id", user.employee.id),
    supabase
      .from("document")
      .select("id, slug, title, review_due")
      .eq("owner_id", user.employee.id)
      .eq("status", "published")
      .lte("review_due", new Date().toISOString().slice(0, 10))
      .order("review_due"),
  ]);

  const ackade = new Set((minaAck ?? []).map((a) => `${a.document_id}:${a.version}`));
  const okvitterade = (kravDok ?? []).filter((d) => !ackade.has(`${d.id}:${d.version}`));
  const forfallna = mittAgande ?? [];

  const chef = canManageEmployees(user) || hasRole(user, "ceo", "team_lead");

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div>
        <h1 className="text-display text-ink-900">
          Hej {user.employee.first_name}
        </h1>
        <p className="mt-1 text-body text-ink-500">
          {user.roles.length
            ? user.roles.map((r) => ROLE_LABEL[r]).join(" · ")
            : "Din roll är inte satt än."}{" "}
          · {STATUS_LABEL[user.employee.status] ?? user.employee.status}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            titel="Att göra"
            beskrivning="Kvittenser, kurser och ärenden som väntar på dig."
          />
          {okvitterade.length === 0 && forfallna.length === 0 ? (
            <EmptyState
              rubrik="Ingenting väntar på dig"
              text="Här samlas rutiner du inte kvitterat, kurser som pågår och ärenden med svar."
            />
          ) : (
            <ul className="flex flex-col">
              {okvitterade.map((d) => (
                <Uppgift
                  key={d.id}
                  href={`/rutiner/${d.slug}`}
                  titel={d.title}
                  detalj={`Version ${d.version} · ${granskningslage(d.review_due).text}`}
                  markering={<Badge ton="accent">Kvittera</Badge>}
                />
              ))}
              {forfallna.map((d) => (
                <Uppgift
                  key={`agare-${d.id}`}
                  href={`/rutiner/${d.slug}/redigera`}
                  titel={d.title}
                  detalj={`Du äger dokumentet · ${granskningslage(d.review_due).text}`}
                  markering={<Badge ton="danger">Granska</Badge>}
                />
              ))}
            </ul>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          {chef && (
            <Card status="brand">
              <CardHeader titel="Personalen" />
              <dl className="flex flex-col gap-3">
                <Rad etikett="Aktiva" varde={antalAktiva ?? 0} />
                <Rad etikett="Under onboarding" varde={antalOnboarding ?? 0} />
              </dl>
              <div className="mt-5">
                <ButtonLink href="/personal" size="sm">
                  Öppna personalregistret
                </ButtonLink>
              </div>
            </Card>
          )}

          <Card>
            <CardHeader titel="Byggstatus" beskrivning="Vad som finns i navet idag." />
            <ul className="flex flex-col gap-2.5 text-small">
              <Modul namn="Identitet och behörighet" ton="ok" status="I drift" />
              <Modul namn="Rutinbibliotek" ton="ok" status="I drift" />
              <Modul namn="Personalärenden" ton="neutral" status="Planerad" />
              <Modul namn="Utbildning" ton="neutral" status="Planerad" />
              <Modul namn="Stämpling" ton="neutral" status="Planerad" />
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Uppgift({
  href,
  titel,
  detalj,
  markering,
}: {
  href: string;
  titel: string;
  detalj: string;
  markering: ReactNode;
}) {
  return (
    <li className="border-b border-canvas last:border-0">
      <Link
        href={href}
        className="group flex min-h-14 items-center gap-3 py-3 transition-colors duration-fast"
      >
        <span className="flex-1">
          <span className="block text-body text-ink-900 group-hover:text-brand-700">{titel}</span>
          <span className="block text-small text-ink-500">{detalj}</span>
        </span>
        {markering}
        <Ikon namn="tillbaka" className="size-4 rotate-180 text-ink-300" />
      </Link>
    </li>
  );
}

function Rad({ etikett, varde }: { etikett: string; varde: number }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-small text-ink-500">{etikett}</dt>
      <dd className="tnum text-h1 text-ink-900">{varde}</dd>
    </div>
  );
}

function Modul({
  namn,
  status,
  ton,
}: {
  namn: string;
  status: string;
  ton: "ok" | "neutral";
}) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="text-ink-700">{namn}</span>
      <Badge ton={ton}>{status}</Badge>
    </li>
  );
}
