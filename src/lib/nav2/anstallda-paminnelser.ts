import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { svensktDatum } from "@/lib/klocka";
import { notifiera } from "@/lib/notishandelse-server";
import { SKRIVLAGE } from "@/lib/nav2/skrivlage";
import { arbetsdagar, frist } from "@/lib/nav2/anstalldaforma";

/**
 * Nav 2.0 (0105), Anställda: utskicksreglernas påminnelse och eskalering.
 *
 *   - Påminnelsen: `remind_days` arbetsdagar före fristen, en gång, aldrig
 *     samma dag som mejlet gick (utkastets aeRegelLage). Den som ansvarar för
 *     punkten får en notis i Nav (`personal-paminn`) som leder till Klart.
 *     Beställaren 2026-10-20 (A9): först notis, mejlet via Resend byggs ut senare.
 *   - Eskaleringen: arbetsdagen efter fristen får närmaste chef en notis om att
 *     det inte är gjort. En gång per punkt (`escalated_on`).
 *
 * Körs av dagtidsjobbet, och bara när `SKRIVLAGE.anstallda` är på.
 */

type Rad = {
  id: string; employee_id: string; label: string; owner_id: string; offset_days: number | null; offset_special: string | null; due_date: string | null;
  created_on: string; sent_on: string | null; remind_days: number | null; mail_subject: string | null; mail_body: string | null;
  auto_reminded_on: string | null; escalated_on: string | null;
};
const KOLUMNER = "id, employee_id, label, owner_id, offset_days, offset_special, due_date, created_on, sent_on, remind_days, mail_subject, mail_body, auto_reminded_on, escalated_on";

export async function korAnstalldaPaminnelser(db: SupabaseClient, nu = new Date()): Promise<{ paminda: number; eskalerade: number } | null> {
  if (!SKRIVLAGE.anstallda) return null;
  const idag = svensktDatum(nu);
  let paminda = 0, eskalerade = 0;
  for (const tabell of ["onboarding_task", "offboarding_task"] as const) {
    const { data } = await db.from(tabell).select(KOLUMNER).eq("kind", "regel").eq("state", "open").eq("self_owned", false).not("owner_id", "is", null);
    const rader = (data ?? []) as unknown as Rad[];
    if (!rader.length) continue;
    const { data: pers } = await db.from("employee").select("id, first_name, last_name, start_date, end_date, manager_id").in("id", [...new Set(rader.map((r) => r.employee_id))]);
    const per = new Map(((pers ?? []) as unknown as { id: string; first_name: string; last_name: string; start_date: string | null; end_date: string | null; manager_id: string | null }[]).map((p) => [p.id, p]));
    for (const r of rader) {
      const p = per.get(r.employee_id);
      if (!p) continue;
      const skickat = r.sent_on ?? r.created_on;
      const due = frist({ bas: tabell === "offboarding_task" ? p.end_date : p.start_date, skapad: skickat, off: r.offset_days, spec: r.offset_special, flyttad: r.due_date });
      const namn = `${p.first_name} ${p.last_name}`.trim();
      const pd = arbetsdagar(due, -(r.remind_days ?? 2));
      if (!r.auto_reminded_on && pd > skickat && idag >= pd && idag <= due) {
        await notifiera({ till: r.owner_id, av: null, kalla: "personal-paminn", typ: "uppgift", rubrik: `Påminnelse: ${r.label}`, detalj: `${namn} · klart senast ${due}`, href: `/nav2/anstallda/klart?id=${r.id}`, objekt: { typ: "employee", id: p.id } });
        await db.from(tabell).update({ auto_reminded_on: idag }).eq("id", r.id);
        paminda++;
      }
      if (!r.escalated_on && idag >= arbetsdagar(due, 1)) {
        if (p.manager_id)
          await notifiera({ till: p.manager_id, av: null, kalla: "personal-paminn", typ: "uppgift", rubrik: `Inte gjort: ${r.label}`, detalj: `${namn} · fristen var ${due}`, href: "/nav2", objekt: { typ: "employee", id: p.id } });
        await db.from(tabell).update({ escalated_on: idag }).eq("id", r.id);
        eskalerade++;
      }
    }
  }
  return { paminda, eskalerade };
}
