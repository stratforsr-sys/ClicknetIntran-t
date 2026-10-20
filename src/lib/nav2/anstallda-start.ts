import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { siteUrl } from "@/lib/env";
import { skickaEpost } from "@/lib/epost";
import { notifiera, notifieraFlera } from "@/lib/notishandelse-server";
import { sattOrganisation } from "@/app/(app)/personal/actions";
import { frist, fyll, type FyllPerson } from "@/lib/nav2/anstalldaforma";
import { nivaFor, type Niva } from "@/lib/nav2/forma";

/**
 * Nav 2.0, Anställda: det som händer när någon läggs upp, delat av två rutter.
 *
 * ===========================================================================
 * LÄGG UPP OCH REKRYTERINGENS ANSTÄLLNING GÖR SAMMA SAK (beställaren
 * 2026-10-20, A7). Efter kontot (`laggUppAnstalld`) kommer chefen,
 * anställningsuppgifterna, mallens punkter med frister, de egna punkterna,
 * utskicksreglerna, chefens notis och superadminernas notis (A3). Båda
 * rutterna anropar `startaListan`, så de kan inte glida isär.
 * ===========================================================================
 *
 * Hjälparna lyftes hit ur /nav2/anstallda (som använder dem till allt annat
 * också) utan att ändras.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const str = (v: unknown, max = 500) => String(v ?? "").trim().slice(0, max);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

export type Person = {
  id: string; first_name: string; last_name: string; email: string; status: string; employment_type: string;
  start_date: string | null; end_date: string | null; team_id: string | null; manager_id: string | null; employee_number: string | number | null;
};
export type MallPunkt = { key: string; label: string; offset_days: number | null; offset_special: string | null; kind: string; law_ref: string | null; condition: string | null; owner: string; owner_id: string | null; sort: number };
type Regel = { id: string; name: string; recipient_id: string | null; roles: string[] | null; trigger: string; due_offset: number; remind_days: number; ask_for: string | null; subject: string; body: string; active: boolean };

export const namnPa = (p: { first_name: string; last_name: string }) => `${p.first_name} ${p.last_name}`.replace(/\s+/g, " ").trim();

/** Lägg upps fält efter kontot: mallen, chefen, kontaktuppgifterna och punkterna som valts bort eller lagts till. */
export type Start = {
  mallId: string | null; roll: string; chefId: string | null; teamId: string | null; privat: string; tel: string; tredje: boolean;
  bort: string[]; extra: { t: string; off: number }[]; regAv: string[];
  /** Får redan en notis om samma sak (Rekryteringens krets), så superadminernas notis hoppar över dem. */
  utom?: string[];
};
/** Samma tolkning av begäran i båda rutterna. `f` är formulärets fält, `b` hela begäran. */
export function startFran(b: Record<string, unknown>, f: Record<string, unknown>, roll: string, teamId: string | null): Start {
  return {
    mallId: UUID.test(String(b.mall ?? "")) ? String(b.mall) : null,
    roll,
    chefId: UUID.test(String(f.chef ?? "")) ? String(f.chef) : null,
    teamId,
    privat: str(f.privat, 200),
    tel: str(f.tel, 40),
    tredje: f.tredje === true,
    bort: Array.isArray(b.bort) ? (b.bort as unknown[]).map(String) : [],
    extra: (Array.isArray(b.extra) ? (b.extra as { t?: unknown; off?: unknown }[]) : [])
      .map((x) => ({ t: str(x.t, 120), off: Math.max(-60, Math.min(365, Math.round(Number(x.off) || 0))) }))
      .filter((x) => x.t),
    regAv: Array.isArray(b.regAv) ? (b.regAv as unknown[]).map(String) : [],
  };
}

