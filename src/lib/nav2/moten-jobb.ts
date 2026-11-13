import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { fullName } from "@/lib/auth";
import { skrivFel } from "@/lib/fel-server";
import { notifiera } from "@/lib/notishandelse-server";
import { notisId } from "@/lib/notiser";
import { lokal } from "./leads";
import {
  lasInstallningar, lokalDag, lokalKlockan, utanRedanSkickade, vemBekraftar, vemPaminns,
  type BekraftaMote, type Bekraftelse, type Lage, type MotenInst, type Paminnelse, type PaminnelseMote,
} from "./motesflode";
import { UTFALL_ROLLER } from "./motenforma";
import { ProvisionKonflikt, lasProvision, reparationsKandidater } from "./motesprovision-server";

/**
 * Möten, jobbet (pg_cron var kvart, `nav-moten`): bekräftelsen före mötet, påminnelserna efter mötet och
 * reparationen av låsningen.
 *
 *   0. Bekräftelsen (2026-11-13): när fönstret öppnar (arbetsdagar före mötet, kl. `moten.bekrafta-tid`) läggs en
 *      uppgift upp åt den som bokade ("Bekräfta mötet med …", `mote_uppgift_skapa` i 0291), och en notis går till
 *      klockan och telefonen. Notisen kommer igen varje arbetsdag tills mötet är bekräftat. Uppgiftens deadline är
 *      senast-dagen, så att den aldrig står som försenad innan den är det. Vem och när avgör den rena
 *      `vemBekraftar` (motesflode.ts). Uppgift och möte hålls i takt av triggrarna i 0291; ett möte som börjat
 *      obekräftat får sin öppna uppgift borttagen här (`mote_uppgift_stada`).
 *   1. Utfall saknas efter mötet, och ett hållet möte som väntar på bedömning: en notis till hållaren samma dag efter
 *      påminnelsetiden (`moten.utfall-paminnelse`), och två kalenderdagar efter till alla admins. Vem som påminns
 *      avgörs av den rena `vemPaminns` (motesflode.ts).
 *   2. Reparationen: ett möte med utfall (och nivå, om det är hållet) vars mötesprovision inte blev låst, till exempel
 *      för att anropet föll mitt i, låses nu med `lasProvision`. Inga notiser.
 *
 * Bara notiser, aldrig mejl (källorna står inte i MEJLKALLOR). Idempotent: samma notis skrivs högst en gång per
 * (källa, möte, kalenderdag, mottagare), och jobbet går var kvart. Möten före `moten.galler-fran` rörs aldrig.
 */

type Db = SupabaseClient;

const DYGN = 24 * 3600 * 1000;
const MAX_REPARATIONER = 50;

type MoteRad = { id: string; kedja_id: string; mote_tid: string; langd_min: number | null; utfall: string | null; niva: string | null; utfall_nar: string | null; halls_av: string };
export type MotenJobbKvitto = { utfallSaknas: number; bedomningSaknas: number; reparerade: number; hoppade: number; uppgifter: number; bekrafta: number; stadade: number; hoppade_over?: string };

