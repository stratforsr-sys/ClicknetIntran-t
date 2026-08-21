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
import { kursLage, LAGE_ETIKETT, LAGE_TON } from "@/lib/utbildning";
import { slaLage } from "@/lib/arenden";
import { hamtaLage } from "@/lib/sparrar";
import {
  arbetadeMinuter,
  dygnetsStart,
  lageNu,
  tillatna,
  timmarOchMinuter,
  type Handelse,
} from "@/lib/tid";
import { supabaseServer } from "@/lib/supabase/server";
import { Stamplar } from "./tid/Stamplar";

export const dynamic = "force-dynamic";

/**
 * UI-PRD §7: startsidan har ingen hero och ingen illustration.
 * Forsta skarmen ska ge handling, inte valkomnande.
 *
 * §12 Q9: ordningen ar rollstyrd. Saljaren ser stampelknappen forst — det ar
 * det enda hen gor har varje dag, och hen gor det fran telefonen i dorren.
 * Chefen ser sina koer forst, for hens arende med sidan ar att veta vad som
 * ligger och vantar pa ett beslut.
 *
 * "Att gora" hamtar bara ur levererade moduler. En rad som inte gar att
 * atgarda hor inte hemma har — da blir listan nagot man slutar titta pa.
 */
export default async function Startsida() {
  const user = await getCurrentUser();
  if (!user?.employee) return null;

  const supabase = await supabaseServer();
  const sparr = await hamtaLage();

  // Behorigheterna star var for sig med flit. "Chef" ar inte en roll utan tre
  // olika saker: se personalen, hantera arenden och attestera rattelser. Ett
  // enda samlat begrepp hade gett teamledaren en arendeko hen inte kan rora.
  const serPersonal = canManageEmployees(user) || hasRole(user, "ceo", "team_lead");
  const hanterarArenden = hasRole(user, "sales_manager", "ceo");
  const attesterar = canManageEmployees(user);
  const serAvvikelser = canManageEmployees(user) || hasRole(user, "team_lead");
  const chef = serPersonal || hanterarArenden;

  // RLS avgor vilka dokument som syns: audience_roles filtreras redan i
  // policyn, sa listan nedan behover inte upprepa den kontrollen.
  const [{ data: kravDok }, { data: minaAck }, { data: mittAgande }, { data: minaArenden }] =
    await Promise.all([
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
      // AC-11.1 lovar arenden i listan. `waiting` satts nar nagon ANNAN an
      // agaren skrivit i traden — alltsa precis nar ledningen har svarat och
      // bollen ligger hos den anstallda. Se arenden/actions.ts.
      supabase
        .from("hr_case")
        .select("id, subject, status, resolved_at, due_at, sla_hours")
        .eq("employee_id", user.employee.id)
        .eq("status", "waiting")
        .is("resolved_at", null)
        .order("due_at"),
    ]);

  // AC-6.6 pa startsidan: en kurs som ligger och skraper ar lika mycket en
  // uppgift som en okvitterad rutin.
  const [{ data: kurser }, { data: kursModuler }, { data: minProgress }, { data: minaCert }] =
    await Promise.all([
      supabase
        .from("course")
        .select("id, slug, title, due_days")
        .eq("status", "published")
        .order("title"),
      supabase.from("course_module").select("id, course_id"),
      supabase.from("module_progress").select("module_id").eq("employee_id", user.employee.id),
      supabase
        .from("certification")
        .select("course_id, issued_at, expires_at")
        .eq("employee_id", user.employee.id)
        .order("issued_at", { ascending: false }),
    ]);

  const modulerPerKurs = new Map<string, string[]>();
  for (const m of kursModuler ?? []) {
    modulerPerKurs.set(m.course_id, [...(modulerPerKurs.get(m.course_id) ?? []), m.id]);
  }
  const klaraModuler = new Set((minProgress ?? []).map((p) => p.module_id));
  const certPerKurs = new Map<string, { issued_at: string; expires_at: string | null }>();
  for (const c of minaCert ?? []) if (!certPerKurs.has(c.course_id)) certPerKurs.set(c.course_id, c);

  const kursUppgifter = (kurser ?? [])
    .map((k) => {
      const ids = modulerPerKurs.get(k.id) ?? [];
      return {
        ...k,
        antal: ids.length,
        klara: ids.filter((id) => klaraModuler.has(id)).length,
        lage: kursLage({
          certifikat: certPerKurs.get(k.id) ?? null,
          klaraModuler: ids.filter((id) => klaraModuler.has(id)).length,
          antalModuler: ids.length,
          startDatum: user.employee!.start_date,
          fristDagar: k.due_days,
        }),
      };
    })
    .filter((k) => k.antal > 0 && k.lage !== "certifierad");

  const ackade = new Set((minaAck ?? []).map((a) => `${a.document_id}:${a.version}`));
  const okvitterade = (kravDok ?? []).filter((d) => !ackade.has(`${d.id}:${d.version}`));
  const forfallna = mittAgande ?? [];
  const obesvarade = minaArenden ?? [];

  // Stamplingen. Bara dagens handelser — resten hor hemma pa /tid.
  let stamplingslage = null;
  if (sparr.stampling) {
    const { data: idag } = await supabase
      .from("time_event")
      .select("id, kind, occurred_at, source, supersedes_id, correction_state, note")
      .eq("employee_id", user.employee.id)
      .gte("occurred_at", dygnetsStart())
      .order("occurred_at");

    const handelser: Handelse[] = idag ?? [];
    const lage = lageNu(handelser);
    stamplingslage = {
      lage,
      tillatna: tillatna(lage, sparr.rast),
      minuter: arbetadeMinuter(handelser),
    };
  }

  /**
   * Chefens ko.
   *
   * Avvikelserna raknas medvetet INTE. K19 kraver att varje chefsoppning av
   * avvikelsevyn loggas, och en siffra pa startsidan hade betytt en oppning
   * per sidladdning — bade en logg full av brus och en insyn som skett utan
   * att nagon valde den. Posten ar darfor en lank och ingenting mer.
   */
  const [{ data: koArenden }, { count: attKvittera }, { data: koFranvaro }, { data: obekraftadSjuk }] =
    await Promise.all([
      hanterarArenden
        ? supabase
            .from("hr_case")
            .select("id, due_at, sla_hours, resolved_at")
            .is("resolved_at", null)
            .in("status", ["new", "in_progress"])
        : Promise.resolve({ data: null }),
      attesterar && sparr.stampling
        ? supabase
            .from("time_event")
            .select("id", { count: "exact", head: true })
            .eq("correction_state", "pending")
        : Promise.resolve({ count: null }),
      // E7. Bada laser med anvandarens egen token: absence_request_read och
      // sick_report_read slapper igenom egen rad, den man leder och ledningen.
      // Egna rader filtreras bort i koden — ingen beslutar om sin egen ledighet,
      // och en ko med sin egen ansokan i ar en ko man inte kan tomma.
      supabase
        .from("absence_request")
        .select("id, employee_id, starts_on, rules_broken")
        .eq("status", "submitted"),
      supabase
        .from("sick_report")
        .select("id, employee_id")
        .is("confirmed_at", null)
        .is("cancelled_at", null),
    ]);

  const attBesluta = (koFranvaro ?? []).filter((a) => a.employee_id !== user.employee!.id);
  const attBekrafta = (obekraftadSjuk ?? []).filter((s) => s.employee_id !== user.employee!.id);

  // E8.7: inlamnade rollspel som ingen bedomt. RLS ger bara egna rader plus
  // dem man leder (0024), sa filtret nedan tar bort just de egna — resten ar
  // per definition nagon annans, och alltsa chefens att bedoma.
  const { data: koRollspel } = await supabase
    .from("roleplay_submission")
    .select("id, employee_id, submitted_at")
    .is("graded_at", null);
  const attBedoma = (koRollspel ?? []).filter((r) => r.employee_id !== user.employee!.id);

  const overTiden = (koArenden ?? []).filter((a) => slaLage(a) === "over").length;
  const snart = (koArenden ?? []).filter((a) => slaLage(a) === "snart").length;

  const [{ count: antalAktiva }, { count: antalOnboarding }] = serPersonal
    ? await Promise.all([
        supabase.from("employee").select("id", { count: "exact", head: true }).eq("status", "active"),
        supabase
          .from("employee")
          .select("id", { count: "exact", head: true })
          .eq("status", "onboarding"),
      ])
    : [{ count: null }, { count: null }];

  const stampelkort = stamplingslage ? (
    <Card status="brand">
      <CardHeader
        titel="Stämpla"
        beskrivning={
          stamplingslage.lage === "ute"
            ? "Tiden sätts när du trycker."
            : `Arbetad tid idag: ${timmarOchMinuter(stamplingslage.minuter)}.`
        }
      />
      <Stamplar lage={stamplingslage.lage} tillatna={stamplingslage.tillatna} />
      <div className="mt-4">
        <Link href="/tid" className="text-small font-semibold text-brand-700 hover:text-brand-900">
          Dagens stämplingar
        </Link>
      </div>
    </Card>
  ) : null;

  const attGora = (
    <Card>
      <CardHeader
        titel="Att göra"
        beskrivning="Kvittenser, kurser och ärenden som väntar på dig."
      />
      {okvitterade.length === 0 &&
      forfallna.length === 0 &&
      kursUppgifter.length === 0 &&
      obesvarade.length === 0 ? (
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
          {obesvarade.map((a) => (
            <Uppgift
              key={`arende-${a.id}`}
              href={`/arenden/${a.id}`}
              titel={a.subject}
              detalj="Ledningen har svarat och väntar på dig"
              markering={<Badge ton={slaLage(a) === "over" ? "danger" : "accent"}>Svara</Badge>}
            />
          ))}
          {kursUppgifter.map((k) => (
            <Uppgift
              key={`kurs-${k.id}`}
              href={`/utbildning/${k.slug}`}
              titel={k.title}
              detalj={`${k.klara} av ${k.antal} moduler klara`}
              markering={<Badge ton={LAGE_TON[k.lage]}>{LAGE_ETIKETT[k.lage]}</Badge>}
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
  );

  const koposter: { href: string; text: string; detalj: string; ton: "danger" | "warn" | "neutral" }[] = [];
  if (hanterarArenden && overTiden > 0)
    koposter.push({
      href: "/arenden",
      text: `${overTiden} ärende${overTiden === 1 ? "" : "n"} över tiden`,
      detalj: "Svarstiden har passerat",
      ton: "danger",
    });
  if (hanterarArenden && snart > 0)
    koposter.push({
      href: "/arenden",
      text: `${snart} snart förfallna`,
      detalj: "Sista fjärdedelen av fristen",
      ton: "warn",
    });
  if (attesterar && (attKvittera ?? 0) > 0)
    koposter.push({
      href: "/tid",
      text: `${attKvittera} rättelse${attKvittera === 1 ? "" : "r"} att besluta`,
      detalj: "Både den gamla och den nya tiden visas",
      ton: "warn",
    });
  // AC-3.17: en obekraftad sjukanmalan ligger overst. Bekraftelsen ar inte
  // administration utan hela poangen — nagon ska ha sett anmalan, och den som
  // ar sjuk ska veta att nagon gjort det.
  if (attBekrafta.length > 0)
    koposter.push({
      href: "/franvaro/sjuk",
      text: `${attBekrafta.length} ${attBekrafta.length === 1 ? "sjukanmälan" : "sjukanmälningar"} att bekräfta`,
      detalj: "Bekräfta att du sett den",
      ton: "danger",
    });

  if (attBesluta.length > 0)
    koposter.push({
      href: "/franvaro/attest",
      text: `${attBesluta.length} ${attBesluta.length === 1 ? "ledighetsansökan" : "ledighetsansökningar"} att besluta`,
      detalj: attBesluta.some((a) => ((a.rules_broken ?? []) as string[]).length > 0)
        ? "Minst en bryter mot en regel"
        : "Alla följer reglerna",
      ton: "warn",
    });

  if (attBedoma.length > 0)
    koposter.push({
      href: "/utbildning/rollspel",
      text: `${attBedoma.length} rollspel att bedöma`,
      detalj: "Lyssna först — öppningen loggas och syns för säljaren",
      ton: "warn",
    });

  if (serAvvikelser && sparr.stampling)
    koposter.push({
      href: "/tid/avvikelser",
      text: "Rastavvikelser",
      detalj: "Din öppning av vyn loggas",
      ton: "neutral",
    });

  const kokort = chef ? (
    <Card>
      <CardHeader titel="Din kö" beskrivning="Det som väntar på ditt beslut." />
      {koposter.length === 0 ? (
        <EmptyState rubrik="Kön är tom" text="Inget ärende och ingen rättelse väntar på dig." />
      ) : (
        <ul className="flex flex-col">
          {koposter.map((p) => (
            <Uppgift
              key={p.href + p.text}
              href={p.href}
              titel={p.text}
              detalj={p.detalj}
              markering={p.ton === "neutral" ? null : <Badge ton={p.ton}>Öppna</Badge>}
            />
          ))}
        </ul>
      )}
    </Card>
  ) : null;

  const personalkort = serPersonal ? (
    <Card>
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
  ) : null;

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

      {/* Ordningen ar hela poangen med E5.4, och den maste halla aven pa
          375 px dar allt ligger i en enda spalt. Darfor byter korten plats i
          traden i stallet for med CSS. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          {chef ? kokort : stampelkort}
          {attGora}
        </div>
        <div className="flex flex-col gap-4">
          {chef ? stampelkort : null}
          {personalkort}
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
