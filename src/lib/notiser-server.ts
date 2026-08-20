import "server-only";

import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { fullName, type CurrentUser } from "@/lib/auth";
import { kursLage } from "@/lib/utbildning";
import { MAX_NOTISER, sortera, type Notis } from "@/lib/notiser";

/**
 * Allt som ar riktat till den har personen just nu.
 *
 * Lases med ANVANDARENS EGEN TOKEN, aldrig med service role. Det ar inte en
 * detalj utan hela malgruppsstyrningen: `news_post_read`, `document_read` och
 * `course_read` gar alla genom `matches_audience()`, sa databasen har redan
 * svarat pa fragan "ar det har riktat till mig". Ett eget filter i den har
 * filen hade varit ett andra svar pa samma fraga — och tva svar glider isar.
 *
 * Det ar ocksa darfor konfidentiella arenden inte behover namnas har.
 */
export async function hamtaNotiser(user: CurrentUser): Promise<Notis[]> {
  if (!user.employee) return [];
  const mig = user.employee.id;
  const supabase = await supabaseServer();

  const [
    { data: seddRad },
    { data: nyheter },
    { data: kravDok },
    { data: minaAck },
    { data: kurser },
    { data: kursModuler },
    { data: minProgress },
    { data: minaCert },
    { data: meddelanden },
    { data: personer },
    { data: ansokningar },
    { data: obekraftadSjuk },
    { data: paminnelser },
    { data: franvarotyper },
  ] = await Promise.all([
    supabase.from("notification_seen").select("seen_at").eq("employee_id", mig).maybeSingle(),
    supabase
      .from("news_post")
      .select("id, slug, title, published_at, pinned")
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(MAX_NOTISER),
    supabase
      .from("document")
      .select("id, slug, title, version, published_at")
      .eq("status", "published")
      .eq("requires_ack", true),
    supabase.from("document_ack").select("document_id, version").eq("employee_id", mig),
    supabase
      .from("course")
      .select("id, slug, title, due_days, published_at")
      .eq("status", "published"),
    supabase.from("course_module").select("id, course_id"),
    supabase.from("module_progress").select("module_id").eq("employee_id", mig),
    supabase
      .from("certification")
      .select("course_id, issued_at, expires_at")
      .eq("employee_id", mig)
      .order("issued_at", { ascending: false }),
    // Ett nytt arende skapar alltid ett forsta meddelande (se skapaArende), sa
    // den har enda fragan tacker bade "nagon skrev ett arende" och "nagon
    // svarade". Att leta efter bada separat hade gett dubbletter pa det forsta.
    supabase
      .from("case_message")
      .select("id, created_at, author_id, case_id, hr_case(id, subject, employee_id)")
      .neq("author_id", mig)
      .order("created_at", { ascending: false })
      .limit(MAX_NOTISER * 2),
    supabase.from("employee").select("id, first_name, last_name"),
    // E7. Bada fragorna gar med anvandarens EGEN token, precis som resten av
    // filen. `absence_request_read` slapper igenom egen rad, den man leder och
    // ledningen; `absence_reminder_read` doljer paminnelsen for chefen tills
    // fordrojningen gatt ut (AC-3.19). Ett eget filter har hade varit ett
    // andra svar pa samma fraga.
    supabase
      .from("absence_request")
      .select("id, employee_id, type_id, starts_on, ends_on, status, submitted_at, decided_at")
      .in("status", ["submitted", "approved", "rejected"])
      .order("submitted_at", { ascending: false })
      .limit(MAX_NOTISER * 2),
    supabase
      .from("sick_report")
      .select("id, employee_id, first_sick_day, registered_at, confirmed_at, escalated_at")
      .is("confirmed_at", null)
      .is("cancelled_at", null)
      .order("registered_at", { ascending: false })
      .limit(MAX_NOTISER),
    supabase
      .from("absence_reminder")
      .select("id, employee_id, work_date, created_at")
      .is("resolved_at", null)
      .order("work_date", { ascending: false })
      .limit(MAX_NOTISER),
    supabase.from("absence_type").select("id, label"),
  ]);

  // Ingen rad = allt ar olast. Ratt hall att fela at: en nyanstalld ska se
  // sina rutiner och kurser, inte en tom klocka.
  const sedd = seddRad?.seen_at ? Date.parse(seddRad.seen_at) : 0;
  const arNy = (tid: string | null) => (tid ? Date.parse(tid) > sedd : false);

  const namn = new Map((personer ?? []).map((p) => [p.id, fullName(p)]));
  const notiser: Notis[] = [];

  for (const n of nyheter ?? []) {
    notiser.push({
      id: `nyhet-${n.id}`,
      typ: "nyhet",
      rubrik: n.title,
      detalj: n.pinned ? "Viktigt meddelande" : "Nytt inlägg",
      href: `/nyheter/${n.slug}`,
      tidpunkt: n.published_at ?? "",
      olast: arNy(n.published_at),
    });
  }

  const ackade = new Set((minaAck ?? []).map((a) => `${a.document_id}:${a.version}`));
  for (const d of kravDok ?? []) {
    if (ackade.has(`${d.id}:${d.version}`)) continue;
    notiser.push({
      id: `rutin-${d.id}-${d.version}`,
      typ: "rutin",
      rubrik: d.title,
      // Version 1 ar ny; allt darover ar en andring som kraver ny kvittens.
      detalj: d.version > 1 ? `Ny version ${d.version} att kvittera` : "Att kvittera",
      href: `/rutiner/${d.slug}`,
      tidpunkt: d.published_at ?? "",
      olast: arNy(d.published_at),
    });
  }

  const modulerPerKurs = new Map<string, string[]>();
  for (const m of kursModuler ?? []) {
    modulerPerKurs.set(m.course_id, [...(modulerPerKurs.get(m.course_id) ?? []), m.id]);
  }
  const klaraModuler = new Set((minProgress ?? []).map((p) => p.module_id));
  const certPerKurs = new Map<string, { issued_at: string; expires_at: string | null }>();
  for (const c of minaCert ?? []) if (!certPerKurs.has(c.course_id)) certPerKurs.set(c.course_id, c);

  for (const k of kurser ?? []) {
    const ids = modulerPerKurs.get(k.id) ?? [];
    if (ids.length === 0) continue;
    const klara = ids.filter((id) => klaraModuler.has(id)).length;
    const lage = kursLage({
      certifikat: certPerKurs.get(k.id) ?? null,
      klaraModuler: klara,
      antalModuler: ids.length,
      startDatum: user.employee.start_date,
      fristDagar: k.due_days,
    });
    if (lage === "certifierad") continue;

    notiser.push({
      id: `kurs-${k.id}`,
      typ: "kurs",
      rubrik: k.title,
      detalj: klara === 0 ? "Ny kurs för dig" : `${klara} av ${ids.length} moduler klara`,
      href: `/utbildning/${k.slug}`,
      tidpunkt: k.published_at ?? "",
      olast: arNy(k.published_at),
    });
  }

  // Ett meddelande per arende racker — tre svar i samma trad ar en notis, inte
  // tre. Listan kommer sorterad nyast forst, sa det forsta vi ser per arende ar
  // ocksa det senaste.
  const settArende = new Set<string>();
  for (const m of (meddelanden ?? []) as unknown as {
    id: string;
    created_at: string;
    author_id: string;
    case_id: string;
    hr_case: { id: string; subject: string; employee_id: string } | null;
  }[]) {
    if (!m.hr_case || settArende.has(m.case_id)) continue;
    settArende.add(m.case_id);

    const mitt = m.hr_case.employee_id === mig;
    const forfattare = namn.get(m.author_id);

    notiser.push({
      id: `arende-${m.case_id}-${m.id}`,
      typ: "arende",
      rubrik: m.hr_case.subject,
      detalj: mitt
        ? "Svar i ditt ärende"
        : forfattare
          ? `Från ${forfattare}`
          : "Svar i ett ärende du hanterar",
      href: `/arenden/${m.case_id}`,
      tidpunkt: m.created_at,
      olast: arNy(m.created_at),
    });
  }

  // ---------------------------------------------------------------------------
  // E7 Frånvaro
  //
  // Tre sorters post, och de skiljer sig åt i VEM de gäller — vilket RLS redan
  // har svarat på. Raden är antingen min egen eller någons jag leder, och koden
  // nedan behöver bara veta vilketdera för att välja formulering.
  //
  // K35: ingen av posterna bär en orsak, för ingen orsak finns lagrad.
  // ---------------------------------------------------------------------------
  const typnamn = new Map((franvarotyper ?? []).map((t) => [t.id, t.label]));

  for (const a of ansokningar ?? []) {
    const mitt = a.employee_id === mig;

    if (a.status === "submitted" && !mitt) {
      // Väntar på mitt beslut. Att raden syns betyder att jag leder personen
      // eller är ledning — RLS har redan avgjort det.
      notiser.push({
        id: `franvaro-${a.id}`,
        typ: "franvaro",
        rubrik: `${namn.get(a.employee_id) ?? "En medarbetare"} söker ledigt`,
        detalj: `${typnamn.get(a.type_id) ?? a.type_id} · ${a.starts_on}`,
        href: `/franvaro/${a.id}`,
        tidpunkt: a.submitted_at ?? "",
        olast: arNy(a.submitted_at),
      });
      continue;
    }

    // Beslut på min egen ansökan. Ett godkännande är lika mycket besked som
    // ett avslag — den som inte får veta planerar inte sin semester.
    if (mitt && (a.status === "approved" || a.status === "rejected") && a.decided_at) {
      notiser.push({
        id: `franvaro-beslut-${a.id}`,
        typ: "franvaro",
        rubrik: a.status === "approved" ? "Din ledighet är godkänd" : "Din ansökan avslogs",
        detalj: `${typnamn.get(a.type_id) ?? a.type_id} · ${a.starts_on}`,
        href: `/franvaro/${a.id}`,
        tidpunkt: a.decided_at,
        olast: arNy(a.decided_at),
      });
    }
  }

  for (const s of obekraftadSjuk ?? []) {
    if (s.employee_id === mig) continue;
    notiser.push({
      id: `sjuk-${s.id}`,
      typ: "franvaro",
      rubrik: `${namn.get(s.employee_id) ?? "En medarbetare"} är sjukanmäld`,
      detalj: s.escalated_at
        ? `Sedan ${s.first_sick_day} · ingen har bekräftat`
        : `Sedan ${s.first_sick_day} · bekräfta att du sett den`,
      href: "/franvaro/sjuk",
      tidpunkt: s.registered_at,
      olast: arNy(s.registered_at),
    });
  }

  // AC-3.19. Egna påminnelser formuleras som en påminnelse, andras som en
  // uppgift — och andras syns bara efter fördröjningen, vilket policyn i 0020
  // sköter. Den anställda ser alltså sin lucka först och kan rätta den innan
  // någon annan fått veta att den fanns.
  for (const p of paminnelser ?? []) {
    const mitt = p.employee_id === mig;
    notiser.push({
      id: `franvaro-lucka-${p.id}`,
      typ: "franvaro",
      rubrik: mitt
        ? `Ingen frånvaro registrerad ${p.work_date}`
        : `${namn.get(p.employee_id) ?? "En medarbetare"} saknar registrering ${p.work_date}`,
      detalj: mitt
        ? "Du var schemalagd men stämplade inte. Registrera din frånvaro."
        : "Schemalagd dag utan stämpling eller frånvaro",
      href: "/franvaro",
      tidpunkt: p.created_at,
      olast: arNy(p.created_at),
    });
  }

  return sortera(notiser.filter((n) => n.tidpunkt)).slice(0, MAX_NOTISER);
}

/**
 * Flyttar fram tidpunkten for "senast oppnad".
 *
 * Skrivs med service role: klientrollerna har ingen skrivratt alls sedan 0002,
 * och det ska de inte fa har heller — annars kunde vem som helst satta nagon
 * annans tidpunkt och tysta deras klocka.
 */
export async function markeraSedd(employeeId: string): Promise<void> {
  await supabaseAdmin()
    .from("notification_seen")
    .upsert({ employee_id: employeeId, seen_at: new Date().toISOString() });
}