export async function korMotenJobb(db: Db, nu: Date = new Date()): Promise<MotenJobbKvitto> {
  const kvitto: MotenJobbKvitto = { utfallSaknas: 0, bedomningSaknas: 0, reparerade: 0, hoppade: 0, uppgifter: 0, bekrafta: 0, stadade: 0 };
  const { data: iRader } = await db.from("nav_setting").select("key, value").like("key", "moten.%").limit(100);
  const inst = lasInstallningar((iRader ?? []) as { key: string; value: unknown }[]);
  if (!inst.gallerFran) return { ...kvitto, hoppade_over: "moten.galler-fran saknas" };
  const gallerFran = inst.gallerFran;

  // Bekräftelsen först: den har en tid att passa (påminnelsen kommer på klockslaget), det andra har det inte.
  // Ett fel här får aldrig stoppa påminnelserna efter mötet eller reparationen.
  try {
    await bekraftelser(db, inst, gallerFran, nu, kvitto);
  } catch (e) {
    await skrivFel({ kind: "automatic", path: "/api/jobb/moten", digest: "moten-jobb-bekrafta", message: `Möten-jobbet: bekräftelsen föll: ${e instanceof Error ? e.message : String(e)}`, blocking: false });
  }

  // Påminnelserna: ett fönster bakåt räcker, för den sista påminnelsen går två dagar efter mötet (eller utfallet).
  const motesFran = new Date(Math.max(Date.parse(gallerFran), nu.getTime() - 6 * DYGN)).toISOString();
  const utfallFran = new Date(nu.getTime() - 4 * DYGN).toISOString();
  const [{ data: saknar }, { data: vantar }] = await Promise.all([
    db
      .from("mote")
      .select("id, kedja_id, mote_tid, langd_min, utfall, niva, utfall_nar, halls_av")
      .is("utfall", null)
      .gte("mote_tid", motesFran)
      .lte("mote_tid", nu.toISOString())
      .limit(1000),
    db
      .from("mote")
      .select("id, kedja_id, mote_tid, langd_min, utfall, niva, utfall_nar, halls_av")
      .eq("utfall", "hallet")
      .is("niva", null)
      .gte("mote_tid", gallerFran)
      .gte("utfall_nar", utfallFran)
      .limit(1000),
  ]);
  const moten = new Map<string, MoteRad>();
  for (const m of [...((saknar ?? []) as unknown as MoteRad[]), ...((vantar ?? []) as unknown as MoteRad[])]) moten.set(m.id, m);

  const paminnelseMoten: PaminnelseMote[] = [...moten.values()].map((m) => ({
    id: m.id,
    slut: new Date(Date.parse(m.mote_tid) + (m.langd_min ?? 0) * 60_000).toISOString(),
    utfall: m.utfall,
    niva: m.niva,
    utfallNar: m.utfall_nar,
    hallsAv: m.halls_av,
  }));
  if (paminnelseMoten.length) {
    const admins = await adminsAttPaminna(db);
    const att = vemPaminns(paminnelseMoten, admins, nu, inst);
    if (att.length) await skickaPaminnelser(db, att, moten, inst.tidszon, nu, kvitto);
  }

  await reparera(db, inst, gallerFran, nu, kvitto);
  return kvitto;
}

/** Upp till 14 arbetsdagar före mötet, plus helger och röda dagar emellan. */
const BEKRAFTA_FRAMAT = 30 * DYGN;

type ObekraftatRad = { id: string; kedja_id: string; mote_tid: string; bokat_av: string; halls_av: string; bokat_nar: string; flyttad_nar: string | null };
type KortRad = { kedja_id: string; namn: string | null; kontakt: string | null; telefon: string | null };

/** "tis 17 nov 10:00" i tidszonen. */
function motesText(iso: string, tz: string): string {
  const d = new Date(iso);
  const dag = new Intl.DateTimeFormat("sv-SE", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(d).replace(/\./g, "");
  return `${dag} ${lokalKlockan(d, tz)}`;
}

/** Senast-dagen i text: "i dag", "i morgon", annars veckodagen ("måndag 16 nov"). */
function senastText(senast: string, idag: string): string {
  if (senast === idag) return "i dag";
  const imorgon = new Date(Date.parse(`${idag}T12:00:00Z`) + DYGN).toISOString().slice(0, 10);
  if (senast === imorgon) return "i morgon";
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "UTC", weekday: "long", day: "numeric", month: "short" }).format(new Date(`${senast}T12:00:00Z`)).replace(/\./g, "");
}

/** Vem på kundsidan som ska ringas: "Anna Svensson på 070-123 45 67", "Anna Svensson" eller "kunden". */
function ringText(k: KortRad | undefined): string {
  const namn = k?.kontakt?.trim() || "kunden";
  const tel = k?.telefon?.trim();
  return tel ? `${namn} på ${tel}` : namn;
}

