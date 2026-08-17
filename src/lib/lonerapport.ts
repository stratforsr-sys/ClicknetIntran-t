/**
 * E4b Lönerapport. Ren logik — inga anrop, inga hemligheter.
 *
 * ===========================================================================
 * AC-2.17, K5: HÄR RÄKNAS INGEN LÖN.
 *
 * Rapporten redovisar minuter och antal. Ingen krona, ingen semesterrätt,
 * ingen tolkning av kollektivavtal. Den som lägger till en multiplikation med
 * en timpenning här har gjort navet till ett lönesystem — med allt vad det
 * innebär av ansvar för att siffran är rätt.
 * ===========================================================================
 *
 * Filen har noll importer, av samma skäl som avvikelsemotorn i `raster.ts`:
 * den ska gå att prova utan att starta något annat. Vilka händelser som räknas
 * avgörs av `gallande()` hos den som anropar — modulen bedömer en färdig lista,
 * den bestämmer inte vad listan innehåller.
 */

/** Så mycket av en stämpling som E4b behöver veta. */
export type Stampling = { kind: string; occurred_at: string };

export type Blockeringstyp = "rattelse" | "oppen_dag" | "avvikelse";

export type Blockering = {
  typ: Blockeringstyp;
  employee_id: string;
  datum: string;
  text: string;
};

export const BLOCKERING_ETIKETT: Record<Blockeringstyp, string> = {
  rattelse: "Väntande rättelse",
  oppen_dag: "Dag utan utstämpling",
  avvikelse: "Oavslutad avvikelse",
};

/** Dagen en tidsstämpel hör till, i lokal tid. */
export function dagen(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Dagar där någon stämplade in men aldrig ut.
 *
 * Nattjobbet stänger sådana vid schemaslut (AC-2.4), men bara för den som har
 * ett schema. Saknas schemat står dagen öppen med flit — och en öppen dag får
 * inte tyst bli noll minuter i ett löneunderlag.
 *
 * Listan ska redan vara filtrerad genom `gallande()`. En väntande rättelse är
 * ett förslag, och ett förslag stänger ingen dag.
 */
export function oppnaDagar(handelser: Stampling[]): string[] {
  const perDag = new Map<string, Stampling[]>();
  for (const h of [...handelser].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))) {
    const d = dagen(h.occurred_at);
    perDag.set(d, [...(perDag.get(d) ?? []), h]);
  }

  const oppna: string[] = [];
  for (const [datum, rader] of perDag) {
    const sista = rader[rader.length - 1];
    if (sista.kind !== "out") oppna.push(datum);
  }

  return oppna.sort();
}

export type Underlag = {
  personal: { id: string; namn: string }[];
  /** Redan filtrerad genom `gallande()` av den som anropar. */
  handelser: (Stampling & { employee_id: string })[];
  vantandeRattelser: { employee_id: string; occurred_at: string }[];
  oavslutadeAvvikelser: { employee_id: string; work_date: string; kind: string }[];
};

/**
 * AC-2.14: rapporten får inte genereras när något är oavslutat, och systemet
 * ska säga VAD som blockerar. En spärr utan lista är en återvändsgränd —
 * chefen ska kunna gå direkt och åtgärda, inte gissa.
 */
export function blockeringar(underlag: Underlag): Blockering[] {
  const namn = new Map(underlag.personal.map((p) => [p.id, p.namn]));
  const ut: Blockering[] = [];

  for (const r of underlag.vantandeRattelser) {
    ut.push({
      typ: "rattelse",
      employee_id: r.employee_id,
      datum: dagen(r.occurred_at),
      text: `${namn.get(r.employee_id) ?? "Okänd"} har en rättelse som väntar på beslut.`,
    });
  }

  const perPerson = new Map<string, Stampling[]>();
  for (const h of underlag.handelser) {
    perPerson.set(h.employee_id, [...(perPerson.get(h.employee_id) ?? []), h]);
  }

  for (const [id, egna] of perPerson) {
    for (const datum of oppnaDagar(egna)) {
      ut.push({
        typ: "oppen_dag",
        employee_id: id,
        datum,
        text: `${namn.get(id) ?? "Okänd"} stämplade in ${datum} men aldrig ut.`,
      });
    }
  }

  for (const a of underlag.oavslutadeAvvikelser) {
    ut.push({
      typ: "avvikelse",
      employee_id: a.employee_id,
      datum: a.work_date,
      text: `${namn.get(a.employee_id) ?? "Okänd"} har en avvikelse ${a.work_date} som ingen avslutat.`,
    });
  }

  return ut.sort((a, b) => a.datum.localeCompare(b.datum) || a.typ.localeCompare(b.typ));
}

// -----------------------------------------------------------------------------
// Export. AC-2.18: kolumnerna är konfiguration, inte kod.
// -----------------------------------------------------------------------------

export type Exportfalt =
  | "employee_number"
  | "name"
  | "email"
  | "period_start"
  | "period_end"
  | "worked_hours"
  | "worked_minutes"
  | "break_minutes"
  | "adjustment_minutes"
  | "net_minutes"
  | "auto_closed_days"
  | "deviation_count";

export type Exportkolumn = { sort: number; header: string; field: Exportfalt; active: boolean };

export type Exportrad = {
  employee_number: string | null;
  name: string;
  email: string;
  period_start: string;
  period_end: string;
  worked_minutes: number;
  break_minutes: number;
  adjustment_minutes: number;
  auto_closed_days: number;
  deviation_count: number;
};

/** Timmar med två decimaler. Lönesystem vill nästan alltid ha decimaltimmar. */
export function decimaltimmar(minuter: number): string {
  return (minuter / 60).toFixed(2);
}

export function faltvarde(rad: Exportrad, falt: Exportfalt): string {
  switch (falt) {
    case "employee_number":
      return rad.employee_number ?? "";
    case "name":
      return rad.name;
    case "email":
      return rad.email;
    case "period_start":
      return rad.period_start;
    case "period_end":
      return rad.period_end;
    case "worked_hours":
      return decimaltimmar(rad.worked_minutes);
    case "worked_minutes":
      return String(rad.worked_minutes);
    case "break_minutes":
      return String(rad.break_minutes);
    case "adjustment_minutes":
      return String(rad.adjustment_minutes);
    case "net_minutes":
      return String(rad.worked_minutes + rad.adjustment_minutes);
    case "auto_closed_days":
      return String(rad.auto_closed_days);
    case "deviation_count":
      return String(rad.deviation_count);
  }
}

/** Semikolon och BOM: svensk Excel öppnar filen rätt utan importguide. */
export function csv(kolumner: Exportkolumn[], rader: Exportrad[]): string {
  const valda = kolumner.filter((k) => k.active).sort((a, b) => a.sort - b.sort);

  const cell = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

  const rubrik = valda.map((k) => cell(k.header)).join(";");
  const kropp = rader.map((r) => valda.map((k) => cell(faltvarde(r, k.field))).join(";"));

  return "﻿" + [rubrik, ...kropp].join("\r\n") + "\r\n";
}