export function anstalldaVerktyg(db: SupabaseClient, jag: { id: string; namn: string; epost: string }, idag: string) {
  const mig = jag.id, jagNamn = jag.namn;
  const personen = async (id: unknown): Promise<Person | null> => {
    const pid = String(id ?? "");
    if (!UUID.test(pid)) return null;
    const { data } = await db
      .from("employee")
      .select("id, first_name, last_name, email, status, employment_type, start_date, end_date, team_id, manager_id, employee_number")
      .eq("id", pid)
      .maybeSingle();
    return (data as Person | null) ?? null;
  };
  const namnFor = async (id: string | null): Promise<{ namn: string; epost: string } | null> => {
    if (!id) return null;
    const { data } = await db.from("employee").select("first_name, last_name, email").eq("id", id).maybeSingle();
    return data ? { namn: namnPa(data as { first_name: string; last_name: string }), epost: String((data as { email: string }).email ?? "") } : null;
  };
  const logga = (pid: string, text: string, meta: Record<string, unknown> = {}) =>
    db.from("audit_log").insert({ actor_id: mig, action: "anstallda.handelse", object_type: "employee", object_id: pid, meta: { text, ...meta } });
  const fyllFor = async (p: Person): Promise<FyllPerson> => {
    const [{ data: r }, chef, { data: t }] = await Promise.all([
      db.from("employee_role").select("role").eq("employee_id", p.id),
      namnFor(p.manager_id),
      p.team_id ? db.from("team").select("name").eq("id", p.team_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    return {
      namn: namnPa(p),
      roller: ((r ?? []) as unknown as { role: string }[]).map((x) => x.role),
      start: p.start_date,
      slut: p.end_date,
      jobbmejl: p.email,
      chef: chef?.namn ?? null,
      team: (t as { name: string } | null)?.name ?? "",
      nr: p.employee_number === null || p.employee_number === undefined ? "" : String(p.employee_number),
    };
  };
  const klartLank = (rad: string) => `${siteUrl().replace(/\/+$/, "")}/nav2/anstallda/klart?id=${rad}`;
  /** Mejlet till den som ska göra något, med Klart-länken. */
  const mejla = async (till: string, amne: string, text: string, rad: string | null, due: string | null) => {
    const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5">${esc(text).replace(/\n/g, "<br>")}${due ? `<p style="color:#666">Klart senast ${esc(due)}.</p>` : ""}${rad ? `<p><a href="${klartLank(rad)}" style="display:inline-block;background:#1f6f5c;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Klart</a></p>` : ""}</div>`;
    return skickaEpost({ till, amne, text: `${text}${due ? `\n\nKlart senast ${due}.` : ""}${rad ? `\n\nTryck Klart här: ${klartLank(rad)}` : ""}`, html, svaraTill: jag.epost });
  };
  /** Regelpunkterna för en person, och mejlen till mottagarna. */
  /** `fp` läses före avslutet: offboarda tar bort rollerna, och reglerna väljs på dem. */
  const regelPunkter = async (p: Person, trigger: "start" | "slut", av: string[], tabell: "onboarding_task" | "offboarding_task", sortFran: number, fpFore?: FyllPerson) => {
    const { data } = await db.from("onboarding_rule").select("id, name, recipient_id, roles, trigger, due_offset, remind_days, ask_for, subject, body, active").eq("trigger", trigger).eq("active", true);
    const fp = fpFore ? { ...fpFore, slut: p.end_date } : await fyllFor(p);
    const roller = fp.roller;
    const regler = ((data ?? []) as unknown as Regel[]).filter((r) => !av.includes(r.id) && r.recipient_id && (!r.roles || !r.roles.length || r.roles.some((x) => roller.includes(x))));
    const rader: Record<string, unknown>[] = [];
    for (const [i, r] of regler.entries()) {
      const mott = await namnFor(r.recipient_id);
      rader.push({
        employee_id: p.id, label: r.name, sort: sortFran + i, kind: "regel", owner: "person", owner_id: r.recipient_id, self_owned: r.recipient_id === mig,
        rule_id: r.id, offset_days: r.due_offset, sent_on: idag, remind_days: r.remind_days, ask_for: r.ask_for, created_on: idag,
        mail_subject: fyll(r.subject, fp, mott?.namn ?? "", jagNamn), mail_body: fyll(r.body, fp, mott?.namn ?? "", jagNamn),
      });
    }
    if (!rader.length) return 0;
    const { data: nya } = await db.from(tabell).insert(rader).select("id, owner_id, self_owned, mail_subject, mail_body, offset_days, created_on, sent_on, kind, due_date, offset_special");
    let mejl = 0;
    for (const n of (nya ?? []) as unknown as { id: string; owner_id: string; self_owned: boolean; mail_subject: string; mail_body: string; offset_days: number; created_on: string; sent_on: string; kind: string; due_date: string | null; offset_special: string | null }[]) {
      if (n.self_owned) continue;
      const mott = await namnFor(n.owner_id);
      if (!mott?.epost) continue;
      const due = frist({ bas: trigger === "slut" ? p.end_date : p.start_date, skapad: n.sent_on, off: n.offset_days, spec: null, flyttad: null });
      await mejla(mott.epost, n.mail_subject, n.mail_body, n.id, due);
      await notifiera({ till: n.owner_id, av: mig, kalla: "personal-uppdrag", typ: "uppgift", rubrik: n.mail_subject, detalj: `Klart senast ${due}`, href: `/nav2/anstallda/klart?id=${n.id}`, objekt: { typ: "employee", id: p.id } });
      mejl++;
    }
    return mejl;
  };
  /** Mallens punkter för en person, med villkoren prövade. */
  const mallPunkter = async (mallId: string, p: { employment_type: string }, tredje: boolean): Promise<MallPunkt[]> => {
    const { data } = await db.from("onboarding_template_item").select("key, label, offset_days, offset_special, kind, law_ref, condition, owner, owner_id, sort").eq("template_id", mallId).order("sort");
    return ((data ?? []) as unknown as MallPunkt[]).filter((x) => !x.condition || (x.condition === "tredje" ? tredje : x.condition === "prov" ? p.employment_type === "probation" : true));
  };
  const somRad = (x: MallPunkt, pid: string, sort: number) => ({
    employee_id: pid, label: x.label, sort, item_key: x.key, kind: x.kind, offset_days: x.offset_days, offset_special: x.offset_special,
    law_ref: x.law_ref, condition: x.condition, owner: x.owner, owner_id: x.owner_id, created_on: idag,
  });
  /** Den effektiva behörigheten: satt för hand, annars ur befattningen. */
  const niva = async (pid: string): Promise<Niva> => {
    const [{ data: satt }, { data: r }] = await Promise.all([
      db.from("employee_access_level").select("level").eq("employee_id", pid).maybeSingle(),
      db.from("employee_role").select("role").eq("employee_id", pid),
    ]);
    return ((satt as { level: Niva } | null)?.level ?? nivaFor(((r ?? []) as unknown as { role: string }[]).map((x) => x.role)));
  };

  /**
   * Beställaren 2026-10-20 (A3): inga utskicksregler än. I stället får de andra superadminerna en notis i Nav
   * när någon läggs upp eller avslutas (`personal-anstallning`). Rekryteringens anställning gör likadant.
   */
  const meddelaSuperadmin = async (rubrik: string, detalj: string, pid: string, utom: string[] = []) => {
    const [{ data: r }, { data: satt }] = await Promise.all([
      db.from("employee_role").select("employee_id").in("role", ["admin", "ceo"]),
      db.from("employee_access_level").select("employee_id").eq("level", "superadmin"),
    ]);
    const kandidater = [...new Set([...(r ?? []), ...(satt ?? [])].map((x) => (x as { employee_id: string }).employee_id))].filter((id) => id !== mig && !utom.includes(id));
    if (!kandidater.length) return;
    const { data: aktiva } = await db.from("employee").select("id").in("id", kandidater).neq("status", "offboarded");
    const till: string[] = [];
    for (const a of (aktiva ?? []) as { id: string }[]) if ((await niva(a.id)) === "superadmin") till.push(a.id);
    await notifieraFlera(till, { av: mig, kalla: "personal-anstallning", typ: "konto", rubrik, detalj, href: `/personal/${pid}`, objekt: { typ: "employee", id: pid } });
  };

  /** Allt efter kontot, för en person som just lagts upp. Null om personen inte går att läsa tillbaka. */
  const startaListan = async (pid: string, o: Start): Promise<{ p: Person; mejl: number } | null> => {
    if (o.chefId) {
      const f = new FormData();
      f.set("employee_id", pid);
      f.set("team_id", o.teamId ?? "");
      f.set("manager_id", o.chefId);
      try {
        await sattOrganisation(f);
      } catch {
        // Som förut: chefen sätts om det går, och personen är upplagd ändå.
      }
    }
    // Utan vald mall: mallen för personens befattning, som utkastets aeMallFor.
    let mallId = o.mallId;
    if (!mallId) {
      const { data } = await db.from("onboarding_template").select("id, roles").eq("is_exit", false).order("sort");
      const mallar = (data ?? []) as unknown as { id: string; roles: string[] }[];
      mallId = (mallar.find((m) => (m.roles ?? []).includes(o.roll)) ?? mallar[0])?.id ?? null;
    }
    await db.from("employee_onboarding").upsert({ employee_id: pid, template_id: mallId, private_email: o.privat || null, phone: o.tel || null, third_country: o.tredje, updated_by: mig });
    const p = await personen(pid);
    if (!p) return null;
    const punkter = mallId ? (await mallPunkter(mallId, p, o.tredje)).filter((x) => !o.bort.includes(x.key)) : [];
    const nu = new Date().toISOString();
    const rader = [
      ...punkter.map((x, i) => ({ ...somRad(x, pid, i), ...(x.kind === "konto" ? { state: "done", handled_by: mig, handled_at: nu } : {}) })),
      ...o.extra.map((x, i) => ({ employee_id: pid, label: x.t, sort: punkter.length + i, kind: "vanlig", offset_days: x.off, created_on: idag })),
    ];
    if (rader.length) await db.from("onboarding_task").insert(rader);
    const mejl = await regelPunkter(p, "start", o.regAv, "onboarding_task", rader.length);
    const borjar = p.start_date ? ` · börjar ${p.start_date}` : "";
    if (o.chefId && o.chefId !== mig)
      await notifiera({ till: o.chefId, av: mig, kalla: "personal-uppdrag", typ: "uppgift", rubrik: `${namnPa(p)} är upplagd i navet`, detalj: `Du är närmaste chef${borjar}`, href: "/nav2", objekt: { typ: "employee", id: pid } });
    await meddelaSuperadmin(`${namnPa(p)} är upplagd i navet`, `${jagNamn} lade upp${borjar}`, pid, o.utom);
    await logga(pid, `startade checklistan${mejl ? ` och ${mejl} mejl gick ut` : ""}.`);
    return { p, mejl };
  };

  return { personen, namnFor, logga, fyllFor, klartLank, mejla, regelPunkter, mallPunkter, somRad, niva, meddelaSuperadmin, startaListan };
}