/**
 * Steg 0: bekräftelsen. Läser obekräftade möten inom 30 dagar, frågar `vemBekraftar` och gör det den säger:
 * uppgiften läggs upp (databasen nekar en andra, och en som gäller en tid mötet inte längre har) med senast-dagen
 * som deadline, och notisen skrivs en gång per möte, dag och mottagare. Går det inte att läsa vad som redan skickats
 * skickas inga notiser den körningen (annars hade varje kvart gett en ny), men uppgifterna läggs ändå upp.
 */
async function bekraftelser(db: Db, inst: MotenInst, gallerFran: string, nu: Date, kvitto: MotenJobbKvitto): Promise<void> {
  // Städningen först, men den får aldrig stoppa nya uppgifter och notiser: ett fel loggas och jobbet går vidare.
  const { data: stadat, error: stadfel } = await db.rpc("mote_uppgift_stada");
  if (stadfel) await skrivFel({ kind: "automatic", path: "/api/jobb/moten", digest: "moten-jobb-stada", message: `Möten-jobbet: mote_uppgift_stada föll: ${stadfel.message}`, blocking: false });
  kvitto.stadade = typeof stadat === "number" ? stadat : 0;
  if (!inst.bekraftaPaminn) return;

  const tz = inst.tidszon;
  const fran = new Date(Math.max(Date.parse(gallerFran), nu.getTime())).toISOString();
  const { data: mr, error: mfel } = await db
    .from("mote")
    .select("id, kedja_id, mote_tid, bokat_av, halls_av, bokat_nar, flyttad_nar")
    .is("utfall", null)
    .is("bekraftat_nar", null)
    .gt("mote_tid", fran)
    .lte("mote_tid", new Date(nu.getTime() + BEKRAFTA_FRAMAT).toISOString())
    .limit(1000);
  if (mfel) throw new Error(`obekräftade möten: ${mfel.message}`);
  const rader = (mr ?? []) as unknown as ObekraftatRad[];
  if (!rader.length) return;

  const moteIds = rader.map((r) => r.id);
  const { data: mu, error: mufel } = await db.from("mote_uppgift").select("mote_id, task_id").in("mote_id", moteIds).limit(moteIds.length);
  if (mufel) throw new Error(`mote_uppgift: ${mufel.message}`);
  const uppgiftFor = new Map(((mu ?? []) as unknown as { mote_id: string; task_id: string }[]).map((x) => [x.mote_id, x.task_id]));
  const taskIds = [...uppgiftFor.values()];
  const { data: tr } = taskIds.length ? await db.from("task").select("id, assignee_id").in("id", taskIds).limit(taskIds.length) : { data: [] };
  const task = new Map(((tr ?? []) as unknown as { id: string; assignee_id: string | null }[]).map((t) => [t.id, t]));
  // Strukna uppgifter: den senaste händelsen som avgör läget (samma som `lageAv`) är `avbruten`.
  const { data: hr } = taskIds.length
    ? await db.from("task_event").select("task_id, type, at").in("task_id", taskIds).in("type", ["klar", "godkand", "avbruten", "ateroppnad", "inlamnad", "returnerad", "paborjad"]).order("at", { ascending: true }).limit(5000)
    : { data: [] };
  const sistaTyp = new Map<string, string>();
  for (const h of (hr ?? []) as unknown as { task_id: string; type: string }[]) sistaTyp.set(h.task_id, h.type);

  const personer = [...new Set([...rader.flatMap((r) => [r.bokat_av, r.halls_av]), ...[...task.values()].map((t) => t.assignee_id)].filter((x): x is string => !!x))];
  const { data: er, error: efel } = await db.from("employee").select("id").in("id", personer).neq("status", "offboarded").limit(personer.length);
  if (efel) throw new Error(`anställda: ${efel.message}`);
  const aktiva = new Set(((er ?? []) as unknown as { id: string }[]).map((e) => e.id));

  const fraga: BekraftaMote[] = rader.map((r) => {
    const t = uppgiftFor.get(r.id);
    return {
      id: r.id,
      moteTid: r.mote_tid,
      senastAndrad: r.flyttad_nar ?? r.bokat_nar,
      bokatAv: r.bokat_av,
      hallsAv: r.halls_av,
      bekraftat: false,
      utfall: null,
      uppgift: t ? { id: t, till: task.get(t)?.assignee_id ?? null, avbruten: sistaTyp.get(t) === "avbruten" } : null,
    };
  });
  const att = vemBekraftar(fraga, aktiva, nu, inst);
  if (!att.length) return;

  // Bolaget och vem som ska ringas, ur tavlans vy.
  const motesRad = new Map(rader.map((r) => [r.id, r]));
  const kedjor = [...new Set(att.map((b) => motesRad.get(b.moteId)!.kedja_id))];
  const { data: kr } = await db.from("mote_kort").select("kedja_id, namn, kontakt, telefon").in("kedja_id", kedjor).limit(kedjor.length);
  const kort = new Map(((kr ?? []) as unknown as KortRad[]).map((k) => [k.kedja_id, k]));

  for (const b of att) {
    const m = motesRad.get(b.moteId)!;
    const k = kort.get(m.kedja_id);
    const bolag = k?.namn?.trim() || "kunden";
    if (b.skapaUppgift) {
      const beskrivning = `Ring ${ringText(k)} och bekräfta mötet ${motesText(m.mote_tid, tz)}. Bekräfta senast ${senastText(b.senast, b.dag)}.

`
        + "Bockar du av uppgiften blir mötet bekräftat i Möten, och bekräftar du i Möten bockas uppgiften av. Får du inte tag på kunden: tryck Fick inte tag på mötet, så ligger uppgiften kvar.";
      const { data: ny, error } = await db.rpc("mote_uppgift_skapa", { p_mote: b.moteId, p_mote_tid: m.mote_tid, p_till: b.till, p_titel: `Bekräfta mötet med ${bolag}`, p_beskrivning: beskrivning, p_dag: b.senast });
      if (error) {
        await skrivFel({ kind: "automatic", path: "/api/jobb/moten", digest: `moten-bekrafta-uppgift-${b.moteId}-${b.dag}`, message: `Bekräftelseuppgiften för mötet ${b.moteId} gick inte att lägga upp: ${error.message}`, blocking: false });
      } else if (ny) kvitto.uppgifter++;
    }
  }

  await skickaBekraftelser(db, att, motesRad, kort, tz, nu, kvitto);
}

