/**
 * Dagens bemanningslage — vem som ar sjuk, vem som ar ledig och vem som inte
 * stamplat in i tid. Ren logik, inga anrop. Serversidan ligger i
 * `dagslage-server.ts`.
 *
 * ===========================================================================
 * TRE SAKER SOM INTE FAR GLIDA, FOR DE AR LOFTEN TILL PERSONALEN.
 *
 * 1. DET HAR AR EN BEMANNINGSVY, INTE EN ANKLAGELSE. Raden "Inte instampld"
 *    betyder att navet inte har sett nagon instampling an — ingenting mer. Den
 *    ar INTE oregistrerad franvaro (`absence_reminder`), den skapar ingen rad
 *    nagonstans, och ingen konsekvens hanger i den. Konsekvenstrappan har sin
 *    egen vag genom nattjobbet, med den anstalldas foretradesratt att
 *    registrera sin egen franvaro forst (AC-3.19). Den vagen ror vi inte har.
 *
 * 2. DEN SOM AR SJUK ELLER LEDIG BEDOMS INTE SOM SEN. Att fa bada raderna
 *    samtidigt hade betytt att en godkand semesterdag ocksa las som en utebliven
 *    instampling, och det ar just den forvaxlingen `stampelfri.ts` beskriver
 *    som "en anklagelse".
 *
 * 3. DEL AV DAG BEDOMS INTE ALLS. En ledighet pa nagra timmar sager ingenting
 *    om VILKA timmar, och navet far inte gissa fram en starttid att doma emot.
 *    Samma linje som AC-2.4 drar om sluttider.
 * ===========================================================================
 *
 * Vem som kommer med i listorna avgors av RLS och inte har: teamledaren ser
 * sitt team, ledningen alla. Modulen bedomer en fardig lista.
 */

import { svenskaMinuter, svenskKlocka } from "./klocka.ts";
import { gallandeSchema } from "./raster.ts";
import { senAnkomst, forsening, minutOnDagen } from "./narvaro.ts";
import { dagarMellan, periodtext, omfattning } from "./franvaro.ts";

export type Person = {
  id: string;
  first_name: string;
  last_name: string;
  team_id: string | null;
  start_date: string | null;
};

export type Schemarad = {
  id: string;
  scope: string;
  employee_id: string | null;
  team_id: string | null;
  start_time: string;
  tol_late: number;
  valid_from: string;
};

export type Stampel = { employee_id: string; kind: string; occurred_at: string };

export type Ledighet = {
  employee_id: string;
  type_id: string;
  starts_on: string;
  ends_on: string;
  part_day_minutes: number | null;
};

export type Sjukrad = {
  employee_id: string;
  first_sick_day: string;
  last_sick_day: string | null;
  extent_percent: number;
  confirmed_at: string | null;
};

/**
 * `ej_instamplad` och `sen` ar tva olika saker och far inte slas ihop. Den
 * forsta ar en oppen fraga klockan 08:15 — nagon kanske ar pa vag, kanske har
 * ringt sin chef. Den andra ar ett kant faktum: personen ar har, och kom sent.
 */
export type Dagslage = "ej_instamplad" | "sen" | "sjuk" | "ledig";

export type Dagsrad = {
  employee_id: string;
  namn: string;
  lage: Dagslage;
  /** Texten i market. Alltid ett ord, aldrig bara en farg (AC-U5.2). */
  etikett: string;
  ton: "danger" | "warn" | "accent" | "neutral";
  detalj: string;
  /** Bara for sorteringen och for provet. Minuter sen, eller 0. */
  minuter: number;
  href: string;
};

export type Dagsbild = {
  rader: Dagsrad[];
  /** Hur manga personer som ingick i bedomningen. Noll = ingen att visa. */
  bedomda: number;
  /** Falskt nar stamplingen ar av: da gar sen ankomst inte att veta alls. */
  senRaknad: boolean;
};

const ORDNING: Record<Dagslage, number> = {
  ej_instamplad: 0,
  sen: 1,
  sjuk: 2,
  ledig: 3,
};

function namnet(p: Person): string {
  return `${p.first_name} ${p.last_name}`.trim();
}

/**
 * Bilden av dagen, sammansatt av fyra kallor som alla redan ar filtrerade pa
 * dagen av den som fragade.
 *
 * `nu` skickas in i stallet for att lasas ur klockan, sa att provet kan stalla
 * fram tiden utan att rora systemklockan — samma vana som `boreskalera`.
 */
