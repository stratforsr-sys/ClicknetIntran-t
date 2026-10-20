import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { hasRole, type CurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { svensktDatum } from "@/lib/klocka";
import { notisId } from "@/lib/notiser";
import { navnyheterFor } from "@/navnyheter";
import { heltNamn } from "./forma";

/**
 * Nav 2.0: Nyheter, med samma inlägg och samma målgrupp som /nyheter.
 *
 * ===========================================================================
 * RLS AVGÖR VAD SOM SYNS. Inläggen läses med den inloggades token
 * (`news_post_read`: publicerat och i målgruppen, eget, eller ledningen), som
 * repots sida. Ledningen ser alla inlägg, också i Nav 2.0 (beställaren
 * 2026-10-20): utkastets lista visar det som riktar sig till en själv eller
 * som man skrivit (`nhForMig`), och för den som får skriva alla (`nhSer` i
 * ndpatch.py). Ett inlägg till andra är inget att läsa eller kvittera, så det
 * räknas inte som oläst.
 *
 * LÄST = notification_dismissed med klockans id för inlägget (`nyhet-<id>`),
 * samma rad som klockans avfärdning skriver. Kvittensen och schemaläggningen
 * är 0130. Läskvittot (vilka som läst och kvitterat, och vilka som inte gjort
 * det) räknas med service role och skickas bara till inläggets författare och
 * till ledningen, de som får skriva inlägg. Andra får bara veta om de själva
 * läst.
 *
 * Nytt i navet är repots släpplista (`src/navnyheter/`), med samma filter som
 * klockan och /nyheter (`navnyheterFor`) och samma "läst" (`navnyhet-<slug>`).
 * ===========================================================================
 */

/** Utkastets grupper i skrivrutan, som roller. Hämtat ur utkastets egna personer (AEPERS). */
export const NH_GRUPPER = {
  alla: [] as string[],
  salj: ["salesperson", "team_lead"],
  ledning: ["sales_manager", "ceo", "admin", "finance"],
  leverans: ["project_manager", "delivery"],
} as const;
export type NhGrupp = keyof typeof NH_GRUPPER;
const GRUPPNAMN: Record<NhGrupp, string> = { alla: "Alla", salj: "Säljare", ledning: "Ledningen", leverans: "Leveransen" };
const ROLLNAMN: Record<string, string> = {
  sales_manager: "Säljchef",
  ceo: "VD",
  team_lead: "Teamledare",
  salesperson: "Säljare",
  finance: "Ekonomi",
  project_manager: "Projektledare",
  delivery: "Leverans",
  admin: "Administratör",
};

/** Gruppen ett inläggs målgrupp motsvarar, eller null om den är någon annan (skriven i nuvarande Nav). */
export function gruppFor(roller: string[] | null, team: string[] | null): NhGrupp | null {
  if ((team ?? []).length) return null;
  const r = [...new Set(roller ?? [])].sort().join(",");
  for (const g of Object.keys(NH_GRUPPER) as NhGrupp[]) if ([...NH_GRUPPER[g]].sort().join(",") === r) return g;
  return null;
}

/** Som matches_audience: tomma listor betyder alla. */
export function iMalgrupp(roller: string[] | null, team: string[] | null, p: { roller: string[]; team_id: string | null }): boolean {
  const r = roller ?? [], t = team ?? [];
  const rollOk = !r.length || p.roller.some((x) => r.includes(x));
  const teamOk = !t.length || (p.team_id !== null && t.includes(p.team_id));
  return rollOk && teamOk;
}

/** Den som får skriva inlägg: samma krets som repots `farSkriva` (nyheter/actions.ts). */
export const farSkrivaNyheter = (user: CurrentUser) => hasRole(user, "sales_manager", "ceo", "admin");

export const saknas0130 = (e: { message?: string } | null | undefined) => !!e && /does not exist|schema cache|could not find|finns inte/i.test(e.message ?? "");

const TZ = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/** "2026-10-20 08:30" i svensk tid, som utkastets `at`. */
export function stockholmAt(iso: string): string {
  const p = Object.fromEntries(TZ.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

export type NdNyhet = {
  /** Slugen: adressen /nyheter/<slug> och utkastets id. */
  id: string;
  dbId: string;
  at: string;
  av: string;
  avId: string;
  /** En av utkastets grupper, eller null när målgruppen skrevs i nuvarande Nav. */
  grupp: NhGrupp | null;
  gruppNamn: string;
  fast: boolean;
  kv: string | null;
  rubrik: string;
  text: string;
  /** Schemalagt och inte publicerat än (bara författaren ser det). */
  schema: boolean;
  /** Mottagarna (utom författaren), de som läst och de som kvitterat, som namn. Fulla listor bara med läskvittot (`stat`). */
  mott: string[];
  last: string[];
  kvitt: string[];
  stat: boolean;
  /** Dagar (svenska datum) då författaren påmint, från audit_log. */
  pamint: string[];
};

export type NdNyheter = {
  utan0130: boolean;
  farSkriva: boolean;
  poster: NdNyhet[];
  /** Det senaste egna utkastet som går att öppna i skrivrutan. */
  utkast: { id: string; rubrik: string; text: string; grupp: NhGrupp; kv: string | null; fast: boolean } | null;
  /** Mottagarna per grupp, som namn, för skrivrutans antal. Bara för den som får skriva. */
  grupper: Record<NhGrupp, string[]> | null;
  /** Nytt i navet: de olästa och de senaste lästa, högst sex om alla är lästa. */
  nav: { slug: string; datum: string; rubrik: string; ingress: string; href: string | null; last: boolean }[];
};

type Rad = {
  id: string;
  slug: string;
  title: string;
  body_md: string;
  status: string;
  pinned: boolean;
  audience_roles: string[] | null;
  audience_teams: string[] | null;
  published_at: string | null;
  author_id: string;
  created_at: string;
  updated_at: string;
  ack_due?: string | null;
  scheduled_at?: string | null;
};
type Person = { id: string; first_name: string; last_name: string; team_id: string | null; status: string; roller: string[] };

const NAV_LASTA = 6;

export async function byggNyheter(supabase: SupabaseClient, user: CurrentUser): Promise<NdNyheter> {
  const mig = user.employee!.id;
  const far = farSkrivaNyheter(user);
  const admin = supabaseAdmin();
  const idag = svensktDatum();

  const med0130 = supabase
    .from("news_post")
    .select("id, slug, title, body_md, status, pinned, audience_roles, audience_teams, published_at, author_id, created_at, updated_at, ack_due, scheduled_at")
    .neq("status", "archived")
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(200);
  const [forst, { data: avfardade }, { data: minaKvitt, error: kvittFel }, { data: personal }, { data: roller }] = await Promise.all([
    med0130,
    supabase.from("notification_dismissed").select("notice_id").eq("employee_id", mig),
    supabase.from("news_ack").select("post_id").eq("employee_id", mig),
    admin.from("employee").select("id, first_name, last_name, team_id, status"),
    admin.from("employee_role").select("employee_id, role"),
  ]);
  let rader = (forst.data ?? []) as Rad[];
  const utan0130 = saknas0130(forst.error) || saknas0130(kvittFel);
  if (saknas0130(forst.error)) {
    const { data } = await supabase
      .from("news_post")
      .select("id, slug, title, body_md, status, pinned, audience_roles, audience_teams, published_at, author_id, created_at, updated_at")
      .neq("status", "archived")
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(200);
    rader = (data ?? []) as Rad[];
  }

  const rp = new Map<string, string[]>();
  for (const r of (roller ?? []) as { employee_id: string; role: string }[]) rp.set(r.employee_id, [...(rp.get(r.employee_id) ?? []), r.role]);
  const pers: Person[] = ((personal ?? []) as Omit<Person, "roller">[]).map((p) => ({ ...p, roller: rp.get(p.id) ?? [] }));
  const namn = new Map(pers.map((p) => [p.id, heltNamn(p.first_name, p.last_name)]));
  const aktiva = pers.filter((p) => p.status !== "offboarded");
  const jag = pers.find((p) => p.id === mig) ?? { id: mig, first_name: user.employee!.first_name, last_name: user.employee!.last_name, team_id: user.employee!.team_id, status: user.employee!.status, roller: [...user.roles] };
  const jagNamn = namn.get(mig) ?? heltNamn(user.employee!.first_name, user.employee!.last_name);

  const lastaAvMig = new Set(((avfardade ?? []) as { notice_id: string }[]).map((a) => a.notice_id));
  const kvittAvMig = new Set(((minaKvitt ?? []) as { post_id: string }[]).map((k) => k.post_id));

  // Publicerade, och egna schemalagda. Andras utkast (ledningen ser dem i RLS) visas inte.
  const synliga = rader.filter((r) => r.status === "published" || (r.author_id === mig && r.status === "draft" && !!r.scheduled_at));
  // Läskvittot: för författaren och för ledningen.
  const medStat = synliga.filter((r) => far || r.author_id === mig);
  const statIds = medStat.map((r) => r.id);
  const [{ data: allaLast }, { data: allaKvitt }, { data: paminnelser }] = statIds.length
    ? await Promise.all([
        admin.from("notification_dismissed").select("employee_id, notice_id").in("notice_id", statIds.map((id) => notisId("nyhet", id))),
        utan0130 ? Promise.resolve({ data: [] as { post_id: string; employee_id: string }[] }) : admin.from("news_ack").select("post_id, employee_id").in("post_id", statIds),
        admin.from("audit_log").select("object_id, ts").eq("action", "news.reminded").in("object_id", medStat.map((r) => r.slug)).gte("ts", new Date(Date.now() - 30 * 86400000).toISOString()),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];
  const lastPer = new Map<string, Set<string>>();
  for (const x of (allaLast ?? []) as { employee_id: string; notice_id: string }[]) {
    const id = x.notice_id.slice("nyhet-".length);
    lastPer.set(id, new Set([...(lastPer.get(id) ?? []), x.employee_id]));
  }
  const kvittPer = new Map<string, Set<string>>();
  for (const x of (allaKvitt ?? []) as { post_id: string; employee_id: string }[]) kvittPer.set(x.post_id, new Set([...(kvittPer.get(x.post_id) ?? []), x.employee_id]));
  const pamintPer = new Map<string, string[]>();
  for (const x of (paminnelser ?? []) as { object_id: string; ts: string }[]) pamintPer.set(x.object_id, [...new Set([...(pamintPer.get(x.object_id) ?? []), svensktDatum(x.ts)])]);

  const etikett = (r: Rad): string => {
    const g = gruppFor(r.audience_roles, r.audience_teams);
    if (g) return GRUPPNAMN[g];
    const delar = [...(r.audience_roles ?? []).map((x) => ROLLNAMN[x] ?? x), ...(r.audience_teams ?? []).map(() => "ett team")];
    return delar.join(", ") || "Alla";
  };

  const poster: NdNyhet[] = synliga.map((r) => {
    const stat = far || r.author_id === mig;
    const mottIds = aktiva.filter((p) => p.id !== r.author_id && iMalgrupp(r.audience_roles, r.audience_teams, p)).map((p) => p.id);
    const jagMott = r.author_id !== mig && iMalgrupp(r.audience_roles, r.audience_teams, jag);
    const lasta = lastPer.get(r.id) ?? new Set<string>(), kvitterade = kvittPer.get(r.id) ?? new Set<string>();
    const jagLast = lastaAvMig.has(notisId("nyhet", r.id)), jagKvitt = kvittAvMig.has(r.id);
    const som = (ids: string[]) => ids.map((id) => namn.get(id) ?? "Okänd");
    return {
      id: r.slug,
      dbId: r.id,
      at: stockholmAt(r.status === "published" ? (r.published_at ?? r.created_at) : (r.scheduled_at ?? r.created_at)),
      av: namn.get(r.author_id) ?? "Ledningen",
      avId: r.author_id,
      grupp: gruppFor(r.audience_roles, r.audience_teams),
      gruppNamn: etikett(r),
      fast: !!r.pinned,
      kv: r.ack_due ?? null,
      rubrik: r.title,
      text: r.body_md,
      schema: r.status === "draft",
      mott: stat ? som(mottIds) : jagMott ? [jagNamn] : [],
      last: stat ? som(mottIds.filter((id) => lasta.has(id))) : jagLast ? [jagNamn] : [],
      kvitt: stat ? som(mottIds.filter((id) => kvitterade.has(id))) : jagKvitt ? [jagNamn] : [],
      stat,
      pamint: r.author_id === mig ? pamintPer.get(r.slug) ?? [] : [],
    };
  });

  // Skrivrutans utkast: det senaste egna som inte är schemalagt och vars målgrupp är en av utkastets grupper.
  const egetUtkast = rader
    .filter((r) => r.author_id === mig && r.status === "draft" && !r.scheduled_at && gruppFor(r.audience_roles, r.audience_teams))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];

  const grupper = far
    ? (Object.fromEntries((Object.keys(NH_GRUPPER) as NhGrupp[]).map((g) => [g, aktiva.filter((p) => iMalgrupp([...NH_GRUPPER[g]], [], p)).map((p) => namn.get(p.id)!)])) as Record<NhGrupp, string[]>)
    : null;

  // Nytt i navet: samma filter som klockan, fram till i dag.
  const alla = navnyheterFor({ roller: user.roles, behorigheter: user.permissions, anstalldSedan: user.employee!.start_date })
    .filter((n) => n.datum <= idag)
    .map((n) => ({ slug: n.slug, datum: n.datum, rubrik: n.rubrik, ingress: n.ingress, href: n.href ?? null, last: lastaAvMig.has(notisId("navnyhet", n.slug)) }));
  const olasta = alla.filter((n) => !n.last);
  const lasta = alla.filter((n) => n.last).slice(0, Math.max(0, NAV_LASTA - olasta.length));
  const nav = [...olasta, ...lasta].sort((a, b) => b.datum.localeCompare(a.datum));

  return {
    utan0130,
    farSkriva: far,
    poster,
    utkast: egetUtkast
      ? { id: egetUtkast.slug, rubrik: egetUtkast.title, text: egetUtkast.body_md, grupp: gruppFor(egetUtkast.audience_roles, egetUtkast.audience_teams)!, kv: egetUtkast.ack_due ?? null, fast: !!egetUtkast.pinned }
      : null,
    grupper,
    nav,
  };
}
