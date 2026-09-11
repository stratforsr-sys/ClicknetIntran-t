import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { epostArKonfigurerad, skickaKo, type Brev } from "@/lib/epost";
import { svensktDatum } from "@/lib/klocka";
import { lageAv, arStangd, fristtext, type Handelsetyp, type Lage } from "@/lib/uppgifter";

/**
 * Morgonbrevet: dagens plan, en gång per arbetsdag.
 *
 * ===========================================================================
 * VARFÖR ETT MEJL FINNS ÖVER HUVUD TAGET, NÄR KLOCKAN REDAN SÄGER TILL
 *
 * Notisklockan säger till DEN SOM ÖPPNAR NAVET. Det är precis fel krets för en
 * påminnelse: den som har uppgifterna i huvudet öppnar navet ändå, och den som
 * glömt bort dem gör det inte. En lista över det man inte får glömma, som bara
 * syns för den som kommit ihåg att titta, löser ingenting.
 *
 * VARFÖR DET INTE ÄR EN PUSH PÅ KLOCKSLAG. Vercels Hobby-plan tar två
 * cron-poster per projekt och kör var och en EN gång per dygn — se rubriken i
 * `natt/route.ts` om vad som hände när tre poster deklarerades. Ett "pling
 * 13:45 inför samtalet 14:00" går alltså inte att skicka från servern. Det som
 * går är ett brev på morgonen och en webbläsarnotis medan navet är öppet, och
 * det är medvetet valt framför att lägga till en betald schemaläggare för en
 * funktion som fungerar utan den.
 *
 * ===========================================================================
 * BREVET SKICKAS BARA NÄR DET HAR NÅGOT ATT SÄGA
 *
 * Ingen "du har 0 uppgifter idag". Ett återkommande brev som oftast är tomt är
 * ett brev man skapar en filterregel för, och då är även det femte brevet —
 * det som faktiskt betydde något — bortfiltrerat. Forskningen om notisträtthet
 * pekar entydigt åt samma håll, och det är billigare att lita på den än att
 * upptäcka det själv.
 *
 * HELGER HOPPAS ÖVER. En påminnelse om arbetsuppgifter en söndag morgon är
 * inte en tjänst.
 * ===========================================================================
 */

type Utfall = {
  mottagare: number;
  skickade: number;
  fel: string[];
  /** Sant när dagen inte är en arbetsdag och jobbet därför inte gjorde något. */
  helg: boolean;
};

type Rad = {
  id: string;
  title: string;
  assignee_id: string | null;
  created_by: string;
  due_date: string | null;
  due_time: string | null;
};

