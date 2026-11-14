"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { svensktDatum } from "@/lib/klocka";
import {
  LAGESHANDELSER,
  PRIORITETER,
  andringstext,
  arStangd,
  farArbeta,
  farGranska,
  farLamna,
  farPlanera,
  farRedigera,
  farStyra,
  lageAv,
  provaLaggaTill,
  provaLamnaOver,
  tolkaSnabbrad,
  type Handelsetyp,
  type Krets,
  type Medlemsroll,
  type Prioritet,
} from "@/lib/uppgifter";
import { granskaRegel, regelUrFormular, serietext } from "@/lib/upprepning";
import { skapaSerie } from "@/lib/upprepning-server";
import {
  arDelningsniva,
  farArbetaSomAgaren,
  farPlaneraOm,
  serDetaljer,
  type Delningsniva,
} from "@/lib/kalender";
import { notifiera, notifieraFlera } from "@/lib/notishandelse-server";

/**
 * Uppgiftsmodulens skrivningar.
 *
 * SKRIVNING GAR VIA SERVICE ROLE OCH FORBI RLS (D-T1), sa kontrollerna harinne
 * ar de enda som finns. `task_read` i 0054 galler lasningen och ingenting
 * annat — den som bara har `taskId` och en webblasare kommer hit, inte dit.
 *
 * Varje skrivande funktion borjar darfor med `kravKrets()`, som hamtar raden
 * med service role och svarar pa vem den inloggade AR i forhallande till den.
 * Beslutet fattas sedan av de rena funktionerna i `lib/uppgifter.ts`, som ar
 * provade var for sig.
 */

export type UppgiftState = {
  fel?: string;
  ok?: string;
  id?: string;
  /** 0298: någon annan hann ändra fältet. `nu` är texten som står i databasen. */
  konflikt?: { falt: "title" | "description_md"; nu: string };
};

async function kravInloggad() {
  const user = await getCurrentUser();
  if (!user?.employee) throw new Error("Du måste vara inloggad.");
  return user;
}

function text(form: FormData, namn: string): string {
  return String(form.get(namn) ?? "").trim();
}

function valfritt(form: FormData, namn: string): string | null {
  return text(form, namn) || null;
}

type Rad = {
  id: string;
  title: string;
  assignee_id: string | null;
  created_by: string;
  project_id: string | null;
  parent_id: string | null;
  // 0298: det som var innan en ändring. `andringstext()` jämför mot det, och
  // jämför-och-byt i `andraUppgift()` frågar om texten hunnit ändras.
  description_md: string;
  due_date: string | null;
  due_time: string | null;
  priority: number;
};

type Medlemsrad = { employee_id: string; role: Medlemsroll };

/**
 * Raden, den inloggade, och vad hen far gora med den.
 *
 * Hamtar OCKSA medlemsraderna, for rollen bland de inbjudna avgor tre av de
 * fyra behorighetsfragorna. Tva turer i stallet for en vore billigare i kod
 * och dyrare i praktiken: varje action harinne hade behovt bada anda.
 */
async function kravKrets(taskId: string): Promise<{
  user: Awaited<ReturnType<typeof kravInloggad>>;
  rad: Rad;
  krets: Krets;
  granskare: string[];
  /** 0057: nivan den ansvariga gett mig i sin kalender. Null nar ingen finns. */
  kalenderniva: Delningsniva | null;
  /** 0298: alla tillagda, med roll. */
  medlemmar: Medlemsrad[];
  /**
   * 0298: de som arbetar i uppgiften — den som la upp den, den som har bollen
   * och de som ar med — och for en deluppgift ocksa foralderns. Det ar mellan
   * de har bollen kan flyttas utan att nagon ny kommer in i kretsen.
   */
  arbetar: string[];
}> {
  const user = await kravInloggad();
  const mig = user.employee!.id;
  const db = supabaseAdmin();

  const [{ data: rad }, { data: medlemsrader }] = await Promise.all([
    db
      .from("task")
      .select("id, title, assignee_id, created_by, project_id, parent_id, description_md, due_date, due_time, priority")
      .eq("id", taskId)
      .maybeSingle(),
    db.from("task_member").select("employee_id, role").eq("task_id", taskId),
  ]);

  if (!rad) throw new Error("Uppgiften finns inte.");

  const r = rad as Rad;
  const medlemmar = (medlemsrader ?? []) as Medlemsrad[];
  const minRoll = medlemmar.find((m) => m.employee_id === mig)?.role ?? null;

  const [kalenderniva, foralder] = await Promise.all([
    delningsniva(r.assignee_id, mig),
    foralderskrets(db, r.parent_id, mig),
  ]);

  const krets: Krets = {
    mig,
    assignee_id: r.assignee_id,
    created_by: r.created_by,
    minRoll,
    somDelegat: farArbetaSomAgaren(kalenderniva),
    // 0298 (H6). Den som far arbeta i foraldern far arbeta i steget.
    viaForalder: foralder.arbetar.includes(mig),
  };

  /**
   * DEN SOM INTE SER RADEN FAR INTE HELLER VETA ATT DEN FINNS.
   *
   * Utan den har grenen svarar en godtycklig `taskId` med "du får inte ändra
   * uppgiften" i stallet for "uppgiften finns inte", och skillnaden ar att det
   * forsta bekraftar att raden existerar. I den har modulen ar existensen i sig
   * det kansliga — se rubriken i 0054.
   */
  const ser =
    krets.assignee_id === mig ||
    krets.created_by === mig ||
    minRoll !== null ||
    // 0057. Samma gren som `uppgift_synlig()` fick: en delning pa "alla
    // detaljer" eller mer oppnar raden. RLS och den har kontrollen maste saga
    // samma sak, annars svarar lasningen och skrivningen olika pa vem som ser.
    serDetaljer(kalenderniva) ||
    foralder.ser;

  if (!ser) throw new Error("Uppgiften finns inte.");

  const arbetar = [
    ...new Set(
      [
        r.created_by,
        r.assignee_id,
        ...medlemmar.filter((m) => m.role === "redigerare").map((m) => m.employee_id),
        ...foralder.arbetar,
      ].filter((x): x is string => Boolean(x)),
    ),
  ];

  return {
    user,
    rad: r,
    krets,
    granskare: medlemmar.filter((m) => m.role === "granskare").map((m) => m.employee_id),
    kalenderniva,
    medlemmar,
    arbetar,
  };
}

/**
 * Nivan `agare` gett `lasare` i sin kalender, eller null.
 *
 * LASES MED SERVICE ROLE, och urvalet ar spärren precis som i `namnkarta()`:
 * fragan galler exakt ett par av id:n, och det ena ar den inloggade. Funktionen
 * kan alltsa bara svara pa "vad har den har personen gett MIG", aldrig blattra
 * i vem som delat med vem. Med anvandarens egen token hade svaret varit samma
 * — `calendar_share_read` i 0057 slapper fram just de tva hallen — men vagen
 * gar anda via admin, eftersom resten av filen skriver med service role och en
 * kontroll som byter klient mitt i ar en kontroll man laser fel.
 */
async function delningsniva(agare: string | null, lasare: string): Promise<Delningsniva | null> {
  if (!agare || agare === lasare) return null;

  const { data } = await supabaseAdmin()
    .from("calendar_share")
    .select("level")
    .eq("owner_id", agare)
    .eq("viewer_id", lasare)
    .maybeSingle();

  const niva = (data as { level?: string } | null)?.level;
  return arDelningsniva(niva) ? niva : null;
}

/** En deluppgift arvs av forlderns krets — samma gren som RLS-policyn har — och sedan 0298 ocksa arbetsratten. */
async function foralderskrets(
  db: ReturnType<typeof supabaseAdmin>,
  parentId: string | null,
  mig: string,
): Promise<{ ser: boolean; arbetar: string[] }> {
  if (!parentId) return { ser: false, arbetar: [] };

  const [{ data: far }, { data: medlemmar }] = await Promise.all([
    db.from("task").select("assignee_id, created_by").eq("id", parentId).maybeSingle(),
    db.from("task_member").select("employee_id, role").eq("task_id", parentId),
  ]);

  if (!far) return { ser: false, arbetar: [] };

  const rader = (medlemmar ?? []) as Medlemsrad[];
  const ser =
    far.assignee_id === mig || far.created_by === mig || rader.some((m) => m.employee_id === mig);

  // 0298 (H6): de som ARBETAR i foraldern. Den som bara kan se, och granskaren,
  // ser steget men bockar det inte — samma grans som i foraldern sjalv.
  const arbetar = [
    far.created_by as string,
    far.assignee_id as string | null,
    ...rader.filter((m) => m.role === "redigerare").map((m) => m.employee_id),
  ].filter((x): x is string => Boolean(x));

  return { ser, arbetar };
}

/** En rad i historiken. Allt som andrar laget gar igenom den har. */
async function skrivHandelse(
  taskId: string,
  typ: Handelsetyp,
  av: string,
  note?: string | null,
): Promise<void> {
  const db = supabaseAdmin();
  await db.from("task_event").insert({ task_id: taskId, type: typ, by_employee_id: av, note: note ?? null });
  // `updated_at` bar "hur lange har det statt still" i delegeringslistan. Den
  // satts har och inte av en trigger, sa att den alltid foljer med handelsen.
  await db.from("task").update({ updated_at: new Date().toISOString() }).eq("id", taskId);
}

async function nuvarandeLage(taskId: string) {
  const { data } = await supabaseAdmin()
    .from("task_event")
    .select("type")
    .eq("task_id", taskId)
    .order("at");
  return lageAv((data ?? []) as { type: Handelsetyp }[]);
}