async function skickaBekraftelser(db: Db, att: Bekraftelse[], motesRad: Map<string, ObekraftatRad>, kort: Map<string, KortRad>, tz: string, nu: Date, kvitto: MotenJobbKvitto): Promise<void> {
  const idag = lokalDag(nu, tz);
  const notiser = att.map((b) => ({ ...b, kalla: "mote-bekrafta" as const }));
  const gamla = await db
    .from("notification_event")
    .select("employee_id, kalla, object_id, created_at")
    .eq("kalla", "mote-bekrafta")
    .in("object_id", [...new Set(att.map((b) => b.moteId))])
    .gte("created_at", new Date(nu.getTime() - 2 * DYGN).toISOString())
    .limit(5000);
  const nya = utanRedanSkickade(notiser, { data: gamla.data, error: gamla.error }, idag, tz, (k, id, d) => notisId(k, id, d));
  if (!nya) {
    kvitto.hoppade_over = "Redan skickade bekräftelsenotiser gick inte att läsa";
    await skrivFel({ kind: "automatic", path: "/api/jobb/moten", digest: "moten-jobb-bekrafta-skickade", message: `Möten-jobbet kunde inte läsa redan skickade bekräftelsenotiser och skickade inga: ${gamla.error?.message ?? "okänt fel"}`, blocking: false });
    return;
  }
  for (const b of nya) {
    const m = motesRad.get(b.moteId);
    if (!m) continue;
    const k = kort.get(m.kedja_id);
    const bolag = k?.namn?.trim() || "kunden";
    const tid = motesText(m.mote_tid, tz);
    const rubrik = b.slag === "idag"
      ? `Mötet med ${bolag} i dag ${lokalKlockan(new Date(m.mote_tid), tz)} är inte bekräftat`
      : b.slag === "sista" ? `Sista dagen att bekräfta mötet med ${bolag}` : `Bekräfta mötet med ${bolag}`;
    const detalj = b.slag === "idag"
      ? `Ring ${ringText(k)} före mötet`
      : b.slag === "sista" ? `${tid} · ring ${ringText(k)}` : `${tid} · ring ${ringText(k)} · senast ${senastText(b.senast, idag)}`;
    const ok = await notifiera({ till: b.till, av: null, kalla: "mote-bekrafta", typ: "kalender", rubrik, detalj, href: `/moten/${m.id}`, objekt: { typ: "mote", id: m.id } });
    if (ok) kvitto.bekrafta++;
  }
}