export async function korMorgonjobbet(db: SupabaseClient, nu = new Date()): Promise<Utfall> {
  const idag = svensktDatum(nu);

  // 1 = måndag … 7 = söndag. Räknat på det svenska datumet, inte på serverns.
  const veckodag = ((new Date(`${idag}T12:00:00.000Z`).getUTCDay() + 6) % 7) + 1;
  if (veckodag >= 6) return { mottagare: 0, skickade: 0, fel: [], helg: true };

  if (!epostArKonfigurerad()) {
    return { mottagare: 0, skickade: 0, fel: ["E-post är inte konfigurerad"], helg: false };
  }

  /**
   * Läses med SERVICE ROLE, och det är riktigt just här.
   *
   * Jobbet har ingen inloggad användare att låna en token av — det körs av
   * Vercels cron. Urvalet görs i stället i koden: varje brev innehåller
   * uteslutande rader där mottagaren själv är `assignee_id`, och breven byggs
   * per person. Ingen får se någon annans uppgifter, och ingen får ett brev om
   * något hen inte redan ser i navet.
   */
  const [{ data: uppgifter }, { data: handelser }, { data: medlemmar }] = await Promise.all([
    db.from("task").select("id, title, assignee_id, created_by, due_date, due_time").is("parent_id", null),
    db.from("task_event").select("task_id, type").order("at"),
    db.from("task_member").select("task_id, employee_id, role"),
  ]);

  const lagen = new Map<string, Lage>();
  const perUppgift = new Map<string, { type: Handelsetyp }[]>();
  for (const h of (handelser ?? []) as { task_id: string; type: Handelsetyp }[]) {
    const lista = perUppgift.get(h.task_id);
    if (lista) lista.push(h);
    else perUppgift.set(h.task_id, [h]);
  }
  for (const u of (uppgifter ?? []) as Rad[]) lagen.set(u.id, lageAv(perUppgift.get(u.id) ?? []));

  /** Vad varje person ska få veta. */
  const per = new Map<string, { forsenade: Rad[]; idag: Rad[]; granska: Rad[] }>();
  const plats = (id: string) => {
    const fanns = per.get(id);
    if (fanns) return fanns;
    const ny = { forsenade: [] as Rad[], idag: [] as Rad[], granska: [] as Rad[] };
    per.set(id, ny);
    return ny;
  };

  for (const u of (uppgifter ?? []) as Rad[]) {
    const lage = lagen.get(u.id) ?? "ej_paborjad";
    if (arStangd(lage)) continue;

    if (u.assignee_id && u.due_date) {
      if (u.due_date < idag) plats(u.assignee_id).forsenade.push(u);
      else if (u.due_date === idag) plats(u.assignee_id).idag.push(u);
    }

    // Det som väntar på någons bock. Först till kvarn — alla granskare får
    // raden, och den som hinner först stänger den för de andra.
    if (lage === "granskas") {
      for (const m of (medlemmar ?? []) as { task_id: string; employee_id: string; role: string }[]) {
        if (m.task_id === u.id && m.role === "granskare") plats(m.employee_id).granska.push(u);
      }
    }
  }

  const harNagot = [...per.entries()].filter(
    ([, v]) => v.forsenade.length + v.idag.length + v.granska.length > 0,
  );

  if (harNagot.length === 0) return { mottagare: 0, skickade: 0, fel: [], helg: false };

  const { data: personer } = await db
    .from("employee")
    .select("id, first_name, email, status")
    .in(
      "id",
      harNagot.map(([id]) => id),
    );

  const brevlada: Brev[] = [];

  for (const [id, v] of harNagot) {
    const person = (personer ?? []).find((p) => p.id === id) as
      | { id: string; first_name: string; email: string; status: string }
      | undefined;

    // En avslutad anställd får inga påminnelser. Samma spärr som iCal-flödet
    // drar i 0021, och av samma skäl: den ska inte kräva att offboardingkoden
    // kommer ihåg den här filen.
    if (!person?.email || person.status === "offboarded") continue;

    brevlada.push({
      till: person.email,
      amne: amne(v.forsenade.length, v.idag.length, v.granska.length),
      text: brevtext(person.first_name, v, idag),
    });
  }

  const utfall = await skickaKo(brevlada);

  return {
    mottagare: brevlada.length,
    skickade: utfall.filter((u) => u.utfall.skickat).length,
    fel: utfall
      .filter((u) => !u.utfall.skickat)
      .map((u) => `${String(u.brev.till)}: ${"orsak" in u.utfall ? u.utfall.orsak : "okänt"}`),
    helg: false,
  };
}

/**
 * Ämnesraden säger vad som väntar, inte att brevet finns.
 *
 * "Dagens uppgifter" är sant om varenda brev och skiljer därför inte den dag
 * något brinner från den dag ingenting gör det. Den som ser "3 försenade" i
 * inkorgen har fått veta det utan att öppna brevet — vilket är hela poängen
 * med en påminnelse.
 */
function amne(forsenade: number, idag: number, granska: number): string {
  const delar: string[] = [];
  if (forsenade > 0) delar.push(`${forsenade} försenade`);
  if (idag > 0) delar.push(`${idag} idag`);
  if (granska > 0) delar.push(`${granska} att godkänna`);
  return `Clicknet Nav: ${delar.join(", ")}`;
}

function brevtext(
  fornamn: string,
  v: { forsenade: Rad[]; idag: Rad[]; granska: Rad[] },
  idag: string,
): string {
  const rader: string[] = [`Hej ${fornamn},`, ""];

  const lista = (rubrik: string, poster: Rad[]) => {
    if (poster.length === 0) return;
    rader.push(rubrik);
    for (const u of poster) {
      const nar = [fristtext(u.due_date, idag), u.due_time?.slice(0, 5)].filter(Boolean).join(" ");
      rader.push(`  - ${u.title}${nar ? ` (${nar})` : ""}`);
    }
    rader.push("");
  };

  lista("FÖRSENAT", v.forsenade);
  lista("IDAG", v.idag);
  lista("VÄNTAR PÅ DITT GODKÄNNANDE", v.granska);

  rader.push("Öppna listan: https://clicknet-nav.vercel.app/uppgifter");
  rader.push("");
  rader.push("Det här brevet går bara ut de dagar du har något som väntar.");

  return rader.join("\n");
}