/**
 * 0298: skriv handelsen bara om laget tillater det, i ETT steg i databasen.
 *
 * Svarar med typen som stoppade, eller null nar handelsen skrevs. Se
 * `uppgift_handelse_villkorad` i 0298 for varfor: tva som bockar samtidigt i en
 * delad uppgift gav tva `klar`, eftersom laget lastes i ett anrop och
 * handelsen skrevs i ett annat.
 */
async function skrivVillkorad(
  taskId: string,
  typ: Handelsetyp,
  av: string,
  note: string | null,
  stoppande: Handelsetyp[],
): Promise<Handelsetyp | null> {
  const { data, error } = await supabaseAdmin().rpc("uppgift_handelse_villkorad", {
    p_task: taskId,
    p_typ: typ,
    p_av: av,
    p_note: note,
    p_lagestyper: LAGESHANDELSER,
    p_stoppande: stoppande,
  });
  if (error) throw new Error(`Händelsen sparades inte: ${error.message}`);
  return (data as Handelsetyp | null) ?? null;
}

/** De som har uppgiften som SIN: den som har bollen och de som ar med. */
function harDenSomSin(rad: Rad, medlemmar: Medlemsrad[]): string[] {
  return [rad.assignee_id, ...medlemmar.filter((m) => m.role === "redigerare").map((m) => m.employee_id)].filter(
    (x): x is string => Boolean(x),
  );
}

/** Ar uppgiften delad — finns det fler an en som arbetar i den? */
function arDelad(rad: Rad, medlemmar: Medlemsrad[]): boolean {
  return new Set([rad.created_by, ...harDenSomSin(rad, medlemmar)]).size > 1;
}

/** Namnet och om personen slutat. Null nar id:t inte finns (eller inte ar ett id). */
async function slaUppAnstalld(id: string): Promise<{ namn: string; slutat: boolean } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await supabaseAdmin()
    .from("employee")
    .select("first_name, last_name, status")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const p = data as { first_name: string; last_name: string; status: string };
  return { namn: `${p.first_name} ${p.last_name}`.trim(), slutat: p.status === "offboarded" };
}

/** H13: har uppgiften en personkoppling till `person` som ar dold for hen? */
async function doldKopplingTill(taskId: string, person: string): Promise<boolean> {
  const { data } = await supabaseAdmin()
    .from("task_link")
    .select("id")
    .eq("task_id", taskId)
    .eq("employee_id", person)
    .eq("visible_to_subject", false)
    .limit(1);
  return (data ?? []).length > 0;
}

/**
 * En granskare forsvann ur en uppgift som vantar pa godkannande. Finns ingen
 * kvar kan ingen godkanna, och uppgiften hade statt i "Väntar på godkännande"
 * for alltid. Den gar tillbaka till arbetet, med en rad som sager varfor.
 */
async function slappUrGranskning(taskId: string, av: string, kvarvarandeGranskare: number): Promise<void> {
  if (kvarvarandeGranskare > 0) return;
  if ((await nuvarandeLage(taskId)) !== "granskas") return;
  await skrivHandelse(taskId, "paborjad", av, "Ingen granskare är kvar. Uppgiften är öppen igen.");
}

/**
 * Lagger till en person och sager till dem det ror. Kontrollerna ar gjorda av
 * anroparen (`provaLaggaTill`).
 *
 * =============================================================================
 * BESKEDET AR EN SKRIVEN HANDELSE (`uppgift-med`), OCH DET ANDRAR ETT GAMMALT VAL
 *
 * Fram till 0298 stod har "SKRIV INTE EN NOTISRAD": att vara inbjuden ar ett
 * tillstand, och den harledda `uppgift-ny` skulle falla bort av sig sjalv nar
 * arbetet borjat. Regeln ar riktig for en NY uppgift. Men att laggas till i en
 * uppgift som funnits i tre veckor ar samma fall som omtilldelningen, och for
 * den finns `uppgift-tilldelad` av just det skalet (se notiser.ts): den
 * harledda posten tandes bara i `ej_paborjad`, daterades med uppgiftens
 * `created_at` och sa "Från" den som la upp uppgiften. Den som lades till i
 * nagot som redan pagick fick alltsa inget besked alls, och ingen push.
 *
 * `uppgiftsnotiser()` tander darfor inte langre `uppgift-ny` for den som bara
 * ar med, sa att beskedet kommer en gang.
 * =============================================================================
 */
async function laggTill(a: {
  rad: Pick<Rad, "id" | "title" | "assignee_id" | "created_by">;
  person: string;
  namn: string;
  roll: Medlemsroll;
  av: string;
  avFornamn: string;
}): Promise<string | null> {
  const db = supabaseAdmin();
  const { error } = await db
    .from("task_member")
    .upsert(
      { task_id: a.rad.id, employee_id: a.person, role: a.roll, added_by: a.av },
      { onConflict: "task_id,employee_id" },
    );
  if (error) return `Personen lades inte till: ${error.message}`;

  const som = a.roll === "redigerare" ? "" : a.roll === "granskare" ? " som granskare" : " som kan se";
  // B9: den som la upp uppgiften och går med själv har inte "lagt till" någon.
  await skrivHandelse(a.rad.id, "krets", a.av, a.person === a.av ? "gick med" : `la till ${a.namn}${som}`);

  await notifieraFlera([a.person], {
    av: a.av,
    kalla: "uppgift-med",
    typ: "uppgift",
    rubrik: a.rad.title,
    detalj:
      a.roll === "redigerare"
        ? `${a.avFornamn} la till dig. Uppgiften är din också nu.`
        : a.roll === "granskare"
          ? `${a.avFornamn} satte dig som granskare.`
          : `${a.avFornamn} lät dig följa uppgiften.`,
    href: `/uppgifter/${a.rad.id}`,
    objekt: { typ: "task", id: a.rad.id },
  });

  // B4: den som la upp uppgiften och den som har bollen far veta nar NAGON
  // ANNAN lagger till en person. `notifieraFlera` tar sjalv bort avsandaren.
  await notifieraFlera(
    [a.rad.created_by, a.rad.assignee_id].filter((x): x is string => Boolean(x) && x !== a.person),
    {
      av: a.av,
      kalla: "uppgift-delad",
      typ: "uppgift",
      rubrik: a.rad.title,
      detalj: a.person === a.av ? `${a.avFornamn} gick med i uppgiften.` : `${a.avFornamn} la till ${a.namn}${som}.`,
      href: `/uppgifter/${a.rad.id}`,
      objekt: { typ: "task", id: a.rad.id },
    },
  );

  await db.from("audit_log").insert({ actor_id: a.av, action: "task.member_added", object_type: "task", object_id: a.rad.id });
  return null;
}

/**
 * 0298 (H14): en flytt i en DELAD uppgift far en rad i historiken.
 *
 * Bara delade: i en egen uppgift vet man sjalv att man flyttade den, och en
 * historik full av "flyttade till i morgon" ar brus. I en delad ar raden
 * skillnaden mellan "Simon flyttade den till måndag" och "den är borta".
 */
async function noteraFlytt(
  rad: Rad,
  medlemmar: Medlemsrad[],
  av: string,
  efter: { due_date: string | null; due_time: string | null; priority: number },
): Promise<void> {
  if (!arDelad(rad, medlemmar)) return;
  const vad = andringstext(rad, efter, svensktDatum());
  if (vad) await skrivHandelse(rad.id, "andrad", av, vad);
}

function uppdatera(id: string) {
  revalidatePath("/uppgifter");
  revalidatePath(`/uppgifter/${id}`);
  // 0057. Kalendern ritar samma rader, sa den ska inte kunna visa gardagens
  // plan efter en avbockning. Den star HAR och inte i varje action av samma
  // skal som de tre ovan: en ny handling som glommer raden ar en vy som slutar
  // stamma, och det syns forst nar nagon undrar varfor uppgiften ar kvar.
  revalidatePath("/kalender");
  revalidatePath("/");
}

// =============================================================================
// Skapa
// =============================================================================

/**
 * En ny uppgift, fran snabbraden eller fran det utfallda formularet.
 *
 * SNABBRADEN TOLKAS HAR OCH INTE I WEBBLASAREN. Klienten visar en forhandsbild
 * av vad den tror att raden betyder, men det ar den har tolkningen som sparas —
 * annars hade en gammal flik kunnat posta ett datum som tolken inte langre
 * skulle ha gett, och forhandsbilden hade varit en gissning om nagot annat an
 * det som hander.
 *
 * `#projekt` och `@person` slas upp mot namn. HITTAS DE INTE BLIR DE TITEL
 * IGEN: en uppgift som tyst tappar sitt projekt ar samre an en vars rubrik
 * innehaller ordet, for det andra gar att se och rata.
 */