export function dagensLage(u: {
  personer: Person[];
  /** Arbetsscheman for DAGENS veckodag, alla nivaer. */
  scheman: Schemarad[];
  /** Dagens stamplingar for de personer fragan galler. */
  stamplingar: Stampel[];
  /** Godkand ledighet som tacker dagen. */
  ledigheter: Ledighet[];
  /** Ej avbruten sjukanmalan som tacker dagen. */
  sjuka: Sjukrad[];
  /** type_id -> etikett, ur `absence_type`. */
  typnamn: Map<string, string>;
  /** Roller som inte stamplar, uppslagna per anstalld. */
  stampelfria: Set<string>;
  datum: string;
  nu: Date;
  stamplingPa: boolean;
}): Dagsbild {
  const rader: Dagsrad[] = [];

  const sjukPer = new Map<string, Sjukrad>();
  for (const s of u.sjuka) {
    // Flera anmalningar som tacker samma dag: den senast paborjade galler.
    const fore = sjukPer.get(s.employee_id);
    if (!fore || s.first_sick_day > fore.first_sick_day) sjukPer.set(s.employee_id, s);
  }

  const ledigPer = new Map<string, Ledighet[]>();
  for (const l of u.ledigheter) {
    ledigPer.set(l.employee_id, [...(ledigPer.get(l.employee_id) ?? []), l]);
  }

  const stamplarPer = new Map<string, Stampel[]>();
  for (const s of u.stamplingar) {
    stamplarPer.set(s.employee_id, [...(stamplarPer.get(s.employee_id) ?? []), s]);
  }

  const minuterNu = svenskaMinuter(u.nu);

  for (const p of u.personer) {
    // Dagar fore anstallningens start ar ingen bemanningsfraga. Samma undantag
    // som nattjobbet gor innan det lagger en paminnelse.
    if (p.start_date && u.datum < String(p.start_date).slice(0, 10)) continue;

    const sjuk = sjukPer.get(p.id);
    if (sjuk) {
      const dag = dagarMellan(sjuk.first_sick_day, u.datum) + 1;
      const del = sjuk.extent_percent < 100 ? ` · ${sjuk.extent_percent} %` : "";
      rader.push({
        employee_id: p.id,
        namn: namnet(p),
        lage: "sjuk",
        // AC-3.17: den obekraftade star ut. Bekraftelsen ar inte administration
        // utan hela poangen — nagon ska ha sett anmalan.
        etikett: sjuk.confirmed_at ? "Sjuk" : "Obekräftad",
        ton: sjuk.confirmed_at ? "warn" : "danger",
        detalj: `Sjukdag ${dag}, sedan ${periodtext(sjuk.first_sick_day, sjuk.first_sick_day)}${del}`,
        minuter: 0,
        href: "/franvaro/sjuk",
      });
      continue;
    }

    const lediga = ledigPer.get(p.id) ?? [];
    if (lediga.length > 0) {
      // Heldag vinner over del av dag: den som ar borta hela dagen ar borta,
      // aven om hen ocksa har ett lakarbesok inbokat.
      const l = lediga.find((x) => x.part_day_minutes === null) ?? lediga[0];
      const typ = u.typnamn.get(l.type_id) ?? "Ledig";
      rader.push({
        employee_id: p.id,
        namn: namnet(p),
        lage: "ledig",
        etikett: typ,
        ton: "neutral",
        detalj:
          l.part_day_minutes === null
            ? periodtext(l.starts_on, l.ends_on)
            : `Del av dagen · ${omfattning(l)}`,
        minuter: 0,
        href: "/franvaro",
      });
      continue;
    }

    // Harifran och ner handlar allt om stamplingen. Ar den av finns ingen
    // uppgift om vem som ar pa plats, och da far ingen bedomas alls.
    if (!u.stamplingPa) continue;

    // VD, saljchef, ekonomi och projektledare har ingen arbetstid som mats in
    // och ut. Att doma dem mot bolagsschemat hade gett dem en rad om dagen.
    if (u.stampelfria.has(p.id)) continue;

    const schema = gallandeSchema(u.scheman, p.id, p.team_id, u.datum)[0] ?? null;
    if (!schema) continue;

    const egna = stamplarPer.get(p.id) ?? [];
    const forsta = [...egna]
      .filter((h) => h.kind === "in")
      .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))[0];

    if (forsta) {
      const sen = senAnkomst(egna, {
        start_time: schema.start_time,
        tol_late: schema.tol_late ?? 1,
        schedule_id: schema.id,
      });
      if (!sen) continue;

      rader.push({
        employee_id: p.id,
        namn: namnet(p),
        lage: "sen",
        etikett: `${forsening(sen.minuter)} sen`,
        ton: "warn",
        detalj: `Stämplade in ${svenskKlocka(sen.ankom)} · schemat började ${sen.schemalagd}`,
        minuter: sen.minuter,
        href: "/tid",
      });
      continue;
    }

    // Ingen instampling an. Fragan stalls forst nar bade schemat och
    // toleransen har passerat — toleransen laggs TILL gransen, aldrig dras
    // ifran, precis som i `narvaro.ts`.
    const grans = minutOnDagen(schema.start_time) + (schema.tol_late ?? 1);
    if (minuterNu <= grans) continue;

    rader.push({
      employee_id: p.id,
      namn: namnet(p),
      lage: "ej_instamplad",
      etikett: "Inte instämplad",
      ton: "accent",
      detalj: `Skulle börjat ${schema.start_time.slice(0, 5)} · ingen stämpling än`,
      minuter: minuterNu - minutOnDagen(schema.start_time),
      href: "/tid",
    });
  }

  rader.sort((a, b) => {
    if (ORDNING[a.lage] !== ORDNING[b.lage]) return ORDNING[a.lage] - ORDNING[b.lage];
    // Inom sen ankomst: den storsta forseningen forst. I ovrigt namnordning,
    // sa att listan star still mellan tva sidladdningar.
    if (a.minuter !== b.minuter) return b.minuter - a.minuter;
    return a.namn.localeCompare(b.namn, "sv");
  });

  return { rader, bedomda: u.personer.length, senRaknad: u.stamplingPa };
}

/** Kort sammanfattning till kortets underrubrik. */
export function dagssammanfattning(bild: Dagsbild): string {
  const antal = (lage: Dagslage) => bild.rader.filter((r) => r.lage === lage).length;
  const delar = [
    [antal("ej_instamplad"), "inte instämplad", "inte instämplade"],
    [antal("sen"), "sen", "sena"],
    [antal("sjuk"), "sjuk", "sjuka"],
    [antal("ledig"), "ledig", "lediga"],
  ] as [number, string, string][];

  const text = delar
    .filter(([n]) => n > 0)
    .map(([n, ental, flertal]) => `${n} ${n === 1 ? ental : flertal}`)
    .join(" · ");

  return text || "Ingen frånvaro registrerad";
}
