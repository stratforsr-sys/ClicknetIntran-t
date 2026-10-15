import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { fullName, hasRole, type CurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { svensktDatum } from "@/lib/klocka";
import { franMarkdown } from "./rutinformat";

/**
 * Nav 2.0: Rutiner, med samma dokument och samma behörighet som /rutiner.
 *
 * Dokumenten läses med den inloggades token (RLS: publicerat och i
 * målgruppen, eller eget, eller redaktör). Innehållet tolkas ur `body_md`
 * (`rutinformat.ts`); en text utan den fasta formen visas som den är.
 *
 * Det nya (0095) läses här: sparade, anteckningar, bevakningar, "loggat som
 * gjort", återkopplingen och veckans rutin. Antal (läsare i månaden, hur många
 * som tyckte att en rutin hjälpte, hur många som kvitterat) räknas med service
 * role, eftersom de är summor och inte rader om någon.
 */

export type NdRutin = {
  id: string;
  dokId: string;
  t: string;
  typ: string;
  status: string;
  omr: string;
  kat: string;
  resa: number | null;
  nar: string;
  tid: string;
  vem: string;
  tldr: string;
  steg: [string, string, boolean?][];
  klart: string[];
  fel: [string, string][];
  md: string;
  form: boolean;
  rel: string[];
  syn: string[];
  uppg: [string, number][] | null;
  ny: boolean;
  agare: string;
  agareId: string;
  granskad: string;
  nasta: string;
  v: number;
  nytt: string | null;
  nyRutin: boolean;
  lasare: number;
  kvitt: boolean;
  acked: boolean;
  sett: boolean;
  settV: number;
  hjalpt: number;
  versioner: { v: number; d: string; not: string }[];
  kvittGrad: [number, number] | null;
  saknar: string[];
  audienceRoles: string[];
  audienceTeams: string[];
  kategoriSokvag: string;
};

export type NdRutiner = {
  rutiner: NdRutin[];
  redaktor: boolean;
  sparade: string[];
  anteckningar: Record<string, string>;
  bevakar: string[];
  loggatIdag: string[];
  veckans: string | null;
  aterkoppling: { id: string; rutin: string; text: string; vem: string }[];
  svar: Record<string, { vem: string; text: string }>;
  utkast: { id: string; andrad: string; rutin: NdRutin }[];
  arkiv: { id: string; t: string; omr: string }[];
  agare: { id: string; namn: string }[];
  uppdaterat: [string, string][];
  /** 0096: mest lästa de senaste 30 dagarna, i ditt team och i bolaget, och trenden mot 30 dagar innan. */
  populart: { team: string[]; bolag: string[] };
  trend: Record<string, "upp" | "ned" | "lika">;
  /** Rutiner ingen läst på 90 dagar (för förvaltningen). */
  olast: string[];
  /** Sökningar utan träff, utan namn (för förvaltningen): [fråga, antal]. */
  missar: [string, number][];
  /** Dina senaste sökningar. */
  sokningar: string[];
};

const OMRADEN: Record<string, string> = {
  "försäljning": "salj",
  "kund och leverans": "kund",
  "personal och samarbete": "pers",
  hr: "pers",
  "arbetsmiljö": "miljo",
  "administration och system": "adm",
};
const MAN = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const kortDatum = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = svensktDatum(iso);
  return `${Number(d.slice(8, 10))} ${MAN[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
};

type Meta = { omr?: string; kat?: string; resa?: number; syn?: string[]; rel?: string[]; uppg?: [string, number][]; ny?: boolean };
type Dok = {
  id: string;
  title: string;
  slug: string;
  category_path: string;
  body_md: string;
  owner_id: string;
  review_due: string;
  version: number;
  status: string;
  audience_roles: string[] | null;
  audience_teams: string[] | null;
  audience_employees: string[] | null;
  requires_ack: boolean;
  doc_type: string;
  published_at: string | null;
  updated_at: string;
  routine_meta: Meta | null;
};

export async function byggRutiner(supabase: SupabaseClient, user: CurrentUser): Promise<NdRutiner> {
  const mig = user.employee!.id;
  const redaktor = hasRole(user, "sales_manager", "admin");
  const admin = supabaseAdmin();
  const idag = svensktDatum();
  const manadStart = `${idag.slice(0, 8)}01`;

  const [{ data: doks }, { data: mina }, { data: kvitton }, { data: sparade }, { data: noter }, { data: bevakar }, { data: korda }, { data: veckans }, { data: fb }, { data: personal }, { data: roller }] = await Promise.all([
    supabase
      .from("document")
      .select("id, title, slug, category_path, body_md, owner_id, review_due, version, status, audience_roles, audience_teams, audience_employees, requires_ack, doc_type, published_at, updated_at, routine_meta")
      .order("title"),
    supabase.from("document_view").select("document_id, last_seen").eq("employee_id", mig),
    supabase.from("document_ack").select("document_id, version").eq("employee_id", mig),
    supabase.from("document_saved").select("document_id").eq("employee_id", mig),
    supabase.from("document_note").select("document_id, text").eq("employee_id", mig),
    supabase.from("document_area_watch").select("area").eq("employee_id", mig),
    supabase.from("document_run").select("document_id").eq("employee_id", mig).gte("ran_at", new Date(`${idag}T00:00:00+02:00`).toISOString()),
    supabase.from("nav_setting").select("value").eq("key", "rutiner.veckans").maybeSingle(),
    supabase.from("document_feedback").select("id, document_id, employee_id, helped, reason, text, created_at, answer, answered_by, answered_at").order("created_at", { ascending: false }).limit(200),
    admin.from("employee").select("id, first_name, last_name, team_id, status"),
    admin.from("employee_role").select("employee_id, role"),
  ]);
  const [{ data: loggen }, { data: missRader }, { data: sokPref }] = await Promise.all([
    admin.from("document_view_log").select("document_id, employee_id, viewed_at").gte("viewed_at", new Date(Date.now() - 90 * 86400000).toISOString()).limit(20000),
    redaktor ? admin.from("document_search_miss").select("query").gte("searched_at", new Date(Date.now() - 90 * 86400000).toISOString()).limit(5000) : Promise.resolve({ data: [] as { query: string }[] }),
    supabase.from("nav_preference").select("value").eq("employee_id", mig).eq("key", "rutiner.sok").maybeSingle(),
  ]);

  const dokRader = (doks ?? []) as Dok[];
  const ids = dokRader.map((d) => d.id);
  const [{ data: versioner }, { data: visningar }, { data: hjalpt }, { data: allaKvitton }, { data: granskningar }] = ids.length
    ? await Promise.all([
        supabase.from("document_version").select("document_id, version, body_md, changed_at, change_note").in("document_id", ids).order("version", { ascending: false }),
        Promise.resolve({ data: ((loggen ?? []) as { document_id: string; viewed_at: string }[]).filter((v) => svensktDatum(v.viewed_at) >= manadStart) }),
        admin.from("document_feedback").select("document_id").in("document_id", ids).eq("helped", true),
        redaktor ? admin.from("document_ack").select("document_id, version, employee_id").in("document_id", ids) : Promise.resolve({ data: [] as { document_id: string; version: number; employee_id: string }[] }),
        admin.from("audit_log").select("object_id, created_at").eq("action", "document.reviewed").in("object_id", ids).order("created_at", { ascending: false }),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }];

  const pers = (personal ?? []) as { id: string; first_name: string; last_name: string; team_id: string | null; status: string }[];
  const namn = new Map(pers.map((p) => [p.id, fullName(p)]));
  const aktiva = pers.filter((p) => p.status !== "offboarded");
  const rollerPer = new Map<string, Set<string>>();
  for (const r of roller ?? []) rollerPer.set(r.employee_id as string, new Set([...(rollerPer.get(r.employee_id as string) ?? []), r.role as string]));
  const settMap = new Map((mina ?? []).map((v) => [v.document_id as string, v.last_seen as string]));
  const kvittMap = new Set((kvitton ?? []).map((k) => `${k.document_id}|${k.version}`));
  const versPer = new Map<string, { version: number; body_md: string; changed_at: string; change_note: string | null }[]>();
  for (const v of (versioner ?? []) as { document_id: string; version: number; body_md: string; changed_at: string; change_note: string | null }[])
    versPer.set(v.document_id, [...(versPer.get(v.document_id) ?? []), v]);
  const raknaPer = (rader: { document_id: string }[] | null) => {
    const m = new Map<string, number>();
    for (const r of rader ?? []) m.set(r.document_id, (m.get(r.document_id) ?? 0) + 1);
    return m;
  };
  const lasare = raknaPer(visningar as { document_id: string }[] | null);
  const hjalptPer = raknaPer(hjalpt as { document_id: string }[] | null);
  const granskadPer = new Map<string, string>();
  for (const g of (granskningar ?? []) as { object_id: string; created_at: string }[]) if (!granskadPer.has(g.object_id as string)) granskadPer.set(g.object_id as string, g.created_at as string);

  // Målgruppen som matches_audience: tomma listor betyder alla.
  const iMalgrupp = (d: Dok, p: { id: string; team_id: string | null }) => {
    if ((d.audience_employees ?? []).length && (d.audience_employees ?? []).includes(p.id)) return true;
    const r = d.audience_roles ?? [], t = d.audience_teams ?? [];
    if ((d.audience_employees ?? []).length && !r.length && !t.length) return false;
    const rollOk = !r.length || [...(rollerPer.get(p.id) ?? [])].some((x) => r.includes(x));
    const teamOk = !t.length || (p.team_id !== null && t.includes(p.team_id));
    return rollOk && teamOk;
  };

  const forma = (d: Dok): NdRutin => {
    const meta = (d.routine_meta ?? {}) as Meta;
    const f = franMarkdown(d.body_md);
    const vs = versPer.get(d.id) ?? [];
    const nu = vs.find((v) => v.version === d.version);
    const forra = vs.find((v) => v.version === d.version - 1);
    // Steg som inte fanns i förra versionen märks "Nytt i version N".
    const forraSteg = forra ? new Set(franMarkdown(forra.body_md).steg.map(([r]) => r)) : null;
    const delar = d.category_path.split("/").map((x) => x.trim()).filter(Boolean);
    const omr = meta.omr ?? OMRADEN[(delar[0] ?? "").toLowerCase()] ?? "adm";
    const sett = settMap.get(d.id);
    const kvitterade = redaktor && d.requires_ack ? new Set(((allaKvitton ?? []) as { document_id: string; version: number; employee_id: string }[]).filter((k) => k.document_id === d.id && k.version === d.version).map((k) => k.employee_id as string)) : null;
    const malgrupp = kvitterade ? aktiva.filter((p) => iMalgrupp(d, p)) : [];
    return {
      id: d.slug,
      dokId: d.id,
      t: d.title,
      typ: d.doc_type,
      status: d.status,
      omr,
      kat: meta.kat ?? delar[delar.length - 1] ?? "",
      resa: meta.resa ?? null,
      nar: f.nar,
      tid: f.tid,
      vem: f.vem,
      tldr: f.tldr,
      steg: f.steg.map(([r, t]): [string, string, boolean?] => (forraSteg && !forraSteg.has(r) ? [r, t, true] : [r, t])),
      klart: f.klart,
      fel: f.fel,
      md: f.md,
      form: f.form,
      rel: meta.rel ?? [],
      syn: meta.syn ?? [],
      uppg: meta.uppg?.length ? meta.uppg : null,
      ny: !!meta.ny,
      agare: namn.get(d.owner_id) ?? "Okänd",
      agareId: d.owner_id,
      granskad: kortDatum(granskadPer.get(d.id) ?? d.published_at ?? d.updated_at),
      nasta: d.review_due,
      v: d.version,
      nytt: nu?.change_note ?? null,
      nyRutin: !!d.published_at && Date.now() - Date.parse(d.published_at) < 30 * 86400000 && d.version === 1,
      lasare: lasare.get(d.id) ?? 0,
      kvitt: d.requires_ack,
      acked: kvittMap.has(`${d.id}|${d.version}`),
      sett: !!sett,
      settV: !sett ? 0 : !nu || sett >= nu.changed_at ? d.version : Math.max(1, d.version - 1),
      hjalpt: hjalptPer.get(d.id) ?? 0,
      versioner: vs.map((v) => ({ v: v.version, d: kortDatum(v.changed_at), not: v.change_note ?? (v.version === 1 ? "Första versionen" : "") })),
      kvittGrad: kvitterade ? ([malgrupp.filter((p) => kvitterade.has(p.id)).length, malgrupp.length] as [number, number]) : null,
      saknar: kvitterade ? malgrupp.filter((p) => !kvitterade.has(p.id)).map((p) => namn.get(p.id)!) : [],
      audienceRoles: d.audience_roles ?? [],
      audienceTeams: d.audience_teams ?? [],
      kategoriSokvag: d.category_path,
    };
  };

  const formade = dokRader.map(forma);
  const publicerade = formade.filter((r) => r.status === "published");
  const egna = new Set(dokRader.filter((d) => d.owner_id === mig).map((d) => d.id));
  const slugFor = new Map(formade.map((r) => [r.dokId, r.id]));

  const feedback = (fb ?? []) as { id: string; document_id: string; employee_id: string; helped: boolean; reason: string | null; text: string | null; created_at: string; answer: string | null; answered_by: string | null; answered_at: string | null }[];
  const svar: NdRutiner["svar"] = {};
  for (const x of feedback) {
    const s = slugFor.get(x.document_id);
    if (s && x.answer && x.employee_id === mig && !svar[s]) svar[s] = { vem: (namn.get(x.answered_by ?? "") ?? "Ägaren").split(" ")[0], text: x.answer };
  }

  // Mest lästa och trenden, ur visningsloggen (0096).
  const logg = (loggen ?? []) as { document_id: string; employee_id: string; viewed_at: string }[];
  const mittTeam = pers.find((p) => p.id === mig)?.team_id ?? null;
  const teamet = new Set(pers.filter((p) => mittTeam && p.team_id === mittTeam).map((p) => p.id));
  const grans30 = Date.now() - 30 * 86400000, grans60 = Date.now() - 60 * 86400000;
  const topp = (rader: typeof logg) => {
    const m = new Map<string, number>();
    for (const v of rader) m.set(v.document_id, (m.get(v.document_id) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => slugFor.get(id)).filter((x): x is string => !!x && publicerade.some((r) => r.id === x)).slice(0, 5);
  };
  const senaste30 = logg.filter((v) => Date.parse(v.viewed_at) >= grans30);
  const trend: Record<string, "upp" | "ned" | "lika"> = {};
  for (const r of publicerade) {
    const a = senaste30.filter((v) => v.document_id === r.dokId).length;
    const b = logg.filter((v) => v.document_id === r.dokId && Date.parse(v.viewed_at) >= grans60 && Date.parse(v.viewed_at) < grans30).length;
    if (a || b) trend[r.id] = a > b * 1.2 ? "upp" : a < b * 0.8 ? "ned" : "lika";
  }
  const lastaNyligen = new Set(logg.map((v) => v.document_id));
  const missar = new Map<string, number>();
  for (const m of (missRader ?? []) as { query: string }[]) {
    const q = m.query.trim().toLowerCase();
    missar.set(q, (missar.get(q) ?? 0) + 1);
  }

  return {
    rutiner: publicerade,
    redaktor,
    sparade: (sparade ?? []).map((s) => slugFor.get(s.document_id as string)).filter((x): x is string => !!x),
    anteckningar: Object.fromEntries((noter ?? []).map((n) => [slugFor.get(n.document_id as string) ?? "", n.text as string]).filter(([k]) => k)),
    bevakar: (bevakar ?? []).map((b) => b.area as string),
    loggatIdag: [...new Set((korda ?? []).map((k) => slugFor.get(k.document_id as string)).filter((x): x is string => !!x))],
    veckans: typeof veckans?.value === "string" && publicerade.some((r) => r.id === veckans.value) ? (veckans.value as string) : null,
    aterkoppling: feedback
      .filter((x) => !x.helped && !x.answer && (redaktor || egna.has(x.document_id)) && x.employee_id !== mig)
      .map((x) => ({ id: x.id, rutin: slugFor.get(x.document_id) ?? "", text: [x.reason, x.text].filter(Boolean).join(": ") || "Rutinen hjälpte inte.", vem: namn.get(x.employee_id) ?? "Okänd" }))
      .filter((x) => x.rutin),
    svar,
    utkast: formade
      .filter((r) => r.status === "draft" && (redaktor || egna.has(r.dokId)))
      .map((r) => ({ id: r.id, andrad: kortDatum(dokRader.find((d) => d.id === r.dokId)?.updated_at), rutin: r })),
    arkiv: formade.filter((r) => r.status === "archived" && (redaktor || egna.has(r.dokId))).map((r) => ({ id: r.id, t: r.t, omr: r.omr })),
    agare: aktiva.map((p) => ({ id: p.id, namn: namn.get(p.id)! })).sort((a, b) => a.namn.localeCompare(b.namn, "sv")),
    uppdaterat: publicerade
      .filter((r) => r.v > 1 && (versPer.get(r.dokId) ?? []).some((v) => v.version === r.v && Date.now() - Date.parse(v.changed_at) < 30 * 86400000))
      .map((r): [string, string] => [r.id, (r.versioner.find((v) => v.v === r.v)?.d ?? "").replace(/ \d{4}$/, "")]),
    populart: { team: topp(senaste30.filter((v) => teamet.has(v.employee_id))), bolag: topp(senaste30) },
    trend,
    olast: publicerade.filter((r) => !lastaNyligen.has(r.dokId)).map((r) => r.id),
    missar: [...missar.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
    sokningar: Array.isArray(sokPref?.value) ? (sokPref.value as string[]).slice(0, 5) : [],
  };
}