/** Säljchef, VD och admin som inte har slutat. */
async function adminsAttPaminna(db: Db): Promise<string[]> {
  const { data: roller } = await db.from("employee_role").select("employee_id").in("role", [...UTFALL_ROLLER]).limit(500);
  const ids = [...new Set(((roller ?? []) as unknown as { employee_id: string }[]).map((x) => x.employee_id))];
  if (!ids.length) return [];
  const { data } = await db.from("employee").select("id").in("id", ids).neq("status", "offboarded").limit(ids.length);
  return ((data ?? []) as unknown as { id: string }[]).map((x) => x.id);
}

async function skickaPaminnelser(db: Db, att: Paminnelse[], moten: Map<string, MoteRad>, tz: string, nu: Date, kvitto: MotenJobbKvitto): Promise<void> {
  const idag = lokalDag(nu, tz);
  // Redan skickade: nyckeln är (källa, möte, kalenderdag) per mottagare, och dagen är dagen i tidszonen.
  const moteIds = [...new Set(att.map((p) => p.moteId))];
  const gamla = await db
    .from("notification_event")
    .select("employee_id, kalla, object_id, created_at")
    .in("kalla", ["mote-utfall-saknas", "mote-bedomning-saknas"])
    .in("object_id", moteIds)
    .gte("created_at", new Date(nu.getTime() - 3 * DYGN).toISOString())
    .limit(5000);
  // Går det inte att läsa vad som redan skickats skickas ingenting i den här körningen (annars fick alla en ny notis var kvart).
  const nya = utanRedanSkickade(att, { data: gamla.data, error: gamla.error }, idag, tz, (k, id, d) => notisId(k, id, d));
  if (!nya) {
    kvitto.hoppade_over = "Redan skickade påminnelser gick inte att läsa";
    await skrivFel({ kind: "automatic", path: "/api/jobb/moten", digest: "moten-jobb-skickade", message: `Möten-jobbet kunde inte läsa redan skickade påminnelser och skickade inga: ${gamla.error?.message ?? "okänt fel"}`, blocking: false });
    return;
  }
  if (!nya.length) return;

  // Texten: bolagets namn och hållarens namn.
  const kedjor = [...new Set(nya.map((p) => moten.get(p.moteId)?.kedja_id).filter((x): x is string => !!x))];
  const { data: kd } = kedjor.length ? await db.from("mote_kedja").select("id, bolag_id").in("id", kedjor).limit(kedjor.length) : { data: [] };
  const kedjaBolag = new Map(((kd ?? []) as unknown as { id: string; bolag_id: string }[]).map((k) => [k.id, k.bolag_id]));
  const bolagIds = [...new Set([...kedjaBolag.values()])];
  const { data: bd } = bolagIds.length ? await db.from("mote_bolag").select("id, namn").in("id", bolagIds).limit(bolagIds.length) : { data: [] };
  const bolagNamn = new Map(((bd ?? []) as unknown as { id: string; namn: string }[]).map((b) => [b.id, b.namn]));
  const hallare = [...new Set(nya.map((p) => moten.get(p.moteId)?.halls_av).filter((x): x is string => !!x))];
  const { data: pd } = hallare.length ? await db.from("employee").select("id, first_name, last_name").in("id", hallare).limit(hallare.length) : { data: [] };
  const hallNamn = new Map(((pd ?? []) as unknown as { id: string; first_name: string; last_name: string }[]).map((p) => [p.id, fullName(p)]));

  for (const p of nya) {
    const m = moten.get(p.moteId);
    if (!m) continue;
    const bolag = bolagNamn.get(kedjaBolag.get(m.kedja_id) ?? "") ?? "Mötet";
    const tillHallaren = p.till === m.halls_av;
    const vem = hallNamn.get(m.halls_av) ?? "Hållaren";
    const tid = lokal(m.mote_tid);
    const utfallSaknas = p.kalla === "mote-utfall-saknas";
    const rubrik = utfallSaknas
      ? tillHallaren ? `Hur gick mötet med ${bolag}?` : `${vem} har inte satt utfall på mötet med ${bolag}`
      : tillHallaren ? `Mötet med ${bolag} väntar på din bedömning` : `${vem} har inte bedömt mötet med ${bolag}`;
    const detalj = utfallSaknas ? `${tid} · utfall saknas` : `${tid} · hållet, nivån är inte satt`;
    const ok = await notifiera({ till: p.till, av: null, kalla: p.kalla, typ: "kalender", rubrik, detalj, href: `/moten/${m.id}`, objekt: { typ: "mote", id: m.id } });
    if (ok) {
      if (utfallSaknas) kvitto.utfallSaknas++;
      else kvitto.bedomningSaknas++;
    }
  }
}

