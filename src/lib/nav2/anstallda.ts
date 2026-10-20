import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { canReadAllEmployees, hasRole, type CurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { riktarSigTill } from "@/lib/dokument";
import { heltNamn, nivaFor, type Niva } from "./forma";
import {
  formaHandelse,
  formaLista,
  formaMall,
  formaRegel,
  PUNKTKOLUMNER,
  type NdAeLista,
  type NdAeLogg,
  type NdAeMall,
  type NdAeRegel,
  type RaHandelse,
  type RaMall,
  type RaMallPunkt,
  type RaPunkt,
  type RaRegel,
} from "./anstalldaforma";

/**
 * Nav 2.0: Anställda i utkastets former.
 *
 * ===========================================================================
 * LÄSES MED ANVÄNDARENS TOKEN. Allt nytt i 0105 släpps in av samma regel som
 * navets checklistor: can_read_all_employees() (säljchef, VD, admin). Registret
 * själv kommer redan med `ND.personer`. Säljaren får inget här och ser
 * utkastets "inget för dig".
 *
 * Service role används för fyra saker, och bara för den som redan får läsa
 * hela personalen:
 *   - kursernas och rutinernas framsteg per person (modulerna och
 *     kvittenserna läses annars bara av personen själv),
 *   - Lynes-användaren ur phone_identity (RLS släpper bara säljchef och VD),
 *   - om personen har en övning i Coachning,
 *   - flaggan för oanvända konton (inactive_flagged_at, kontojobbet).
 * ===========================================================================
 */

export type NdAePers = {
  privat: string;
  tel: string;
  tredje: boolean;
  fadder: string | null;
  fadderId: string | null;
  traff: number;
  /** Tillfälliga lösenordet bytt efter att det senast sattes. */
  losen: boolean;
  lynes: string;
  /** [titel, klara moduler, alla moduler] per kurs målgruppen ger. */
  kurser: [string, number, number][] | null;
  /** [kvitterade, alla] av de obligatoriska rutinerna. */
  rutiner: [number, number] | null;
  /** Gamla Nav C: de obligatoriska rutinerna (rollen och teamet), som /personal/[id]. */
  rutinLista: { titel: string; slug: string; klar: boolean }[] | null;
  /** Gamla Nav C: särskild behörighet (`employee_permission`), läst med RLS: säljchef och VD ser den. */
  behorigheter: string[];
  /** Kontojobbets flagga (45 dagar utan inloggning). */
  flaggad: string | null;
  coach: boolean;
  lista: NdAeLista | null;
  avslut: NdAeLista | null;
  valkomst: { tid: string; plats: string; rad: string } | null;
  valkSkickad: string | null;
  valkTill: string | null;
  /** Behörighet i Nav satt för hand (0105). Null = räknas ur befattningen. */
  nivaSatt: Niva | null;
  /**
   * Avtalets läge ur `contract`, för checklistans avtalspunkter. Avtal (ndma.js)
   * skriver över det med hela avtalet när den vyn är kopplad. Ett uppladdat
   * avtal är påskrivet (0073); ett utfärdat mallavtal väntar på påskrift.
   */
  avtal: { st: "utkast" | "utfardat" | "signerat"; utf: string | null; sign: string | null; mall: string; id: string; kalla: "mall" | "fil" } | null;
};

export type NdAnstallda = {
  far: boolean;
  /** Får skriva i personalen (navets canManageEmployees). */
  hantera: boolean;
  /** Gamla Nav C: får dela ut särskild behörighet (repots andraBehorighet: säljchef och VD, AC-13.13). */
  farBehorighet: boolean;
  /** 0105 gick inte att läsa. */
  utan0105: boolean;
  team: { id: string; namn: string; ledare: string | null; ledareId: string | null }[];
  mallar: NdAeMall[];
  regler: NdAeRegel[];
  per: Record<string, NdAePers>;
  logg: NdAeLogg[];
};

const TOM: NdAnstallda = { far: false, hantera: false, farBehorighet: false, utan0105: false, team: [], mallar: [], regler: [], per: {}, logg: [] };

type RaPers = {
  id: string; first_name: string; last_name: string; email: string; status: string; start_date: string | null; end_date: string | null;
  team_id: string | null; inactive_flagged_at: string | null; created_at: string;
  employee_role: { role: string }[] | null;
};
type RaOnb = {
  employee_id: string; template_id: string | null; mentor_id: string | null; mentor_meetings: number; private_email: string | null; phone: string | null;
  third_country: boolean; welcome: { tid?: string; plats?: string; rad?: string } | null; welcome_sent_at: string | null; welcome_sent_to: string | null;
};

export async function byggAnstallda(supabase: SupabaseClient, user: CurrentUser): Promise<NdAnstallda> {
  if (!user.employee || !canReadAllEmployees(user)) return TOM;
  const jag = user.employee.id;
  const admin = supabaseAdmin();

  const [
    { data: persRader },
    { data: teamRader },
    { data: mallRader, error: mallFel },
    { data: mallPunkter },
    { data: regelRader },
    { data: onRader },
    { data: offRader },
    { data: onbRader },
    { data: nivaRader },
    { data: handelser },
    { data: byten },
    { data: avtalRader },
    { data: behRader },
  ] = await Promise.all([
    supabase.from("employee").select("id, first_name, last_name, email, status, start_date, end_date, team_id, inactive_flagged_at, created_at, employee_role!employee_role_employee_id_fkey(role)"),
    supabase.from("team").select("id, name, lead_id").order("name"),
    supabase.from("onboarding_template").select("id, name, roles, is_exit, sort").order("sort"),
    supabase.from("onboarding_template_item").select("id, template_id, key, label, offset_days, offset_special, kind, law_ref, condition, owner, owner_id, sort").order("sort"),
    supabase.from("onboarding_rule").select("id, name, recipient_id, roles, trigger, due_offset, remind_days, ask_for, subject, body, active, sort").order("sort").order("created_at"),
    supabase.from("onboarding_task").select(PUNKTKOLUMNER).order("sort"),
    supabase.from("offboarding_task").select(PUNKTKOLUMNER).order("sort"),
    supabase.from("employee_onboarding").select("employee_id, template_id, mentor_id, mentor_meetings, private_email, phone, third_country, welcome, welcome_sent_at, welcome_sent_to"),
    supabase.from("employee_access_level").select("employee_id, level"),
    supabase
      .from("audit_log")
      .select("actor_id, action, object_type, object_id, ts, reason, meta")
      .in("object_type", ["employee", "onboarding_task", "offboarding_task"])
      .order("ts", { ascending: false })
      .limit(4000),
    supabase
      .from("audit_log")
      .select("actor_id, action, object_type, object_id, ts, reason, meta")
      .eq("action", "auth.password_changed")
      .order("ts", { ascending: false })
      .limit(1000),
    supabase.from("contract").select("id, employee_id, title, status, source, issued_at, created_at").neq("status", "withdrawn").order("created_at", { ascending: false }),
    supabase.from("employee_permission").select("employee_id, permission"),
  ]);

  const pers = (persRader ?? []) as unknown as RaPers[];
  const namn = new Map(pers.map((p) => [p.id, heltNamn(p.first_name, p.last_name)]));
  const teamNamn = new Map(((teamRader ?? []) as unknown as { id: string; name: string }[]).map((t) => [t.id, t.name]));
  const ids = pers.map((p) => p.id);
  const roller = new Map(pers.map((p) => [p.id, (p.employee_role ?? []).map((r) => r.role)]));

  const mallar = ((mallRader ?? []) as unknown as RaMall[]).map((m) => formaMall(m, (mallPunkter ?? []) as unknown as RaMallPunkt[], namn));
  const regler = ((regelRader ?? []) as unknown as RaRegel[]).map((r) => formaRegel(r, namn));
  const onb = new Map(((onbRader ?? []) as unknown as RaOnb[]).map((o) => [o.employee_id, o]));
  const nivaer = new Map(((nivaRader ?? []) as unknown as { employee_id: string; level: Niva }[]).map((n) => [n.employee_id, n.level]));
  const on = (onRader ?? []) as unknown as RaPunkt[];
  const off = (offRader ?? []) as unknown as RaPunkt[];

  // ---------------------------------------------------------------- Det service role läser (se rubriken)
  const iListan = pers.filter((p) => p.status !== "offboarded").map((p) => p.id);
  const [{ data: lynesRader }, { data: coachRader }, { data: dok }, { data: ack }, { data: kurser }, { data: moduler }, { data: framsteg }] = await Promise.all([
    admin.from("phone_identity").select("employee_id, value").eq("kind", "lynes_user").in("employee_id", ids.length ? ids : [jag]),
    admin.from("coaching_task").select("assignee_id").is("cancelled_at", null).in("assignee_id", iListan.length ? iListan : [jag]),
    admin.from("document").select("id, title, slug, version, audience_roles, audience_teams").eq("status", "published").eq("requires_ack", true),
    admin.from("document_ack").select("employee_id, document_id, version").in("employee_id", iListan.length ? iListan : [jag]),
    admin.from("course").select("id, title, audience_roles").eq("status", "published").order("title"),
    admin.from("course_module").select("id, course_id"),
    admin.from("module_progress").select("employee_id, module_id").in("employee_id", iListan.length ? iListan : [jag]),
  ]);
  const behPer = new Map<string, string[]>();
  for (const b of (behRader ?? []) as unknown as { employee_id: string; permission: string }[]) behPer.set(b.employee_id, [...(behPer.get(b.employee_id) ?? []), b.permission]);
  const lynes = new Map(((lynesRader ?? []) as unknown as { employee_id: string; value: string }[]).map((r) => [r.employee_id, r.value]));
  const iCoach = new Set(((coachRader ?? []) as unknown as { assignee_id: string }[]).map((r) => r.assignee_id));
  const kvitterat = new Set(((ack ?? []) as unknown as { employee_id: string; document_id: string; version: number }[]).map((a) => `${a.employee_id}:${a.document_id}:${a.version}`));
  const modPerKurs = new Map<string, string[]>();
  for (const m of (moduler ?? []) as unknown as { id: string; course_id: string }[]) modPerKurs.set(m.course_id, [...(modPerKurs.get(m.course_id) ?? []), m.id]);
  const klaraMod = new Set(((framsteg ?? []) as unknown as { employee_id: string; module_id: string }[]).map((f) => `${f.employee_id}:${f.module_id}`));

  // Lösenordet: bytt efter att ett tillfälligt senast sattes.
  const h = [...((handelser ?? []) as unknown as RaHandelse[]), ...((byten ?? []) as unknown as RaHandelse[])];
  const satt = new Map<string, string>(), bytt = new Map<string, string>();
  for (const x of h) {
    if (x.action === "auth.temp_password_set" && x.object_id && !satt.has(x.object_id)) satt.set(x.object_id, x.ts);
    if (x.action === "auth.password_changed" && x.actor_id && !bytt.has(x.actor_id)) bytt.set(x.actor_id, x.ts);
  }

  // Det senaste avtalet per person som inte dragits tillbaka. RLS (contract_read) släpper bara den som hanterar avtal.
  const avtalPer = new Map<string, NdAePers["avtal"]>();
  for (const a of (avtalRader ?? []) as unknown as { id: string; employee_id: string; title: string; status: string; source: string; issued_at: string | null; created_at: string }[]) {
    if (avtalPer.has(a.employee_id)) continue;
    const fil = a.source === "upload";
    avtalPer.set(a.employee_id, {
      st: a.status === "draft" ? "utkast" : fil ? "signerat" : "utfardat",
      utf: a.issued_at ? a.issued_at.slice(0, 10) : null,
      sign: fil && a.issued_at ? a.issued_at.slice(0, 10) : null,
      mall: a.title,
      id: a.id,
      kalla: fil ? "fil" : "mall",
    });
  }

  const per: Record<string, NdAePers> = {};
  for (const p of pers) {
    const o = onb.get(p.id);
    const r = roller.get(p.id) ?? [];
    const egnaOn = on.filter((x) => x.employee_id === p.id);
    const egnaOff = off.filter((x) => x.employee_id === p.id);
    const mallId = o?.template_id ?? null;
    const lista = formaLista(egnaOn, p.start_date, mallar.find((m) => m.id === mallId) ?? mallar.find((m) => !m.slut && m.roller.some((x) => r.includes(x))) ?? null, namn, mallId);
    const avslut = formaLista(egnaOff, p.end_date, mallar.find((m) => m.slut) ?? null, namn, mallar.find((m) => m.slut)?.id ?? null);
    const rutinDok = ((dok ?? []) as unknown as { id: string; title: string; slug: string; version: number; audience_roles: string[] | null; audience_teams: string[] | null }[]).filter((d) => riktarSigTill(d, r, p.team_id));
    const kurslista = ((kurser ?? []) as unknown as { id: string; title: string; audience_roles: string[] | null }[]).filter((k) =>
      riktarSigTill({ audience_roles: k.audience_roles, audience_teams: [] }, r, p.team_id),
    );
    const aktiv = p.status !== "offboarded";
    per[p.id] = {
      privat: o?.private_email ?? "",
      tel: o?.phone ?? "",
      tredje: o?.third_country ?? false,
      fadder: o?.mentor_id ? (namn.get(o.mentor_id) ?? null) : null,
      fadderId: o?.mentor_id ?? null,
      traff: o?.mentor_meetings ?? 0,
      losen: !satt.has(p.id) || (bytt.get(p.id) ?? "") > (satt.get(p.id) ?? ""),
      lynes: lynes.get(p.id) ?? "",
      kurser: aktiv ? kurslista.map((k): [string, number, number] => {
        const m = modPerKurs.get(k.id) ?? [];
        return [k.title, m.filter((id) => klaraMod.has(`${p.id}:${id}`)).length, m.length];
      }) : null,
      rutiner: aktiv ? [rutinDok.filter((d) => kvitterat.has(`${p.id}:${d.id}:${d.version}`)).length, rutinDok.length] : null,
      rutinLista: aktiv ? rutinDok.map((d) => ({ titel: d.title, slug: d.slug, klar: kvitterat.has(`${p.id}:${d.id}:${d.version}`) })).sort((a, b) => Number(a.klar) - Number(b.klar) || a.titel.localeCompare(b.titel, "sv")) : null,
      behorigheter: behPer.get(p.id) ?? [],
      flaggad: p.inactive_flagged_at ? p.inactive_flagged_at.slice(0, 10) : null,
      coach: iCoach.has(p.id),
      lista,
      avslut,
      valkomst: o?.welcome ? { tid: o.welcome.tid ?? "", plats: o.welcome.plats ?? "", rad: o.welcome.rad ?? "" } : null,
      valkSkickad: o?.welcome_sent_at ? o.welcome_sent_at.slice(0, 10) : null,
      valkTill: o?.welcome_sent_to ?? null,
      nivaSatt: nivaer.get(p.id) ?? null,
      avtal: avtalPer.get(p.id) ?? null,
    };
  }

  // ---------------------------------------------------------------- Historiken per person
  const punktAv = new Map([...on, ...off].map((x) => [x.id, x]));
  const synliga = new Set(ids);
  const logg: NdAeLogg[] = [];
  for (const x of h) {
    let pid: string | null = null, punkt = "";
    if (x.object_type === "onboarding_task" || x.object_type === "offboarding_task") {
      const t = x.object_id ? punktAv.get(x.object_id) : undefined;
      pid = t?.employee_id ?? (typeof x.meta?.employeeId === "string" ? x.meta.employeeId : null);
      punkt = t?.label ?? "";
    } else if (x.object_type === "auth") pid = x.action === "auth.password_changed" ? x.actor_id : null;
    else pid = x.object_id;
    if (!pid || !synliga.has(pid)) continue;
    const l = formaHandelse(x, pid, namn, jag, teamNamn, punkt);
    if (l) logg.push(l);
  }
  logg.sort((a, b) => (a.d + a.tid).localeCompare(b.d + b.tid));

  return {
    far: true,
    // Beställaren 2026-10-19: bara superadmin ändrar i personalen. Nivån som rutten räknar den.
    hantera: (nivaer.get(jag) ?? nivaFor(user.roles)) === "superadmin",
    farBehorighet: hasRole(user, "sales_manager", "ceo"),
    utan0105: Boolean(mallFel),
    team: ((teamRader ?? []) as unknown as { id: string; name: string; lead_id: string | null }[]).map((t) => ({
      id: t.id,
      namn: t.name,
      ledare: t.lead_id ? (namn.get(t.lead_id) ?? null) : null,
      ledareId: t.lead_id,
    })),
    mallar,
    regler,
    per,
    logg,
  };
}
