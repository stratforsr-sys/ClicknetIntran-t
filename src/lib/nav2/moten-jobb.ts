import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { fullName } from "@/lib/auth";
import { skrivFel } from "@/lib/fel-server";
import { notifiera } from "@/lib/notishandelse-server";
import { notisId } from "@/lib/notiser";
import { lokal } from "./leads";
import { lasInstallningar, lokalDag, utanRedanSkickade, vemPaminns, type Lage, type MotenInst, type Paminnelse, type PaminnelseMote } from "./motesflode";
import { UTFALL_ROLLER } from "./motenforma";
import { ProvisionKonflikt, lasProvision, reparationsKandidater } from "./motesprovision-server";

/**
 * Möten, jobbet (pg_cron var kvart, `nav-moten`): påminnelserna efter mötet och reparationen av låsningen.
 *
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
export type MotenJobbKvitto = { utfallSaknas: number; bedomningSaknas: number; reparerade: number; hoppade: number; hoppade_over?: string };

export async function korMotenJobb(db: Db, nu: Date = new Date()): Promise<MotenJobbKvitto> {
  const kvitto: MotenJobbKvitto = { utfallSaknas: 0, bedomningSaknas: 0, reparerade: 0, hoppade: 0 };
  const { data: iRader } = await db.from("nav_setting").select("key, value").like("key", "moten.%").limit(100);
  const inst = lasInstallningar((iRader ?? []) as { key: string; value: unknown }[]);
  if (!inst.gallerFran) return { ...kvitto, hoppade_over: "moten.galler-fran saknas" };
  const gallerFran = inst.gallerFran;

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