export async function skapaUppgift(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const user = await kravInloggad();
    const mig = user.employee!.id;
    const db = supabaseAdmin();

    const snabbrad = text(form, "rad");
    const idag = svensktDatum();

    let titel = text(form, "title");
    let due = valfritt(form, "due_date");
    let tid = valfritt(form, "due_time");
    let minuter = valfritt(form, "estimate_minutes");
    let prioritet = Number(text(form, "priority") || "3");
    let projektId = valfritt(form, "project_id");
    let ansvarig = valfritt(form, "assignee_id");
    let rest = "";
    // 0298: kollegorna efter `+` i snabbraden ("Ring Nordic fredag +simon").
    const medTraffar: { id: string; namn: string }[] = [];

    if (snabbrad) {
      // Nav 2.0 skickar utan_dag. En rad utan dag far da ingen deadline, men ett
      // klockslag utan dag ("Mote 14:00") blir i dag och "nagon gang" lamnar
      // rubriken (beställaren 2026-11-11). Gamla snabbraden skickar det inte.
      const tolkad = tolkaSnabbrad(snabbrad, idag, text(form, "utan_dag") === "idag" ? idag : undefined);
      titel = tolkad.titel;
      due = tolkad.due_date;
      tid = tolkad.due_time;
      minuter = tolkad.estimate_minutes ? String(tolkad.estimate_minutes) : null;
      prioritet = tolkad.priority;

      if (tolkad.projekt) {
        const { data } = await db
          .from("project")
          .select("id")
          .is("archived_at", null)
          .ilike("name", tolkad.projekt)
          .maybeSingle();
        if (data) projektId = data.id as string;
        else rest += ` #${tolkad.projekt}`;
      }

      if (tolkad.person) {
        const traff = await slaUppPerson(tolkad.person);
        if (traff) ansvarig = traff;
        else rest += ` @${tolkad.person}`;
      }

      // Ett namn som inte gar att sla upp star kvar i rubriken, precis som ett
      // okant `@` och `#` gor: raden sparas, och det syns vad som inte togs.
      for (const namn of tolkad.med) {
        const traff = await slaUppPerson(namn);
        const person = traff ? await slaUppAnstalld(traff) : null;
        if (traff && person) {
          if (!medTraffar.some((m) => m.id === traff)) medTraffar.push({ id: traff, namn: person.namn });
        } else rest += ` +${namn}`;
      }

      titel = `${titel}${rest}`.trim();
    }

    if (!titel) return { fel: "Skriv vad som ska göras." };
    if (titel.length > 200) return { fel: "Rubriken får vara högst 200 tecken." };
    if (!PRIORITETER.includes(prioritet as Prioritet)) prioritet = 3;

    const foralder = valfritt(form, "parent_id");
    if (foralder) {
      // En deluppgift kraver att man far rora foraldern. Kontrollen ligger har
      // och inte i triggern: databasen vaktar DJUPET, inte vem som skriver.
      const { krets } = await kravKrets(foralder);
      if (!farRedigera(krets)) return { fel: "Du får inte lägga till i den uppgiften." };
    }

    /**
     * 0062: UPPREPNINGEN GRENAR AV HAR, OCH DEN SKRIVER INGEN `task` SJALV.
     *
     * Vagen ar `task_series` → `fodEnSerie()` → riktiga rader, alltsa samma
     * vag som nattjobbet gar. Ett specialfall som skrivit forsta forekomsten
     * for hand och overlatit resten till jobbet hade varit tva satt att fodas,
     * och skillnaden mellan dem hade synts forst i forekomst nummer tva.
     */
    const regel = due ? regelUrFormular(form, due) : null;
    if (regel) {
      if (foralder) return { fel: "En deluppgift kan inte återkomma. Lägg upp rutinen som en egen uppgift." };
      // B7: en kollega ar med en gang, inte i hela rutinen (0062, avsnitt 3).
      if (medTraffar.length > 0) {
        return { fel: "En återkommande uppgift delas en gång i taget. Lägg upp den först och lägg till kollegan i den gång det gäller." };
      }

      const klagomal = granskaRegel(regel);
      if (klagomal) return { fel: klagomal };

      return skapaSerieinternt(db, {
        regel,
        slag: "uppgift",
        mig,
        assignee_id: ansvarig ?? mig,
        title: titel,
        description_md: text(form, "description_md"),
        due_time: tid,
        estimate_minutes: minuter ? Number(minuter) : null,
        priority: prioritet,
        project_id: projektId,
      });
    }

    const { data: skapad, error } = await db
      .from("task")
      .insert({
        title: titel,
        description_md: text(form, "description_md"),
        project_id: foralder ? null : projektId,
        parent_id: foralder,
        // Ingen ansvarig = inkorgen. Den som skriver ner en tanke om sig sjalv
        // far den pa sig; den som inte pekar ut nagon lamnar den oppen.
        assignee_id: ansvarig ?? (form.has("till_inkorgen") ? null : mig),
        created_by: mig,
        starts_on: valfritt(form, "starts_on"),
        due_date: due,
        due_time: due ? tid : null,
        estimate_minutes: minuter ? Number(minuter) : null,
        priority: prioritet,
      })
      .select("id, assignee_id")
      .single();

    if (error || !skapad) return { fel: `Uppgiften sparades inte: ${error?.message ?? "okänt fel"}` };

    await skrivHandelse(skapad.id as string, "skapad", mig);

    // 0298: de som stod efter `+`. Den som fick bollen ar redan inne, och en
    // deluppgift har ingen egen krets (den arvs fran uppgiften den hor till).
    const nya = foralder ? [] : medTraffar.filter((m) => m.id !== (skapad.assignee_id as string | null));
    for (const m of nya) {
      await laggTill({
        rad: { id: skapad.id as string, title: titel, assignee_id: skapad.assignee_id as string | null, created_by: mig },
        person: m.id,
        namn: m.namn,
        roll: "redigerare",
        av: mig,
        avFornamn: user.employee!.first_name,
      });
    }

    uppdatera(skapad.id as string);
    return {
      ok: nya.length > 0 ? `Upplagd. ${nya.map((m) => m.namn.split(" ")[0]).join(" och ")} är med.` : "Upplagd.",
      id: skapad.id as string,
    };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/**
 * Regeln in, ett svar en manniska kan lasa ut.
 *
 * SVARET NAMNER ANTALET, och det ar inte statistik. Den som kryssat i "varje
 * mandag" och far "Upplagd." vet inte om navet forstod att det skulle handa mer
 * an en gang. "Varje måndag · 8 förekomster upplagda" ar kvittot pa att regeln
 * blev en regel, och det ar det enda stallet dar skillnaden syns direkt.
 */
async function skapaSerieinternt(
  db: ReturnType<typeof supabaseAdmin>,
  falt: {
    regel: Parameters<typeof granskaRegel>[0];
    slag: "uppgift" | "coachningsuppgift";
    mig: string;
    assignee_id: string;
    title: string;
    description_md: string;
    due_time: string | null;
    estimate_minutes: number | null;
    priority: number;
    project_id: string | null;
  },
): Promise<UppgiftState> {
  const { regel, mig, ...mall } = falt;

  const { id, fodda } = await skapaSerie(
    db,
    {
      slag: mall.slag,
      monster: regel.monster,
      veckodagar: regel.veckodagar,
      starts_on: regel.starts_on,
      ends_on: regel.ends_on,
      title: mall.title,
      description_md: mall.description_md,
      due_time: mall.due_time,
      estimate_minutes: mall.estimate_minutes,
      assignee_id: mall.assignee_id,
      created_by: mig,
      priority: mall.priority,
      project_id: mall.project_id,
    },
    svensktDatum(),
  );

  /**
   * `uppdatera()` ANVANDS INTE HAR. Den revaliderar `/uppgifter/<id>`, och id:t
   * harinne ar SERIENS och inte en uppgifts — vagen finns inte. Listorna ar
   * anda det som andrats: en serie foder mellan noll och femtiosju rader, och
   * ingen av dem har en sida som redan var oppen.
   */
  revalidatePath("/uppgifter");
  revalidatePath("/kalender");
  revalidatePath("/");

  return {
    id,
    ok: `${serietext(regel)} · ${fodda} ${fodda === 1 ? "förekomst" : "förekomster"} upplagda.`,
  };
}

/**
 * `@Anna` till ett employee-id.
 *
 * Exakt fornamn forst, sedan hela namnet. EN ENTYDIG TRAFF KRAVS: finns det tva
 * Anna i huset ar det ratt att lamna ordet i rubriken och lata anvandaren peka
 * ut vem hon menade. Att valja den forsta hade lagt nagon annans uppgift pa fel
 * person, och det upptacks forst nar den blivit forsenad.
 */
async function slaUppPerson(namn: string): Promise<string | null> {
  const db = supabaseAdmin();
  const rent = namn.replace(/_/g, " ");

  const { data } = await db
    .from("employee")
    .select("id, first_name, last_name")
    .neq("status", "offboarded")
    .limit(50);

  const alla = (data ?? []) as { id: string; first_name: string; last_name: string }[];
  const lika = (a: string, b: string) => a.toLocaleLowerCase("sv") === b.toLocaleLowerCase("sv");

  const heltNamn = alla.filter((p) => lika(`${p.first_name} ${p.last_name}`, rent));
  if (heltNamn.length === 1) return heltNamn[0].id;

  const fornamn = alla.filter((p) => lika(p.first_name, rent));
  return fornamn.length === 1 ? fornamn[0].id : null;
}

// =============================================================================
// Ändra
// =============================================================================

/**
 * 0062: `serie_omfattning` avgor vem andringen galler.
 *
 * "bara" ar grundlaget och det enda svaret for en uppgift utan serie. "serie"
 * skriver om mallen och alla ofodda och framtida forekomster med — se
 * `andraHelaSerien()` langre ner.
 */
export async function andraUppgift(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const id = text(form, "id");
    const { krets, rad, medlemmar } = await kravKrets(id);
    if (!farRedigera(krets)) return { fel: "Du får inte ändra den här uppgiften." };

    const titel = text(form, "title");
    if (!titel) return { fel: "Rubriken kan inte vara tom." };

    /**
     * 0298 (H15): JAMFOR OCH BYT for de tva fritextfalten.
     *
     * Tva som har samma ruta oppen skrev over varandra, och den som sparade
     * sist vann utan att nagon marktes. Klienten skickar texten den UTGICK
     * fran; har databasen en annan nu har nagon annan hunnit emellan, och da
     * vagrar vi i stallet for att kasta deras text. `updated_at` duger inte
     * som marke: varje handelse flyttar den, ocksa en kommentar.
     *
     * Skickas ingen bas (gamla Nav) galler det gamla beteendet.
     */
    for (const [falt, nu, nytt] of [
      ["title", rad.title, titel],
      ["description_md", rad.description_md ?? "", text(form, "description_md")],
    ] as const) {
      if (!form.has(`bas_${falt}`)) continue;
      if (text(form, `bas_${falt}`) !== nu.trim() && nytt !== nu.trim()) {
        return {
          fel: falt === "title" ? "Någon annan ändrade rubriken nyss. Läs den nya innan du sparar din." : "Någon annan ändrade beskrivningen nyss. Läs den nya innan du sparar din.",
          konflikt: { falt, nu },
        };
      }
    }

    const due = valfritt(form, "due_date");
    const prioritet = Number(text(form, "priority") || "3");

    const db = supabaseAdmin();

    /**
     * SERIETILLHORIGHETEN LASES UR RADEN, ALDRIG UR FORMULARET.
     *
     * Samma linje som utkopet pa ordern (0060): ett `series_id` i ett formular
     * ar en plats att skriva om NAGON ANNANS serie ifran. Kretsen provades mot
     * uppgiften, inte mot regeln.
     */
    const { data: serierad } = await db
      .from("task")
      .select("series_id, series_on")
      .eq("id", id)
      .maybeSingle();

    const serieId = (serierad as { series_id: string | null } | null)?.series_id ?? null;
    const helaSerien = serieId !== null && text(form, "serie_omfattning") === "serie";

    const { error } = await db
      .from("task")
      .update({
        title: titel,
        description_md: text(form, "description_md"),
        due_date: due,
        // Klockslaget faller med datumet. `task_tid_kraver_datum` i 0054 hade
        // annars avvisat hela uppdateringen med ett villkorsnamn i felrutan.
        due_time: due ? valfritt(form, "due_time") : null,
        starts_on: valfritt(form, "starts_on"),
        estimate_minutes: text(form, "estimate_minutes") ? Number(text(form, "estimate_minutes")) : null,
        priority: PRIORITETER.includes(prioritet as Prioritet) ? prioritet : 3,
        project_id: valfritt(form, "project_id"),
        /**
         * "BARA DEN HAR" LOSGOR FOREKOMSTEN.
         *
         * Utan raden hade nasta serieandring skrivit tillbaka det anvandaren
         * just andrade, och hon hade inte fatt veta det — raden bara ser ut som
         * den gjorde forut nasta gang hon tittar. Flaggan ar alltsa inte
         * bokforing utan hela skillnaden mellan de tva svaren pa fragan.
         *
         * Den satts BARA i den har grenen. En serieandring ska inte losgora
         * raderna den skriver; da hade nasta serieandring inte natt nagon.
         */
        ...(serieId && !helaSerien ? { series_losgjord: true } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) return { fel: `Ändringen sparades inte: ${error.message}` };

    await noteraFlytt(rad, medlemmar, krets.mig, {
      due_date: due,
      due_time: due ? valfritt(form, "due_time") : null,
      priority: PRIORITETER.includes(prioritet as Prioritet) ? prioritet : 3,
    });

    if (helaSerien) {
      const svar = await andraHelaSerien(serieId!, form, {
        title: titel,
        description_md: text(form, "description_md"),
        due_time: due ? valfritt(form, "due_time") : null,
        estimate_minutes: text(form, "estimate_minutes") ? Number(text(form, "estimate_minutes")) : null,
        priority: PRIORITETER.includes(prioritet as Prioritet) ? prioritet : 3,
        project_id: valfritt(form, "project_id"),
      });
      if (svar.fel) return svar;

      uppdatera(id);
      return { ok: svar.ok };
    }

    uppdatera(id);
    return { ok: serieId ? "Sparat — bara den här förekomsten." : "Sparat." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/**
 * "HELA SERIEN": mallen skrivs om, och de framtida forekomsterna med den.
 *
 * =============================================================================
 * TRE URVAL, OCH VART OCH ETT HALLER NAGOT UTANFOR MED FLIT
 *
 *   FRAMTIDEN, INTE DET SOM VARIT. En rutin som byter rubrik i oktober har inte
 *   alltid hetat sa. Skrevs historiken om skulle septembers bockade rader saga
 *   att man gjort nagot man aldrig gjorde, och det ar en forfalskning aven nar
 *   den ar valmenande. Granen gar vid `due_date >= idag`.
 *
 *   INTE DE LOSGJORDA. Den som flyttat EN mandag till klockan tio har fattat
 *   ett beslut om just den, och ett serieklick ska inte tysta det.
 *
 *   INTE DE STANGDA. En bockad forekomst ar ett kvitto pa nagot som ar gjort.
 *   Urvalet gors i SQL pa `due_date` och i koden pa laget — `lageAv()` raknas
 *   fram ur handelserna och gar inte att fraga om i en `update`.
 *
 * DATUMET FOLJER INTE MED, och det ar den viktigaste raden i hela funktionen.
 * `due_date` ar VILKEN FOREKOMST raden ar; skrevs den over hade alla femtiotva
 * mandagar hamnat pa samma dag. Mallen bar klockslaget, inte dagen.
 * =============================================================================
 */
async function andraHelaSerien(
  serieId: string,
  form: FormData,
  mall: {
    title: string;
    description_md: string;
    due_time: string | null;
    estimate_minutes: number | null;
    priority: number;
    project_id: string | null;
  },
): Promise<UppgiftState> {
  const db = supabaseAdmin();
  const idag = svensktDatum();

  const { data: serie } = await db
    .from("task_series")
    .select("id, assignee_id, created_by, ended_at")
    .eq("id", serieId)
    .maybeSingle();

  if (!serie) return { fel: "Serien finns inte." };

  const { user } = await kravKrets(text(form, "id"));
  const mig = user.employee!.id;

  /**
   * REGELN AGS AV TVA PERSONER, precis som `task_series_read` i 0062 sager. Den
   * som bjudits in i EN forekomst far redigera den forekomsten — hon har
   * ingenting att gora med att andra alla framtida mandagar.
   */
  const s = serie as { assignee_id: string; created_by: string; ended_at: string | null };
  if (s.assignee_id !== mig && s.created_by !== mig) {
    return { fel: "Bara den som äger rutinen kan ändra hela serien." };
  }
  if (s.ended_at) return { fel: "Serien är avslutad. Ändringen gäller bara den här förekomsten." };

  const { error: serieFel } = await db
    .from("task_series")
    .update({ ...mall, updated_at: new Date().toISOString() })
    .eq("id", serieId);

  if (serieFel) return { fel: `Serien sparades inte: ${serieFel.message}` };

  // Kandidaterna: framtida, inte losgjorda. Laget sallas efter, i koden.
  const { data: kandidater } = await db
    .from("task")
    .select("id")
    .eq("series_id", serieId)
    .eq("series_losgjord", false)
    .gte("due_date", idag);

  const ids = ((kandidater ?? []) as { id: string }[]).map((r) => r.id);
  if (ids.length === 0) return { ok: "Serien är ändrad." };

  const { data: handelser } = await db
    .from("task_event")
    .select("task_id, type")
    .in("task_id", ids)
    .order("at");

  const per = new Map<string, { type: Handelsetyp }[]>();
  for (const h of (handelser ?? []) as { task_id: string; type: Handelsetyp }[]) {
    const lista = per.get(h.task_id);
    if (lista) lista.push(h);
    else per.set(h.task_id, [h]);
  }

  const oppna = ids.filter((id) => !arStangd(lageAv(per.get(id) ?? [])));
  if (oppna.length === 0) return { ok: "Serien är ändrad." };

  const { error: radFel } = await db
    .from("task")
    .update({ ...mall, updated_at: new Date().toISOString() })
    .in("id", oppna);

  if (radFel) return { fel: `Förekomsterna sparades inte: ${radFel.message}` };

  return {
    ok:
      oppna.length === 1
        ? "Serien och den kommande förekomsten är ändrade."
        : `Serien och ${oppna.length} kommande förekomster är ändrade.`,
  };
}

/**
 * Avsluta en rutin.
 *
 * =============================================================================
 * DET SOM VARIT STAR KVAR. DET SOM ALDRIG HANDE FORSVINNER.
 *
 * Serien slutar foda, och de framtida forekomster som ANNU INTE RORTS tas bort.
 * Bada halvorna av den meningen ar val:
 *
 *   ATT LATA DEM STA hade varit det forsiktiga valet och fel. Den som avslutar
 *   en rutin i september har sju veckors mandagar liggande i kalendern, och de
 *   ar inte langre nagot hon tanker gora. En kalender som visar sju mandagar
 *   ingen ska gora ar en kalender man slutar lita pa.
 *
 *   ATT RADERA ALLT hade varit varre. Gjorda forekomster ar historik —
 *   bockade, godkanda, kommenterade av manniskor — och de raderas aldrig av att
 *   nagon stanger av framtiden.
 *
 * Gransen gar vid `due_date > idag` OCH att ingenting hant utover `skapad`.
 * DAGENS FOREKOMST STAR ALLTSA KVAR, aven om den ar orord: den som stanger av
 * mandagsrutinen pa en mandag har antagligen redan planerat dagen efter den.
 *
 * REGELRADEN RADERAS INTE. `ended_at` satts i stallet, sa att de gjorda
 * raderna fortfarande kan svara pa varfor de lades upp. Se 0062.
 * =============================================================================
 */
export async function avslutaSerie(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const user = await kravInloggad();
    const mig = user.employee!.id;
    const db = supabaseAdmin();

    // Id:t tas ur UPPGIFTEN och inte ur formularet, av samma skal som
    // `andraUppgift` ovan: kretsen provas mot en rad, och raden bar serien.
    const uppgiftId = text(form, "id");
    const { krets } = await kravKrets(uppgiftId);
    if (!farRedigera(krets)) return { fel: "Du får inte ändra den här uppgiften." };

    const { data: rad } = await db
      .from("task")
      .select("series_id")
      .eq("id", uppgiftId)
      .maybeSingle();

    const serieId = (rad as { series_id: string | null } | null)?.series_id ?? null;
    if (!serieId) return { fel: "Uppgiften hör inte till någon serie." };

    const { data: serie } = await db
      .from("task_series")
      .select("id, assignee_id, created_by, ended_at")
      .eq("id", serieId)
      .maybeSingle();

    const s = serie as { assignee_id: string; created_by: string; ended_at: string | null } | null;
    if (!s) return { fel: "Serien finns inte." };
    if (s.assignee_id !== mig && s.created_by !== mig) {
      return { fel: "Bara den som äger rutinen kan avsluta den." };
    }
    if (s.ended_at) return { ok: "Serien är redan avslutad." };

    const { error } = await db
      .from("task_series")
      .update({ ended_at: new Date().toISOString(), ended_by: mig, updated_at: new Date().toISOString() })
      .eq("id", serieId);

    if (error) return { fel: `Serien avslutades inte: ${error.message}` };

    // Forekomsten man avslutade fran star kvar, ocksa nar den ligger framat (Nav 2.0 lovar "Den har star kvar").
    const bortplockade = await taBortOrordFramtid(serieId, uppgiftId);

    uppdatera(uppgiftId);
    return {
      ok:
        bortplockade === 0
          ? "Rutinen är avslutad. Inga kommande förekomster fanns."
          : `Rutinen är avslutad och ${bortplockade} orörda förekomster är borttagna.`,
    };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/**
 * Framtida forekomster som ingen rort. Returnerar antalet borttagna.
 *
 * "ORORD" BETYDER EXAKT EN HANDELSE, OCH DEN SKA VARA `skapad`. En uppgift som
 * nagon paborjat, kommenterat, bockat eller tilldelat nagon annan ar inte
 * langre en rad ett jobb skrev — da finns det en manniska i historiken, och det
 * som en manniska rort raderas inte av att en regel stangs av.
 *
 * `behall` ar forekomsten man avslutade serien fran. Den star kvar aven om den
 * ligger framat och ar orord: man star i den, och kvittot sager att den blir kvar.
 */
async function taBortOrordFramtid(serieId: string, behall?: string): Promise<number> {
  const db = supabaseAdmin();
  const idag = svensktDatum();

  const { data: kandidater } = await db
    .from("task")
    .select("id")
    .eq("series_id", serieId)
    .eq("series_losgjord", false)
    .gt("due_date", idag);

  const ids = ((kandidater ?? []) as { id: string }[]).map((r) => r.id).filter((id) => id !== behall);
  if (ids.length === 0) return 0;

  const { data: handelser } = await db
    .from("task_event")
    .select("task_id, type")
    .in("task_id", ids);

  const antal = new Map<string, { flera: boolean; annat: boolean }>();
  for (const h of (handelser ?? []) as { task_id: string; type: string }[]) {
    const f = antal.get(h.task_id) ?? { flera: false, annat: false };
    if (antal.has(h.task_id)) f.flera = true;
    if (h.type !== "skapad") f.annat = true;
    antal.set(h.task_id, f);
  }

  const ororda = ids.filter((id) => {
    const f = antal.get(id);
    return !f || (!f.flera && !f.annat);
  });

  if (ororda.length === 0) return 0;

  /**
   * HANDELSERNA FORST. `task_event.task_id` har `on delete cascade` i 0054, sa
   * ordningen spelar ingen roll for databasen — men den gor det for den som
   * laser: raderingen ska se ut som den ar, alltsa att bada forsvinner.
   */
  await db.from("task_event").delete().in("task_id", ororda);
  const { error } = await db.from("task").delete().in("id", ororda);
  if (error) throw new Error(`förekomsterna kunde inte tas bort: ${error.message}`);

  return ororda.length;
}

/**
 * Byta ansvarig.
 *
 * EGEN ACTION OCH INTE ETT FALT I `andraUppgift`, for den skriver bade en
 * handelse och en notis. En omtilldelning som gomdes i en vanlig sparning hade
 * betytt att nagon fick en uppgift utan att fa veta det — och den harledda
 * "ny uppgift"-posten star bara nagra dygn efter att raden skapades.
 */
export async function tilldela(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const id = text(form, "id");
    const { rad, krets, user, medlemmar, arbetar } = await kravKrets(id);

    const till = valfritt(form, "assignee_id");
    if (till === rad.assignee_id) return { ok: "Oförändrad." };

    const mottagare = till ? await slaUppAnstalld(till) : null;
    if (till && !mottagare) return { fel: "Personen finns inte." };

    /**
     * 0298: HELA BESLUTET STAR I `provaLamnaOver()` (lib/uppgifter.ts).
     *
     * Inom kretsen ar det en passning och kraver bara att man arbetar i
     * uppgiften. Till nagon utanfor ar det att lagga till en person och ge hen
     * bollen, och da galler samma sparrar som nar nagon laggs till: den som
     * slutat, den dolda personkopplingen (H13) och granskaren.
     */
    const fel = provaLamnaOver({
      krets,
      till,
      iKretsen: till !== null && arbetar.includes(till),
      befintligRoll: medlemmar.find((m) => m.employee_id === till)?.role ?? null,
      slutat: mottagare?.slutat ?? false,
      doldKoppling: till ? await doldKopplingTill(id, till) : false,
    });
    if (fel) return { fel };

    /**
     * B5: INGEN TAPPAR EN UPPGIFT AV ATT NAGON ANNAN FLYTTAR DEN.
     *
     * Den som sjalv har bollen och lamnar over valjer om hen vill vara kvar
     * (`stanna`). Flyttar nagon annan bollen blir den som hade den alltid kvar
     * som med. Fore 0298 forsvann hen ur kretsen utan besked om hen inte ocksa
     * hade lagt upp uppgiften (H8).
     */
    const jagHade = rad.assignee_id === krets.mig;
    // "Ta tillbaka": den som la upp uppgiften (eller annars får ta bort folk)
    // släpper den som hade den, som före 0298. Ingen annan kan släppa någon.
    const slapper = !jagHade && text(form, "slapp") === "ja" && farStyra(krets);
    const stanna = jagHade ? text(form, "stanna") === "ja" : !slapper;
    const delad = arDelad(rad, medlemmar);

    const { error } = await supabaseAdmin().rpc("uppgift_passa", {
      p_task: id,
      p_till: till,
      p_av: krets.mig,
      p_stanna: stanna,
      p_note: till === null ? "la den i inkorgen" : till === krets.mig ? "tog bollen" : `passade till ${mottagare!.namn}`,
    });

    if (error) return { fel: `Gick inte att lämna över: ${error.message}` };

    const fornamn = user.employee!.first_name;

    if (till) {
      await notifiera({
        till,
        av: krets.mig,
        kalla: "uppgift-tilldelad",
        typ: "uppgift",
        rubrik: rad.title,
        detalj: delad || stanna ? `${fornamn} passade bollen till dig` : `${fornamn} la uppgiften på dig`,
        href: `/uppgifter/${id}`,
        objekt: { typ: "task", id },
      });
    }

    // Den som hade bollen och inte sjalv flyttade den far veta vart den tog vagen.
    if (rad.assignee_id && !jagHade && rad.assignee_id !== till) {
      await notifieraFlera([rad.assignee_id], {
        av: krets.mig,
        kalla: "uppgift-delad",
        typ: "uppgift",
        rubrik: rad.title,
        detalj: slapper
          ? `${fornamn} tog tillbaka uppgiften.`
          : till
            ? `${fornamn} gav bollen till ${till === krets.mig ? "sig själv" : mottagare!.namn}. Du är kvar i uppgiften.`
            : `${fornamn} la uppgiften i inkorgen. Du är kvar i den.`,
        // Den som släppts ser inte uppgiften längre: länken går till listan.
        href: slapper ? "/uppgifter" : `/uppgifter/${id}`,
        objekt: { typ: "task", id },
      });
    }

    uppdatera(id);
    return {
      ok: !till
        ? "Lagd i inkorgen."
        : till === krets.mig
          ? "Du har bollen."
          : jagHade && !stanna
            ? "Tilldelad."
            : `${mottagare!.namn.split(" ")[0]} har bollen.${jagHade ? " Du är kvar i uppgiften." : ""}`,
    };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/**
 * Datum, klockslag och tidsatgang i ett svep.
 *
 * =============================================================================
 * DEN HAR SKRIVER HELA PLANERINGEN. ETT FALT SOM INTE KOMMER MED AR "TA BORT".
 *
 * Det ar inte en bugg utan formen: planeringen ar TRE falt som hanger ihop, och
 * ett anrop som bara satte det man skickat hade gjort det omojligt att TA BORT
 * ett klockslag — "tomt" och "inte med" hade betytt samma sak.
 *
 * Priset ar att varje anropare maste bara med de andra tva. Det har kostat en
 * bugg per yta som byggts sedan dess:
 *
 *   - 2026-09-11: snabbknapparna "Idag"/"I morgon" i listan och i
 *     egenskapspanelen raderade tyst en tidsuppskattning nagon gjort.
 *   - 2026-09-14: kalendern drar uppgifter till klockslag, och varje drag ar
 *     ett anrop hit. `planeraTill()` i Planeringsvy.tsx bygger darfor alltid
 *     alla tre faltan ur postens NUVARANDE varden och andrar ett av dem.
 *
 * LAGG TILL EN NY KNAPP SOM Ror DATUM? Skicka `due_date`, `due_time` OCH
 * `estimate_minutes`. Alla tre, varje gang.
 *
 * =============================================================================
 * BEHORIGHETEN AR SNAVARE AN `andraUppgift` OCH BREDARE AN INGEN
 *
 * `farPlanera()` och inte `farRedigera()`: 0057 gav kalendern fem delningsnivaer,
 * och nivan "kan planera om" ger exakt det har anropet och inget mer. Den som
 * far stada i en overbokad dag ska inte darmed kunna skriva om rubriken pa
 * nagon annans anteckning.
 * =============================================================================
 */
export async function planera(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const id = text(form, "id");
    const { krets, kalenderniva, rad, medlemmar } = await kravKrets(id);
    if (!farPlanera(krets, farPlaneraOm(kalenderniva))) {
      return { fel: "Du får inte planera om den här uppgiften." };
    }

    const due = valfritt(form, "due_date");
    const minuter = text(form, "estimate_minutes");

    const { error } = await supabaseAdmin()
      .from("task")
      .update({
        due_date: due,
        due_time: due ? valfritt(form, "due_time") : null,
        estimate_minutes: minuter ? Number(minuter) : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) return { fel: `Gick inte att planera: ${error.message}` };

    await noteraFlytt(rad, medlemmar, krets.mig, {
      due_date: due,
      due_time: due ? valfritt(form, "due_time") : null,
      priority: rad.priority,
    });

    uppdatera(id);
    return { ok: due ? "Planerad." : "Datumet togs bort." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

// =============================================================================
// Driva framåt
// =============================================================================

export async function paborja(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const id = text(form, "id");
    const { krets } = await kravKrets(id);
    if (!farArbeta(krets)) return { fel: "Du får inte arbeta med den här uppgiften." };

    await skrivHandelse(id, "paborjad", krets.mig);
    uppdatera(id);
    return { ok: "Igång." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/**
 * Bocken.
 *
 * EN KNAPP OCH TVA UTFALL, och det ar hela poangen med granskarrollen. Finns en
 * granskare blir bocken en INLAMNING och uppgiften vantar; finns ingen ar den
 * klar direkt. Tva knappar hade tvingat den som bockar att veta vilket som
 * gallde — och det ar uppgiftens sak att veta, inte hennes.
 */
export async function bocka(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const id = text(form, "id");
    const { rad, krets, granskare, medlemmar, user } = await kravKrets(id);
    if (!farArbeta(krets)) return { fel: "Du får inte bocka av den här uppgiften." };

    // FORST TILL KVARN. Den som bockar och sjalv ar granskare har godkant i
    // samma rorelse — att lamna in till sig sjalv vore en omvag utan innehall.
    const gransk = granskare.filter((g) => g !== krets.mig);
    const typ: Handelsetyp = gransk.length > 0 ? "inlamnad" : granskare.includes(krets.mig) ? "godkand" : "klar";

    // 0298 (H15): laget lases och handelsen skrivs i ETT steg. Tva som bockar
    // samtidigt i en delad uppgift ger en `klar`, och den andra far svaret.
    const stopp = await skrivVillkorad(id, typ, krets.mig, valfritt(form, "note"), ["klar", "godkand", "inlamnad"]);
    if (stopp === "inlamnad") return { fel: "Den ligger redan hos granskaren." };
    if (stopp) return { ok: "Redan klar." };

    /**
     * 0298 (H4): DE ANDRA SOM HAR UPPGIFTEN FAR VETA ATT DEN AR BOCKAD.
     *
     * Fore bygget forsvann raden tyst ur kollegans lista. Det har ar en
     * handelse som skriver over tillstandet den kom ur (uppgiften star inte
     * langre som oppen), alltsa en riktig handelsekalla enligt regeln i
     * notiser.ts — samma skal som `uppgift-godkand` har.
     *
     * INTE FOR ETT STEG. En deluppgift som bockas syns i uppgiften, och ett
     * besked per steg hade gjort det dyrt att arbeta ihop.
     */
    if (!rad.parent_id) {
      await notifieraFlera(harDenSomSin(rad, medlemmar), {
        av: krets.mig,
        kalla: "uppgift-delad",
        typ: "uppgift",
        rubrik: rad.title,
        detalj:
          typ === "inlamnad"
            ? `${user.employee!.first_name} lämnade in den för godkännande.`
            : `${user.employee!.first_name} bockade av den.`,
        href: `/uppgifter/${id}`,
        objekt: { typ: "task", id },
      });
    }

    uppdatera(id);
    return { ok: typ === "inlamnad" ? "Inlämnad för godkännande." : "Klar." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

export async function godkann(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const id = text(form, "id");
    const { rad, krets, user } = await kravKrets(id);
    if (!farGranska(krets)) return { fel: "Bara en utpekad granskare kan godkänna." };

    const lage = await nuvarandeLage(id);
    if (lage !== "granskas") return { fel: "Uppgiften väntar inte på ett godkännande." };

    await skrivHandelse(id, "godkand", krets.mig, valfritt(form, "note"));

    /**
     * HANDELSE OCH INTE HARLEDNING — det tydligaste fallet i hela navet.
     *
     * En godkand uppgift ar bara `klar`, omojlig att skilja fran en som den
     * ansvariga bockade av sjalv. Utan den har raden fick den som lamnade in
     * aldrig veta hur det gick, vilket ar precis det 0047 byggdes for.
     */
    if (rad.assignee_id) {
      await notifiera({
        till: rad.assignee_id,
        av: krets.mig,
        kalla: "uppgift-godkand",
        typ: "uppgift",
        rubrik: `Godkänd: ${rad.title}`,
        detalj: `${user.employee!.first_name} godkände`,
        href: `/uppgifter/${id}`,
        objekt: { typ: "task", id },
      });
    }

    uppdatera(id);
    return { ok: "Godkänd." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/**
 * Returnera med skal.
 *
 * Skalet ar obligatoriskt bade har och i databasen
 * (`task_event_retur_kraver_skal` i 0054). Tva stallen med flit: villkoret
 * gor raden omojlig, meddelandet harinne gor den begriplig.
 *
 * Ingen notis. `uppgift-returnerad` ar HARLEDD ur laget — se notiser.ts.
 */
export async function returnera(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const id = text(form, "id");
    const { krets } = await kravKrets(id);
    if (!farGranska(krets)) return { fel: "Bara en utpekad granskare kan returnera." };

    const skal = text(form, "note");
    if (!skal) return { fel: "Skriv varför den skickas tillbaka." };

    const lage = await nuvarandeLage(id);
    if (lage !== "granskas") return { fel: "Uppgiften väntar inte på ett godkännande." };

    await skrivHandelse(id, "returnerad", krets.mig, skal);

    uppdatera(id);
    return { ok: "Returnerad." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

export async function ateroppna(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const id = text(form, "id");
    const { rad, krets, medlemmar, user } = await kravKrets(id);
    if (!farArbeta(krets)) return { fel: "Du får inte öppna den här uppgiften igen." };

    // 0298: samma ett-stegs-skrivning som bocken. Tva som angrar samtidigt ger en rad.
    const stopp = await skrivVillkorad(id, "ateroppnad", krets.mig, valfritt(form, "note"), [
      "skapad",
      "paborjad",
      "returnerad",
      "ateroppnad",
    ]);
    if (stopp) return { ok: "Redan öppen." };

    if (!rad.parent_id) {
      await notifieraFlera(harDenSomSin(rad, medlemmar), {
        av: krets.mig,
        kalla: "uppgift-delad",
        typ: "uppgift",
        rubrik: rad.title,
        detalj: `${user.employee!.first_name} öppnade den igen.`,
        href: `/uppgifter/${id}`,
        objekt: { typ: "task", id },
      });
    }

    uppdatera(id);
    return { ok: "Öppen igen." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

export async function avbryt(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const id = text(form, "id");
    const { rad, krets, user, medlemmar } = await kravKrets(id);
    // 0298: `farStyra` ar det `farBjudaIn` betydde fore B4. Den som ar med far lagga till, inte stryka.
    // Ett STEG får alla som arbetar i uppgiften ta bort (regeltabellen): steget
    // är en rad i det de gör ihop, inte en egen uppgift med en egen ägare.
    if (!(farStyra(krets) || (rad.parent_id !== null && farRedigera(krets)))) {
      return { fel: "Bara den som la upp uppgiften eller har bollen kan stryka den." };
    }

    const skal = text(form, "note");
    if (!skal) return { fel: "Skriv varför den inte ska göras." };

    await skrivHandelse(id, "avbruten", krets.mig, skal);

    // 0298: alla som har uppgiften som sin, inte bara den som har bollen.
    const berorda = harDenSomSin(rad, medlemmar);
    if (berorda.length > 0) {
      await notifieraFlera(berorda, {
        av: krets.mig,
        kalla: "uppgift-avbruten",
        typ: "uppgift",
        rubrik: `Avbruten: ${rad.title}`,
        detalj: `${user.employee!.first_name}: ${skal}`,
        href: `/uppgifter/${id}`,
        objekt: { typ: "task", id },
      });
    }

    uppdatera(id);
    return { ok: "Avbruten." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

export async function kommentera(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const id = text(form, "id");
    const { rad, krets, user } = await kravKrets(id);

    // ALLA I KRETSEN FAR KOMMENTERA, aven en visare. Det ar hela skillnaden
    // mellan att bjuda in nagon och att skicka en skarmbild — den som bara ska
    // se maste kunna svara, annars flyttar samtalet till chatten igen.
    const skal = text(form, "note");
    if (!skal) return { fel: "Skriv något först." };

    await skrivHandelse(id, "kommentar", krets.mig, skal);

    const { data: medlemmar } = await supabaseAdmin()
      .from("task_member")
      .select("employee_id")
      .eq("task_id", id);

    const kretsIds = [
      rad.assignee_id,
      rad.created_by,
      ...(medlemmar ?? []).map((m) => m.employee_id as string),
    ].filter((x): x is string => Boolean(x));

    await notifieraFlera(kretsIds, {
      av: krets.mig,
      kalla: "uppgift-kommentar",
      typ: "uppgift",
      rubrik: rad.title,
      detalj: `${user.employee!.first_name}: ${skal.slice(0, 120)}`,
      href: `/uppgifter/${id}`,
      objekt: { typ: "task", id },
    });

    uppdatera(id);
    return { ok: "Skickat." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

// =============================================================================
// Kretsen
// =============================================================================

export async function bjudIn(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const id = text(form, "id");
    const { rad, krets, medlemmar, user } = await kravKrets(id);

    const person = text(form, "employee_id");
    const roll = (text(form, "role") || "redigerare") as Medlemsroll;

    const anstalld = person ? await slaUppAnstalld(person) : null;
    if (person && !anstalld) return { fel: "Personen finns inte." };

    // Hela beslutet — vem som far, vem som redan ar inne, den som slutat, den
    // dolda personkopplingen (H13), granskaren — star i lib/uppgifter.ts och
    // provas dar. Se ocksa kommentaren over `farBjudaIn()` om beslutet B4.
    const fel = provaLaggaTill({
      krets,
      person,
      roll,
      befintligRoll: medlemmar.find((m) => m.employee_id === person)?.role ?? null,
      slutat: anstalld?.slutat ?? false,
      doldKoppling: person ? await doldKopplingTill(id, person) : false,
    });
    if (fel) return { fel };

    const lagtTill = await laggTill({
      rad,
      person,
      namn: anstalld!.namn,
      roll,
      av: krets.mig,
      avFornamn: user.employee!.first_name,
    });
    if (lagtTill) return { fel: lagtTill };

    uppdatera(id);
    const fornamn = anstalld!.namn.split(" ")[0];
    return {
      ok:
        person === krets.mig
          ? "Du är med. Uppgiften står bland dina egna."
          : roll === "redigerare"
          ? `${fornamn} är med. Hen får en notis.`
          : roll === "granskare"
            ? `${fornamn} är granskare.`
            : `${fornamn} kan se uppgiften.`,
    };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

export async function taBortMedlem(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const id = text(form, "id");
    const { krets, medlemmar } = await kravKrets(id);
    // 0298: att ta bort NAGON ANNAN ligger kvar hos den som la upp uppgiften
    // och den som har bollen. Den som vill ga sjalv anvander `lamnaUppgift()`.
    if (!farStyra(krets)) return { fel: "Bara den som la upp uppgiften eller har bollen kan ta bort någon." };

    const person = text(form, "employee_id");
    if (!person) return { fel: "Vem?" };

    const rad = medlemmar.find((m) => m.employee_id === person);
    if (!rad) return { ok: "Personen är inte med." };

    const { error } = await supabaseAdmin().from("task_member").delete().eq("task_id", id).eq("employee_id", person);
    if (error) return { fel: `Gick inte att ta bort: ${error.message}` };

    const anstalld = await slaUppAnstalld(person);
    await skrivHandelse(id, "krets", krets.mig, `tog bort ${anstalld?.namn ?? "en person"}`);
    if (rad.role === "granskare") {
      await slappUrGranskning(id, krets.mig, medlemmar.filter((m) => m.role === "granskare" && m.employee_id !== person).length);
    }
    await supabaseAdmin().from("audit_log").insert({ actor_id: krets.mig, action: "task.member_removed", object_type: "task", object_id: id });

    uppdatera(id);
    return { ok: `${anstalld?.namn.split(" ")[0] ?? "Personen"} är borttagen.` };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/**
 * 0298 (H2): LAMNA UPPGIFTEN SJALV.
 *
 * "Sluta följa" i Nav 2.0 anropade `taBortMedlem()`, som kravde `farBjudaIn()`.
 * Den som ar inbjuden var per definition varken skapare eller ansvarig, sa
 * knappen kunde aldrig lyckas. Den har vagen har ett enda argument — uppgiften
 * — och tar alltid bort DEN INLOGGADES rad, aldrig nagon annans.
 */
export async function lamnaUppgift(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const id = text(form, "id");
    const { rad, krets, medlemmar, user } = await kravKrets(id);

    if (krets.minRoll === null) return { fel: "Du är inte tillagd i den här uppgiften." };
    if (!farLamna(krets)) return { fel: "Du har bollen. Passa den till någon annan först." };

    const { error } = await supabaseAdmin().from("task_member").delete().eq("task_id", id).eq("employee_id", krets.mig);
    if (error) return { fel: `Gick inte att lämna: ${error.message}` };

    await skrivHandelse(id, "krets", krets.mig, "lämnade uppgiften");
    if (krets.minRoll === "granskare") {
      await slappUrGranskning(id, krets.mig, medlemmar.filter((m) => m.role === "granskare" && m.employee_id !== krets.mig).length);
    }

    // De tva som svarar for uppgiften far veta att en hand forsvann.
    if (krets.minRoll !== "visare") {
      await notifieraFlera([rad.created_by, rad.assignee_id].filter((x): x is string => Boolean(x)), {
        av: krets.mig,
        kalla: "uppgift-delad",
        typ: "uppgift",
        rubrik: rad.title,
        detalj: `${user.employee!.first_name} lämnade uppgiften.`,
        href: `/uppgifter/${id}`,
        objekt: { typ: "task", id },
      });
    }
    await supabaseAdmin().from("audit_log").insert({ actor_id: krets.mig, action: "task.member_left", object_type: "task", object_id: id });

    uppdatera(id);
    return { ok: krets.minRoll === "redigerare" ? "Du är inte med i uppgiften längre." : "Du följer inte uppgiften längre." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/**
 * 0298 (H7): FORSTA STEGET, for alla som arbetar i uppgiften.
 *
 * Fore bygget skrev rutten faltet sjalv och slappte bara in den som la upp
 * uppgiften och den ansvariga. Kollegan fick 403 pa det enda falt som handlar
 * om hur man kommer igang.
 */
export async function sattForstaSteg(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const id = text(form, "id");
    const { krets } = await kravKrets(id);
    if (!farRedigera(krets)) return { fel: "Bara de som arbetar i uppgiften ändrar Börja med." };

    const steg = text(form, "text").slice(0, 200);
    const { error } = await supabaseAdmin()
      .from("task")
      .update({ next_step: steg || null, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return { fel: `Börja med sparades inte: ${error.message}` };

    uppdatera(id);
    return { ok: steg ? "Sparat. Det står på raden i listan." : "Borttaget." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

// =============================================================================
// Kopplingen
// =============================================================================

const KOLUMN: Record<string, string> = {
  order: "order_id",
  arende: "case_id",
  person: "employee_id",
  coachning: "coaching_task_id",
  kurs: "course_id",
  dokument: "document_id",
  kandidat: "candidate_id",
  avtal: "contract_id",
  samtal: "kv_call_id",
};

export async function koppla(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const id = text(form, "id");
    const { krets, rad, medlemmar } = await kravKrets(id);
    if (!farRedigera(krets)) return { fel: "Du får inte ändra den här uppgiften." };

    const slag = text(form, "slag");
    const mal = text(form, "mal");
    const kolumn = KOLUMN[slag];

    if (!kolumn) return { fel: "Okänt slag av koppling." };
    if (!mal) return { fel: "Välj vad uppgiften ska kopplas till." };

    /**
     * SYNLIGHETEN GALLER BARA PERSONKOPPLINGEN och ar av som grund.
     *
     * Se rubriken i 0054: en uppgift OM nagon ar en personuppgift aven nar den
     * ar dold, och dold i granssnittet betyder inte dold i registerutdraget.
     * Det omvanda grundlaget — att personen ser raden i samma sekund den
     * skrivs — hade gjort en halvfardig tanke till ett besked.
     */
    const synlig = slag === "person" && form.get("visible_to_subject") === "ja";

    // 0298 (B8, at andra hallet): en DOLD koppling till nagon som redan ar i
    // uppgiften ar ett lofte som inte gar att halla. Hen ser raden.
    if (slag === "person" && !synlig && (mal === rad.assignee_id || medlemmar.some((m) => m.employee_id === mal))) {
      return { fel: "Personen är med i uppgiften och ser den. En dold koppling går inte; gör den synlig." };
    }

    const { error } = await supabaseAdmin()
      .from("task_link")
      .insert({ task_id: id, [kolumn]: mal, visible_to_subject: synlig, created_by: krets.mig });

    // 23505 ar unik-indexet: samma sak kopplad tva ganger ar en dubblett i
    // granssnittet, inte ett fel anvandaren behover se ett felnummer for.
    if (error && error.code !== "23505") return { fel: `Kopplingen sparades inte: ${error.message}` };

    uppdatera(id);
    return { ok: "Kopplad." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

export async function taBortKoppling(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const id = text(form, "id");
    const { krets } = await kravKrets(id);
    if (!farRedigera(krets)) return { fel: "Du får inte ändra den här uppgiften." };

    const lank = text(form, "link_id");
    if (!lank) return { fel: "Vilken koppling?" };

    await supabaseAdmin().from("task_link").delete().eq("id", lank).eq("task_id", id);

    uppdatera(id);
    return { ok: "Borttagen." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

// =============================================================================
// Projekten
// =============================================================================

export async function skapaProjekt(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const user = await kravInloggad();
    const mig = user.employee!.id;

    const namn = text(form, "name");
    if (!namn) return { fel: "Ge projektet ett namn." };

    const farg = text(form, "color") || "brand";

    const { data, error } = await supabaseAdmin()
      .from("project")
      .insert({
        name: namn,
        description_md: text(form, "description_md"),
        owner_id: valfritt(form, "owner_id") ?? mig,
        created_by: mig,
        color: farg,
        due_date: valfritt(form, "due_date"),
      })
      .select("id")
      .single();

    if (error || !data) return { fel: `Projektet sparades inte: ${error?.message ?? "okänt fel"}` };

    revalidatePath("/uppgifter");
    return { ok: "Projektet finns.", id: data.id as string };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

export async function arkiveraProjekt(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const user = await kravInloggad();
    const mig = user.employee!.id;
    const id = text(form, "id");

    const db = supabaseAdmin();
    const { data: projekt } = await db.from("project").select("owner_id, created_by").eq("id", id).maybeSingle();

    if (!projekt) return { fel: "Projektet finns inte." };
    if (projekt.owner_id !== mig && projekt.created_by !== mig) {
      return { fel: "Bara ägaren kan arkivera projektet." };
    }

    const aterstall = form.get("aterstall") === "ja";

    /**
     * ARKIVERING TAR INTE BORT UPPGIFTERNA. De ligger kvar med sin
     * `project_id`, och det ar med flit: ett arkiverat projekt vars uppgifter
     * tappat sin hatt gar inte att plocka fram igen, och da ar "arkivera" bara
     * ett langsammare ord for radera.
     */
    await db
      .from("project")
      .update({ archived_at: aterstall ? null : new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", id);

    revalidatePath("/uppgifter");
    return { ok: aterstall ? "Framplockat." : "Arkiverat." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/**
 * Ändra projektet.
 *
 * ÄGAREN ELLER SKAPAREN, ingen annan — samma krets som arkiveringen. En
 * redigerare i projektet ändrar UPPGIFTERNA i det; att låta hen byta namn,
 * ägare och deadline på hatten hade betytt att den som bjöd in någon för att
 * hjälpa till också gav bort projektet.
 */
export async function andraProjekt(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const user = await kravInloggad();
    const mig = user.employee!.id;
    const id = text(form, "id");

    const db = supabaseAdmin();
    const { data: projekt } = await db.from("project").select("owner_id, created_by").eq("id", id).maybeSingle();

    if (!projekt) return { fel: "Projektet finns inte." };
    if (projekt.owner_id !== mig && projekt.created_by !== mig) {
      return { fel: "Bara ägaren kan ändra projektet." };
    }

    const namn = text(form, "name");
    if (!namn) return { fel: "Ge projektet ett namn." };

    const { error } = await db
      .from("project")
      .update({
        name: namn,
        description_md: text(form, "description_md"),
        color: text(form, "color") || "brand",
        due_date: valfritt(form, "due_date"),
        owner_id: valfritt(form, "owner_id") ?? projekt.owner_id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) return { fel: `Ändringen sparades inte: ${error.message}` };

    revalidatePath("/uppgifter");
    revalidatePath(`/uppgifter/projekt/${id}`);
    return { ok: "Sparat." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/**
 * Bjud in till projektet.
 *
 * TVÅ ROLLER OCH INGEN GRANSKARE. Det är uppgifterna som godkänns, inte hatten
 * — se `project_member` i 0054. En projektmedlem ser projektets sida; vilka
 * UPPGIFTER hen ser avgörs fortfarande av varje uppgifts egen krets, och det är
 * med flit: att bli inbjuden till "Mässan" ska inte öppna någons anteckningar
 * om mässan.
 */
export async function bjudInProjekt(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const user = await kravInloggad();
    const mig = user.employee!.id;
    const id = text(form, "id");

    const db = supabaseAdmin();
    const { data: projekt } = await db.from("project").select("owner_id, created_by").eq("id", id).maybeSingle();

    if (!projekt) return { fel: "Projektet finns inte." };
    if (projekt.owner_id !== mig && projekt.created_by !== mig) {
      return { fel: "Bara ägaren kan bjuda in till projektet." };
    }

    const person = text(form, "employee_id");
    const roll = text(form, "role");

    if (!person) return { fel: "Välj vem som ska bjudas in." };
    if (roll !== "redigerare" && roll !== "visare") return { fel: "Okänd roll." };
    if (person === projekt.owner_id) return { fel: "Ägaren är redan med." };

    const { error } = await db
      .from("project_member")
      .upsert(
        { project_id: id, employee_id: person, role: roll, added_by: mig },
        { onConflict: "project_id,employee_id" },
      );

    if (error) return { fel: `Inbjudan sparades inte: ${error.message}` };

    revalidatePath(`/uppgifter/projekt/${id}`);
    return { ok: "Inbjuden." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

export async function taBortProjektmedlem(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const user = await kravInloggad();
    const mig = user.employee!.id;
    const id = text(form, "id");

    const db = supabaseAdmin();
    const { data: projekt } = await db.from("project").select("owner_id, created_by").eq("id", id).maybeSingle();

    if (!projekt) return { fel: "Projektet finns inte." };
    if (projekt.owner_id !== mig && projekt.created_by !== mig) {
      return { fel: "Du får inte ändra vilka som är med." };
    }

    const person = text(form, "employee_id");
    if (!person) return { fel: "Vem?" };

    await db.from("project_member").delete().eq("project_id", id).eq("employee_id", person);

    revalidatePath(`/uppgifter/projekt/${id}`);
    return { ok: "Borttagen." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

// =============================================================================
// Projektchatten (0055)
// =============================================================================

/**
 * Vem som far skriva i ett projekts chatt.
 *
 * AGAREN, SKAPAREN OCH REDIGERARNA. En `visare` far lasa men inte skriva —
 * det ar samma grans som rollen betyder overallt annars i modulen, och en
 * chatt dar alla som fatt en lank kan skriva ar inte langre projektets.
 */
async function kravChattkrets(projektId: string) {
  const user = await kravInloggad();
  const mig = user.employee!.id;
  const db = supabaseAdmin();

  const [{ data: projekt }, { data: medlemmar }] = await Promise.all([
    db.from("project").select("id, name, owner_id, created_by").eq("id", projektId).maybeSingle(),
    db.from("project_member").select("employee_id, role").eq("project_id", projektId),
  ]);

  if (!projekt) throw new Error("Projektet finns inte.");

  const min = (medlemmar ?? []).find((m) => m.employee_id === mig);
  const ser = projekt.owner_id === mig || projekt.created_by === mig || Boolean(min);

  // Samma linje som `kravKrets()`: den som inte ser raden far inte heller veta
  // att den finns.
  if (!ser) throw new Error("Projektet finns inte.");

  return {
    user,
    mig,
    projekt: projekt as { id: string; name: string; owner_id: string; created_by: string },
    medlemmar: (medlemmar ?? []) as { employee_id: string; role: string }[],
    farSkriva: projekt.owner_id === mig || projekt.created_by === mig || min?.role === "redigerare",
  };
}

export async function skrivProjektmeddelande(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const id = text(form, "id");
    const { mig, farSkriva } = await kravChattkrets(id);

    if (!farSkriva) return { fel: "Du kan läsa samtalet men inte skriva i det." };

    const kropp = text(form, "body");
    if (!kropp) return { fel: "Skriv något först." };
    if (kropp.length > 4000) return { fel: "Repliken får vara högst 4000 tecken." };

    const { error } = await supabaseAdmin()
      .from("project_message")
      .insert({ project_id: id, author_id: mig, body: kropp });

    if (error) return { fel: `Repliken sparades inte: ${error.message}` };

    /**
     * INGEN NOTIS SKRIVS HAR.
     *
     * Olast raknas fram ur `project_message_read` — se `projektchattnotiser()`
     * i uppgifter-server.ts. Tio repliker i samma projekt blir da EN post med
     * en raknare i stallet for tio rader i klockan, och posten forsvinner av
     * sig sjalv nar mottagaren last traden.
     *
     * En handelsepost per replik hade dessutom legat kvar efter lasningen, och
     * en chatt vars notiser maste klickas bort en och en ar en chatt folk
     * stanger av.
     */
    revalidatePath(`/uppgifter/projekt/${id}`);
    return { ok: "Skickat." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/**
 * "Jag har last traden."
 *
 * Tar ett id och inte ett FormData: den anropas fran en effekt i
 * `Projektchatt.tsx` och inte fran ett formular, och ett pahittat FormData
 * bara for att matcha de andra hade varit ceremoni.
 *
 * SKRIVER ALLTID NU, aven om raden redan finns — `upsert` pa nyckeln. Att
 * hoppa over skrivningen nar tidpunkten redan ar satt hade betytt att den
 * forsta lasningen var den enda som raknades.
 */
export async function markeraProjektchattLast(projektId: string): Promise<void> {
  try {
    if (!projektId) return;
    const { mig } = await kravChattkrets(projektId);

    await supabaseAdmin()
      .from("project_message_read")
      .upsert(
        { project_id: projektId, employee_id: mig, seen_at: new Date().toISOString() },
        { onConflict: "project_id,employee_id" },
      );
  } catch {
    // Tyst. En misslyckad lasmarkering ska inte fella en sida som redan
    // renderats — foljden ar att notisen star kvar en stund till.
  }
}
