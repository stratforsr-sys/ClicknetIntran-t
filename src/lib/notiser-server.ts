import "server-only";

import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { fullName, type CurrentUser } from "@/lib/auth";
import { kursLage } from "@/lib/utbildning";
import { MAX_NOTISER, notisId, sortera, type Notis } from "@/lib/notiser";
import { hamtaLage } from "@/lib/sparrar";
import { stampelfri } from "@/lib/stampelfri";
import { guiderForRoller } from "@/guider";
import { dagarSedan, personlage, type Progress } from "@/lib/guider";
import { coachningsnotiser } from "@/lib/coachning-server";

/** G6. Sa lange far det sta stilla innan klockan sager till. */
const TYST_DAGAR = 3;

/** Och sa lange innan chefen far raden om nagon annan. */
const CHEFENS_DAGAR = 7;

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

  /**
   * G6. Modulspärren behövs för att veta om personen stämplar, och därmed
   * vilka guider som alls gäller henne. Läses före de andra frågorna eftersom
   * den är cachead per begäran — sidan under klockan har redan ställt den.
   */
  const lage = await hamtaLage();

  const [
    { data: seddRad },
    { data: avfardade },
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
    { data: rollspel },
    { data: felrapporter },
    { data: handelser },
    { data: konsekvensregler },
    { data: guiderader },
    { data: knuffar },
  ] = await Promise.all([
    supabase.from("notification_seen").select("seen_at").eq("employee_id", mig).maybeSingle(),
    // 0038. Poster den har personen redan klickat pa. Hamtas med hennes egen
    // token som allt annat i filen — RLS ger bara hennes egna rader, sa ett
    // eget filter hade varit ett andra svar pa samma fraga.
    supabase.from("notification_dismissed").select("notice_id").eq("employee_id", mig),
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
    // Bara moduler i PUBLICERADE kurser. Fragan lag forut utan filter och las
    // hela tabellen, inklusive utkast som klockan anda kastar bort.
    //
    // `!inner` gor inbaddningen till en inre join, sa villkoret pa kursens
    // status filtrerar modulraderna i stallet for att bara tomma en kolumn.
    // Utan utropstecknet kommer varje modul tillbaka med `course: null`.
    //
    // Vinsten ar INTE matbar i dag (57 mot 58 ms — kostnaden ar turen, inte
    // fragan). Den ar att raden inte vaxer med varje kursutkast nagon lagger
    // upp, och de ar tankta att bli atta (E8.9).
    supabase.from("course_module").select("id, course_id, course!inner(status)").eq("course.status", "published"),
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
    // E8.7. Bade riktningarna i en fraga: RLS ger egna inlamningar och deras
    // som man leder (0024), sa raden nedan blir "ditt rollspel ar bedomt" for
    // saljaren och "ett rollspel vantar" for chefen.
    supabase
      .from("roleplay_submission")
      .select("id, employee_id, submitted_at, graded_at, attempt_id, course(title, slug)")
      .order("submitted_at", { ascending: false })
      .limit(MAX_NOTISER),
    // E0.6. Samma monster igen: RLS i 0026 ger chefen alla rader och alla
    // andra bara sina egna, sa fragan behover inget rollfilter. Vad raden
    // BETYDER avgors nedan av vem som rapporterade den.
    supabase
      .from("error_report")
      .select("id, kind, path, body, message, digest, status, blocking, reporter_id, first_seen_at, handled_at")
      .order("last_seen_at", { ascending: false })
      .limit(MAX_NOTISER),
    // E13 steg 6. Samma monster som rollspelen: EN fraga bar bada riktningarna.
    // RLS i 0037 ger chefen kon och den beromda bara sina BESLUTADE rader, sa
    // ett forslag kan aldrig na den det galler — vilket ar hela poangen med att
    // motorn foreslar i stallet for att besluta.
    supabase
      .from("attendance_incident")
      .select("id, employee_id, occurred_on, status, atgard, suggested_at, decided_at")
      .in("status", ["foreslagen", "godkand"])
      .order("occurred_on", { ascending: false })
      .limit(MAX_NOTISER),
    // Tre rader. `notifiera` ar konfiguration per trappsteg (fraga 48), sa
    // fragan gar inte att undvika — men den ar billig och ligger i samma vag.
    supabase.from("consequence_rule").select("id, atgard, notifiera"),
    /**
     * G6. EN fraga bar bada riktningarna, precis som rollspelen och
     * konsekvenserna gor: RLS i 0041 ger mig mina egna rader OCH deras jag
     * leder. Vad en rad betyder avgors nedan av vems den ar.
     */
    supabase
      .from("guide_progress")
      .select("employee_id, guide_slug, version, steg, completed_at, updated_at"),
    // Knuffar riktade till mig. Tre racker — fyra knuffar i klockan ar inte
    // fyra gangers pafart, det ar en chef som borde ringa i stallet.
    supabase
      .from("guide_nudge")
      .select("id, nudged_by, nudged_at")
      .eq("employee_id", mig)
      .order("nudged_at", { ascending: false })
      .limit(3),
  ]);

  // Ingen rad = allt ar olast. Ratt hall att fela at: en nyanstalld ska se
  // sina rutiner och kurser, inte en tom klocka.
  const sedd = seddRad?.seen_at ? Date.parse(seddRad.seen_at) : 0;
  const arNy = (tid: string | null) => (tid ? Date.parse(tid) > sedd : false);

  const namn = new Map((personer ?? []).map((p) => [p.id, fullName(p)]));
  const notiser: Notis[] = [];

  for (const n of nyheter ?? []) {
    notiser.push({
      id: notisId("nyhet", n.id),
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
      id: notisId("rutin", d.id, d.version),
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
      id: notisId("kurs", k.id),
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
      id: notisId("arende", m.case_id, m.id),
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
        id: notisId("franvaro", a.id),
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
        id: notisId("franvaro-beslut", a.id),
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
      id: notisId("sjuk", s.id),
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

  // E8.7 / AC-6.7. Ett inlämnat rollspel väntar på chefen; ett bedömt är ett
  // besked till säljaren. Båda är riktade till den som läser, och den som inte
  // berörs får inga rader ur databasen — därför behövs inget filter här utöver
  // att skilja på vems rollspel det är.
  for (const r of rollspel ?? []) {
    const mitt = r.employee_id === mig;
    const kurs = r.course as unknown as { title: string; slug: string } | null;

    if (!r.graded_at && !mitt) {
      notiser.push({
        id: notisId("rollspel", r.id),
        typ: "kurs",
        rubrik: `${namn.get(r.employee_id) ?? "En medarbetare"} har lämnat in ett rollspel`,
        detalj: `${kurs?.title ?? "Kurs"} · lyssna och bedöm mot rubriken`,
        href: "/utbildning/rollspel",
        tidpunkt: r.submitted_at,
        olast: arNy(r.submitted_at),
      });
    }

    if (r.graded_at && mitt) {
      notiser.push({
        id: notisId("rollspel-bedomt", r.id),
        typ: "kurs",
        rubrik: "Ditt rollspel är bedömt",
        detalj: `${kurs?.title ?? "Kurs"} · återkopplingen finns i modulen`,
        href: kurs ? `/utbildning/${kurs.slug}` : "/utbildning",
        tidpunkt: r.graded_at,
        olast: arNy(r.graded_at),
      });
    }
  }

  // E13 steg 6. Två poster ur samma tabell, precis som rollspelen ovan.
  //
  // NOTIFIERA ÄR PER TRAPPSTEG. En trappa där första steget inte notifierar ger
  // en varning som ingen får veta om — det är chefens val, och det ska gå att
  // göra. Saknas åtgärden i listan (regeln borttagen) notifieras det ändå:
  // hellre ett besked för mycket än ett beslut någon aldrig hörde talas om.
  const notifierar = new Map(
    (konsekvensregler ?? []).map((r) => [String(r.atgard), r.notifiera !== false]),
  );

  const ATGARDSTEXT: Record<string, string> = {
    varning: "Varning registrerad",
    skriftlig_erinran: "Skriftlig erinran registrerad",
    bonusforlust: "Volymbonus och K&V-bonus faller för den här månaden",
    arende: "Ett personalärende är upplagt — läs och svara",
  };

  for (const h of handelser ?? []) {
    const mitt = h.employee_id === mig;
    const dag = String(h.occurred_on).slice(0, 10);

    // Chefens kö. Ett förslag når aldrig hit för den det gäller — RLS ger inte
    // ut raden — men villkoret står ändå utskrivet, för det är en regel och
    // inte en följd av hur frågan råkar se ut.
    if (h.status === "foreslagen" && !mitt) {
      notiser.push({
        id: notisId("franvaro-forslag", h.id),
        typ: "franvaro",
        rubrik: `${namn.get(h.employee_id) ?? "En medarbetare"} saknar instämpling`,
        detalj: `${dag} · var personen på plats? Ingenting registreras förrän du svarat`,
        href: "/tid/ogiltig-franvaro",
        tidpunkt: h.suggested_at,
        olast: arNy(h.suggested_at),
      });
    }

    // Beskedet till den det gäller (fråga 48).
    if (h.status === "godkand" && mitt && notifierar.get(String(h.atgard)) !== false) {
      notiser.push({
        id: notisId("franvaro-konsekvens", h.id),
        typ: "franvaro",
        rubrik: `Ogiltig frånvaro registrerad ${dag}`,
        detalj: ATGARDSTEXT[String(h.atgard)] ?? "Beslutad av din chef",
        href: "/provision",
        tidpunkt: h.decided_at ?? h.suggested_at,
        olast: arNy(h.decided_at ?? h.suggested_at),
      });
    }
  }

  // AC-3.19. Egna påminnelser formuleras som en påminnelse, andras som en
  // uppgift — och andras syns bara efter fördröjningen, vilket policyn i 0020
  // sköter. Den anställda ser alltså sin lucka först och kan rätta den innan
  // någon annan fått veta att den fanns.
  for (const p of paminnelser ?? []) {
    const mitt = p.employee_id === mig;
    notiser.push({
      id: notisId("franvaro-lucka", p.id),
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

  /**
   * E0.6. Notisen betyder olika saker at olika hall, och skillnaden gors utan
   * att fraga efter rollen:
   *
   *   - ar raden NAGON ANNANS kan bara den som far hantera kon se den alls
   *     (RLS i 0026), sa "ny rapport" ar det enda den kan betyda,
   *   - ar raden DIN egen ar en ny rapport bara ett eko av det du nyss
   *     skickade. Det som ar varr att veta ar att nagon svarat.
   *
   * Utan den asymmetrin hade rapportoren fatt en notis om sin egen rapport i
   * samma sekund hon tryckte skicka, och kretsen som ska laga fel hade fatt en
   * notis varje gang de sjalva avslutade nagot.
   */
  for (const f of felrapporter ?? []) {
    const mitt = f.reporter_id === mig;

    if (mitt) {
      if (f.status === "new" || !f.handled_at) continue;
      notiser.push({
        id: notisId("fel-svar", f.id),
        typ: "fel",
        rubrik:
          f.status === "closed" ? "Din felrapport är avslutad" : "Någon tittar på din felrapport",
        detalj: f.path,
        href: "/fel",
        tidpunkt: f.handled_at,
        olast: arNy(f.handled_at),
      });
      continue;
    }

    if (f.status !== "new") continue;
    notiser.push({
      id: notisId("fel", f.id),
      typ: "fel",
      rubrik: f.blocking ? "Ett fel stoppade någon" : "Nytt fel rapporterat",
      detalj:
        f.kind === "manual"
          ? `${namn.get(f.reporter_id ?? "") ?? "En medarbetare"} · ${f.path}`
          : `Navet fångade ett fel på ${f.path}`,
      href: "/fel",
      tidpunkt: f.first_seen_at,
      olast: arNy(f.first_seen_at),
    });
  }

  /**
   * ===========================================================================
   * G6. SYSTEMGUIDERNA — TRE POSTER UR SAMMA RADER
   *
   * Ingen av dem larmar direkt. En guide som startade i morse och står på steg
   * två är inte ett problem; det är någon som håller på. Först när ingenting
   * rört sig på tre dygn är tystnaden värd en rad, och det är samma tröskel
   * chefens vy markerar på.
   * ===========================================================================
   */
  {
    const minaGuider = guiderForRoller(user.roles, {
      stamplar: lage.stampling && !stampelfri(user.roles),
      behorigheter: user.permissions,
    });

    const alla = (guiderader ?? []) as (Progress & { employee_id: string })[];
    const minaRader = alla.filter((r) => r.employee_id === mig);
    const mitt = personlage(minaGuider, minaRader, user.employee.start_date);

    // Nasta tur som inte ar klar. Bar id:t, sa posten aterupstar av sig sjalv
    // nar man gjort klart den man stod i och nasta tar vid.
    const nasta = minaGuider.find(
      (g) => !minaRader.some((r) => r.guide_slug === g.slug && r.completed_at),
    );

    /**
     * MIN EGEN PAMINNELSE. Bara nar det faktiskt star still: den som gor en
     * guide i dag ska inte samtidigt fa en notis om att hon inte gjort den.
     *
     * Tidpunkten ar senaste rorelsen, eller startdatumet for den som aldrig
     * borjat. Utan en tidpunkt filtreras posten bort langre ner — och en
     * paminnelse som aldrig syns ar samre an ingen.
     */
    if (!mitt.onboardad && nasta) {
      const stilla =
        mitt.stillestand === null
          ? (dagarSedan(user.employee.start_date ?? null) ?? 0)
          : mitt.stillestand;

      if (stilla >= TYST_DAGAR) {
        const tidpunkt =
          mitt.senast ?? (user.employee.start_date ? `${user.employee.start_date}T08:00:00Z` : "");
        notiser.push({
          id: notisId("guide", nasta.slug, nasta.version),
          typ: "guide",
          rubrik: mitt.klara === 0 ? "Kom igång i navet" : `${mitt.av - mitt.klara} guider kvar`,
          detalj: `${mitt.klara} av ${mitt.av} klara · ${nasta.titel} (${nasta.minuter} min)`,
          href: "/utbildning/systemguider",
          tidpunkt,
          olast: arNy(tidpunkt),
        });
      }
    }

    /**
     * NAGON HAR SAGT TILL. Knuffen visas aven om turen ror sig — den ar inte en
     * paminnelse utan ett meddelande fran en manniska, och att tysta den for
     * att personen precis borjat vore att dolja att chefen horde av sig.
     *
     * Men inte nar hon ar klar. Da ar knuffen overspelad, och en tillsagelse om
     * nagot man redan gjort ar det snabbaste sattet att fa nagon att sluta lasa
     * klockan.
     */
    if (!mitt.onboardad) {
      for (const k of knuffar ?? []) {
        notiser.push({
          id: notisId("guide-knuff", k.id),
          typ: "guide",
          rubrik: "Din chef undrar hur det går",
          detalj: `${namn.get(k.nudged_by) ?? "Din chef"} · ${mitt.av - mitt.klara} guider kvar`,
          href: "/utbildning/systemguider",
          tidpunkt: k.nudged_at,
          olast: arNy(k.nudged_at),
        });
      }
    }

    /**
     * CHEFENS RAD. Bygger BARA pa raderna, inte pa nagons paket: en tur som
     * paborjats och sedan legat still i en vecka ar en tydlig signal utan att
     * vi behover rakna fram vilka guider var och en skulle ha haft. Att gora
     * det hade betytt en rolluppslagning per person i varje sidvisning, i en
     * klocka som redan staller sjutton fragor.
     *
     * ID:T BAR ANTALET VECKOR, sa posten aterupstar en gang i veckan for den
     * som klickat bort den och som fortfarande inte gjort nagot at saken.
     */
    const perPerson = new Map<string, number>();
    for (const r of alla) {
      if (r.employee_id === mig || r.completed_at || r.steg <= 0) continue;
      const dagar = dagarSedan(r.updated_at ?? null);
      if (dagar === null) continue;
      const forra = perPerson.get(r.employee_id);
      if (forra === undefined || dagar < forra) perPerson.set(r.employee_id, dagar);
    }

    for (const [personId, dagar] of perPerson) {
      if (dagar < CHEFENS_DAGAR) continue;
      const veckor = Math.floor(dagar / 7);
      notiser.push({
        id: notisId("guide-team", personId, veckor),
        typ: "guide",
        rubrik: `${namn.get(personId) ?? "En medarbetare"} har stannat av`,
        detalj: `Ingen rörelse i systemguiderna på ${dagar} dagar`,
        href: "/utbildning/oversikt/systemguider",
        tidpunkt: new Date(Date.now() - dagar * 24 * 60 * 60 * 1000).toISOString(),
        olast: true,
      });
    }
  }

  /**
   * Coachningen.
   *
   * Grenen ligger i `coachning-server.ts` och inte har inne. Skalet ar det
   * destrukturerade `Promise.all` ovanfor: dar betyder ordningen allt, och en
   * ny post mitt i listan ar fyra andringar dar tre rader maste hallas i takt.
   * Modulen far svara pa sin egen fraga i stallet.
   *
   * Kastar aldrig upp. En trasig coachningsfraga far inte tomma hela klockan —
   * det ar sjutton andra poster som da forsvinner for en modul som ar den
   * yngsta i navet.
   */
  try {
    notiser.push(...(await coachningsnotiser(user)));
  } catch {
    // Tyst. Felet syns i `error_report` via sidans egen felgrans.
  }

  /**
   * Avfardningen filtreras FORE `slice`, inte efter.
   *
   * Femton platser ar hela listan. Hade de avfardade rakats bort forst efter
   * kapningen hade de fortfarande atit upp sina platser, och den som klickade
   * bort tre poster hade fatt en kortare lista i stallet for tre nya. Det ar
   * precis tvartemot vad knappen lovar.
   */
  const bortklickade = new Set((avfardade ?? []).map((a) => a.notice_id));

  return sortera(notiser.filter((n) => n.tidpunkt && !bortklickade.has(n.id))).slice(0, MAX_NOTISER);
}

/**
 * Klickad, och darmed ur vagen.
 *
 * Skrivs med service role av samma skal som `markeraSedd()`: klientrollerna har
 * ingen skrivratt sedan 0002, och skulle de fa den har kunde vem som helst tysta
 * nagon annans klocka.
 *
 * `onConflict` gor den idempotent. Ett dubbelklick, en langsam uppkoppling eller
 * en anvandare som backar tillbaka och klickar igen far inte bli ett fel som
 * stoppar navigeringen — posten ar redan borta, vilket var hela onskemalet.
 */
export async function avfardaNotis(employeeId: string, noticeId: string): Promise<void> {
  await supabaseAdmin()
    .from("notification_dismissed")
    .upsert({ employee_id: employeeId, notice_id: noticeId }, { onConflict: "employee_id,notice_id" });
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