/**
 * Reparationen: utfall satt men mötesprovisionen inte låst. Ett hållet möte utan nivå väntar på bedömning och
 * låses inte här. `av` är den som satte utfallet (`utfall_av`): `commission_entry.entered_by` kräver en anställd.
 * Saknas den hoppas mötet över och ett fel rapporteras en gång. Mötet måste ha haft sitt utfall i minst fem minuter,
 * så att jobbet inte låser parallellt med anropet som just satte det.
 */
async function reparera(db: Db, inst: MotenInst, gallerFran: string, nu: Date, kvitto: MotenJobbKvitto): Promise<void> {
  const rader = await reparationsKandidater(db, gallerFran, nu, MAX_REPARATIONER);
  for (const m of rader) {
    const lage: Lage = { tappat: m.utfall };
    if (!m.utfall_av) {
      kvitto.hoppade++;
      const digest = `moten-reparation-utan-utfall-av-${m.id}`;
      const { data: larmat } = await db.from("error_report").select("id").eq("digest", digest).limit(1);
      if (!((larmat ?? []) as unknown[]).length) {
        await skrivFel({ kind: "automatic", path: "/api/jobb/moten", digest, message: `Mötet ${m.id} har utfall men ingen provisionslåsning, och ingen som satte utfallet (utfall_av saknas). Jobbet kan inte reparera det: någon måste låsa mötesprovisionen.`, blocking: false });
      }
      continue;
    }
    try {
      const r = await lasProvision(db, m, inst, lage, m.utfall_av, nu);
      if (r.last) kvitto.reparerade++;
    } catch (e) {
      if (e instanceof ProvisionKonflikt) continue;
      await skrivFel({ kind: "automatic", path: "/api/jobb/moten", digest: `moten-reparation-${m.id}`, message: `Mötesprovisionen för mötet ${m.id} gick inte att låsa i reparationen: ${e instanceof Error ? e.message : String(e)}`, blocking: false });
    }
  }
}
