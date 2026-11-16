import { NextResponse } from "next/server";
import { getCurrentUser, fullName } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { notifieraFlera } from "@/lib/notishandelse-server";
import { skrivHandelse } from "@/lib/handelselogg-server";
import { notisId } from "@/lib/notiser";
import { farAndraKedja, type Aktor } from "@/lib/nav2/motenforma";
import { LASLAGE_TEXT, SKRIVLAGE, sammaUrsprung } from "@/lib/nav2/skrivlage";
import {
  TRAD_MAX,
  UUID,
  idIndata,
  iOrdning,
  mottagare,
  notisText,
  settFramat,
  textIndata,
  tillKlient,
  type Inlagg,
} from "@/lib/nav2/motesanteckning";

export const dynamic = "force-dynamic";

/**
 * Nav 2.0, Möten: anteckningarna på ett kort (0310). En tråd per kedja.
 *
 * ===========================================================================
 * Handlingar: `las`, `skriv`, `andra`, `ta_bort`, `sett`, `tyst`.
 *
 * VEM: de som är med på kortet (`mote_kedja.deltagare`) och cheferna, samma regel som kortet självt
 * (`farAndraKedja`, RLS `mote_kedja_read`). Ändra och ta bort gäller bara det egna inlägget. Aktören är alltid den
 * inloggade, aldrig något ur anropet.
 *
 * ALDRIG TILL KUNDEN. Inget här skriver i utkorgen, kalendern eller ett kundbrev. Notisen går bara till anställda
 * (`notification_event.employee_id`), och mejl, när någon slagit på det för sorten, bara till interna adresser.
 *
 * SAMMA ID = SAMMA INLÄGG. Webbläsaren sätter id:t och skickar samma id vid ett nytt försök. `on conflict do
 * nothing`: fanns raden redan och är den min i samma kedja svarar rutten som om den skrevs nu, men utan ny notis.
 *
 * SVARET: `las`, `skriv`, `andra` och `ta_bort` svarar med hela tråden, så att klienten ritar det servern har (två
 * som skriver samtidigt syns direkt för båda, i serverns ordning).
 *
 * LÄSLÄGE: står `SKRIVLAGE.moten` på false svarar skrivningarna 423 innan något görs. `las` och `sett` går ändå.
 * ===========================================================================
 */

type Svar = { ok?: string; fel?: string; [k: string]: unknown };
const svar = (data: Svar, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });

const SKRIVANDE = new Set(["skriv", "andra", "ta_bort", "tyst"]);
const FALT = "id, kedja_id, mote_id, av, text, skapad, andrad, borttagen";
const KALLA = "mote-anteckning";

type Kedja = { id: string; bolag_id: string; deltagare: string[] | null };

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user?.employee) return svar({ fel: "Du måste vara inloggad." }, 401);
  if (!sammaUrsprung(request)) return svar({ fel: "Fel ursprung." }, 403);
  const mig = user.employee.id;

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return svar({ fel: "Ogiltig begäran." }, 400);
  }
  const handling = String(b?.handling ?? "");
  if (!["las", "skriv", "andra", "ta_bort", "sett", "tyst"].includes(handling)) return svar({ fel: "Okänd handling." }, 400);
  if (SKRIVANDE.has(handling) && !SKRIVLAGE.moten) return svar({ fel: LASLAGE_TEXT, laslage: true }, 423);

  const db = supabaseAdmin();
  const aktorn: Aktor = { id: mig, roller: user.roles as string[] };

  /** Kortet, om det finns och jag får se det. Annars svaret att ge. */
  const kedjan = async (id: unknown): Promise<Kedja | NextResponse> => {
    if (typeof id !== "string" || !UUID.test(id)) return svar({ fel: "Ogiltig begäran." }, 400);
    const { data, error } = await db.from("mote_kedja").select("id, bolag_id, deltagare").eq("id", id).maybeSingle();
    if (error) return svar({ fel: "Nav kunde inte läsa just nu. Försök igen." }, 500);
    const k = data as Kedja | null;
    if (!k) return svar({ fel: "Kortet finns inte längre." }, 404);
    if (!farAndraKedja(aktorn, k.deltagare)) return svar({ fel: "Du är inte med på det här kortet." }, 403);
    return k;
  };

  const minSett = async (kedja: string): Promise<{ sett_till: string; tyst: boolean } | null> => {
    const { data } = await db.from("mote_anteckning_sett").select("sett_till, tyst").eq("kedja_id", kedja).eq("employee_id", mig).maybeSingle();
    return (data as { sett_till: string; tyst: boolean } | null) ?? null;
  };

  /** Flyttar min läsmarkering fram (aldrig bakåt) och tar trådens notiser ur min klocka. */
  const markeraSett = async (kedja: string, till: unknown, forra: { sett_till: string; tyst: boolean } | null): Promise<string | null> => {
    const satt = settFramat(forra?.sett_till ?? null, till, new Date());
    if (satt) {
      await db
        .from("mote_anteckning_sett")
        .upsert({ kedja_id: kedja, employee_id: mig, sett_till: satt, tyst: forra?.tyst ?? false }, { onConflict: "kedja_id,employee_id" });
    }
    // Det man läst i tråden är sett: trådens notiser försvinner ur klockan, var de än skulle ha öppnats.
    const { data: notiser } = await db
      .from("notification_event")
      .select("id")
      .eq("employee_id", mig)
      .eq("kalla", KALLA)
      .eq("object_type", "mote_kedja")
      .eq("object_id", kedja)
      .limit(200);
    const ids = ((notiser ?? []) as { id: number }[]).map((n) => notisId(KALLA, String(n.id)));
    if (ids.length) {
      await db
        .from("notification_dismissed")
        .upsert(ids.map((notice_id) => ({ employee_id: mig, notice_id })), { onConflict: "employee_id,notice_id", ignoreDuplicates: true });
    }
    return satt ?? forra?.sett_till ?? null;
  };

  /** Hela tråden som klienten ritar den: inläggen i ordning, vilka som är med, mötenas tider och min markering. */
  const trad = async (k: Kedja, sett?: { sett_till: string; tyst: boolean } | null): Promise<Svar | NextResponse> => {
    const [{ data: rader, error }, egen] = await Promise.all([
      db.from("mote_anteckning").select(FALT).eq("kedja_id", k.id).order("skapad", { ascending: false }).order("id", { ascending: false }).limit(TRAD_MAX + 1),
      sett === undefined ? minSett(k.id) : Promise.resolve(sett),
    ]);
    if (error) return svar({ fel: "Nav kunde inte läsa anteckningarna. Försök igen." }, 500);
    const lista = (rader ?? []) as Inlagg[];
    const visas = iOrdning(lista.slice(0, TRAD_MAX));
    const personer = [...new Set([...(k.deltagare ?? []), ...visas.map((a) => a.av)])];
    const moteIds = [...new Set(visas.map((a) => a.mote_id).filter((x): x is string => !!x))];
    const [{ data: folk }, { data: moten }] = await Promise.all([
      personer.length ? db.from("employee").select("id, first_name, last_name, status").in("id", personer).limit(personer.length) : Promise.resolve({ data: [] }),
      moteIds.length ? db.from("mote").select("id, mote_tid").in("id", moteIds).limit(moteIds.length) : Promise.resolve({ data: [] }),
    ]);
    const rad = (folk ?? []) as { id: string; first_name: string; last_name: string; status: string }[];
    const namn = new Map(rad.map((p) => [p.id, fullName(p)]));
    const aktiva = new Set(rad.filter((p) => p.status !== "offboarded").map((p) => p.id));
    return {
      ok: "Anteckningarna.",
      kedja: k.id,
      jag: mig,
      inlagg: visas.map((a) => tillKlient(a, namn)),
      fler: lista.length > TRAD_MAX,
      med: (k.deltagare ?? []).filter((id) => aktiva.has(id)).map((id) => ({ id, namn: namn.get(id) ?? "" })),
      moten: Object.fromEntries(((moten ?? []) as { id: string; mote_tid: string }[]).map((m) => [m.id, m.mote_tid])),
      settTill: egen?.sett_till ?? null,
      tyst: egen?.tyst ?? false,
      skrivlage: SKRIVLAGE.moten,
    };
  };
  const tradSvar = async (k: Kedja, extra: Svar = {}, sett?: { sett_till: string; tyst: boolean } | null) => {
    const t = await trad(k, sett);
    return t instanceof NextResponse ? t : svar({ ...t, ...extra });
  };

  /** Kedjans aktuella möte: det öppna, annars det senaste. Inlägget minns det, så att tråden kan sätta ut mötesdagen. */
  const aktuelltMote = async (kedja: string): Promise<string | null> => {
    const { data } = await db.from("mote").select("id, utfall, mote_tid").eq("kedja_id", kedja).order("mote_tid", { ascending: false }).limit(20);
    const m = (data ?? []) as { id: string; utfall: string | null }[];
    return (m.find((x) => x.utfall === null) ?? m[0])?.id ?? null;
  };

  /** Notisen till de andra. Skrivs innan svaret (en insert); pushen går efter svaret (`notifieraFlera`). Kastar aldrig. */
  const notifieraOm = async (k: Kedja, text: string): Promise<number> => {
    try {
      const [{ data: forf }, { data: tysta }, { data: bolag }] = await Promise.all([
        db.from("mote_anteckning").select("av").eq("kedja_id", k.id).limit(1000),
        db.from("mote_anteckning_sett").select("employee_id").eq("kedja_id", k.id).eq("tyst", true).limit(500),
        db.from("mote_bolag").select("namn").eq("id", k.bolag_id).maybeSingle(),
      ]);
      const forfattare = [...new Set(((forf ?? []) as { av: string }[]).map((x) => x.av))];
      const kandidater = [...new Set([...(k.deltagare ?? []), ...forfattare])].filter((id) => id !== mig);
      if (!kandidater.length) return 0;
      const { data: aktivaRader } = await db.from("employee").select("id").in("id", kandidater).neq("status", "offboarded").limit(kandidater.length);
      const till = mottagare({
        deltagare: k.deltagare ?? [],
        forfattare,
        av: mig,
        tysta: ((tysta ?? []) as { employee_id: string }[]).map((x) => x.employee_id),
        aktiva: new Set(((aktivaRader ?? []) as { id: string }[]).map((x) => x.id)),
      });
      // Chefen som läser utan att vara med eller ha skrivit får ingen notis: `mottagare` tar bara deltagare och författare.
      if (!till.length) return 0;
      const { rubrik, detalj } = notisText({ fornamn: user.employee!.first_name, bolag: (bolag as { namn: string } | null)?.namn ?? "kunden", text });
      return await notifieraFlera(till, {
        av: mig,
        kalla: "mote-anteckning",
        typ: "chatt",
        rubrik,
        detalj,
        href: `/moten/${k.id}?visa=anteckningar`,
        objekt: { typ: "mote_kedja", id: k.id },
      });
    } catch {
      return 0;
    }
  };

  switch (handling) {
    case "las": {
      const k = await kedjan(b.kedja);
      if (k instanceof NextResponse) return k;
      return await tradSvar(k);
    }

    case "skriv": {
      const id = idIndata(b.id);
      if (!id) return svar({ fel: "Ogiltig begäran." }, 400);
      const t = textIndata(b.text);
      if (!t.ok) return svar({ fel: t.fel }, 400);
      const k = await kedjan(b.kedja);
      if (k instanceof NextResponse) return k;

      const moteId = await aktuelltMote(k.id);
      const { data: ny, error } = await db
        .from("mote_anteckning")
        .upsert({ id, kedja_id: k.id, mote_id: moteId, av: mig, text: t.text }, { onConflict: "id", ignoreDuplicates: true })
        .select(FALT);
      if (error) return svar({ fel: "Anteckningen sparades inte. Försök igen." }, 500);
      let rad: Inlagg | null = ((ny ?? []) as Inlagg[])[0] ?? null;
      const skrevsNu = !!rad;
      if (!rad) {
        // Samma id en gång till: ett nytt försök efter ett nätfel, eller ett dubbeltryck. Är det mitt i samma kedja
        // står inlägget redan; annars är id:t någon annans.
        const { data: fanns } = await db.from("mote_anteckning").select(FALT).eq("id", id).maybeSingle();
        rad = (fanns as Inlagg | null) ?? null;
        if (!rad || rad.av !== mig || rad.kedja_id !== k.id) return svar({ fel: "Anteckningen kunde inte sparas. Ladda om och försök igen." }, 409);
      }

      const forra = await minSett(k.id);
      const sett = await markeraSett(k.id, rad.skapad, forra);
      let notis = 0;
      if (skrevsNu) {
        notis = await notifieraOm(k, t.text);
        await skrivHandelse({ actorId: mig, action: "mote.anteckning_skriven", objectType: "mote_kedja", objectId: k.id, meta: { anteckning: id, mote: moteId, tecken: t.text.length, notiser: notis } });
      }
      return await tradSvar(k, { ok: "Sparad.", sparad: id, notiser: notis }, sett ? { sett_till: sett, tyst: forra?.tyst ?? false } : forra);
    }

    case "andra":
    case "ta_bort": {
      const id = idIndata(b.id);
      if (!id) return svar({ fel: "Ogiltig begäran." }, 400);
      const { data: fanns } = await db.from("mote_anteckning").select(FALT).eq("id", id).maybeSingle();
      const rad = (fanns as Inlagg | null) ?? null;
      if (!rad) return svar({ fel: "Anteckningen finns inte längre." }, 404);
      const k = await kedjan(rad.kedja_id);
      if (k instanceof NextResponse) return k;
      if (rad.av !== mig) return svar({ fel: "Du kan bara ändra dina egna anteckningar." }, 403);
      if (rad.borttagen) return await tradSvar(k, { ok: "Anteckningen är redan borttagen." });

      if (handling === "ta_bort") {
        const { data: upd, error } = await db
          .from("mote_anteckning")
          .update({ text: null, borttagen: new Date().toISOString() })
          .eq("id", id)
          .is("borttagen", null)
          .select("id");
        if (error) return svar({ fel: "Anteckningen togs inte bort. Försök igen." }, 500);
        if (((upd ?? []) as unknown[]).length) {
          await skrivHandelse({ actorId: mig, action: "mote.anteckning_borttagen", objectType: "mote_kedja", objectId: k.id, meta: { anteckning: id } });
        }
        return await tradSvar(k, { ok: "Borttagen." });
      }

      const t = textIndata(b.text);
      if (!t.ok) return svar({ fel: t.fel }, 400);
      if (t.text === rad.text) return await tradSvar(k, { ok: "Ingen ändring." });
      // Villkorad på den ändring klienten såg: två flikar som ändrar samma inlägg skriver inte över varandra tyst.
      const fore = b.fore === null || b.fore === undefined ? null : String(b.fore);
      let q = db.from("mote_anteckning").update({ text: t.text, andrad: new Date().toISOString() }).eq("id", id).is("borttagen", null);
      q = fore === null ? q.is("andrad", null) : q.eq("andrad", fore);
      const { data: upd, error } = await q.select("id");
      if (error) return svar({ fel: "Ändringen sparades inte. Försök igen." }, 500);
      if (!((upd ?? []) as unknown[]).length) {
        const t2 = await trad(k);
        return t2 instanceof NextResponse ? t2 : svar({ ...t2, ok: undefined, fel: "Anteckningen har ändrats sedan du öppnade den. Se den nya texten och försök igen." }, 409);
      }
      await skrivHandelse({ actorId: mig, action: "mote.anteckning_andrad", objectType: "mote_kedja", objectId: k.id, meta: { anteckning: id, tecken: t.text.length } });
      return await tradSvar(k, { ok: "Ändrad." });
    }

    case "sett": {
      const k = await kedjan(b.kedja);
      if (k instanceof NextResponse) return k;
      const forra = await minSett(k.id);
      const satt = await markeraSett(k.id, b.till, forra);
      return svar({ ok: "Sett.", settTill: satt });
    }

    case "tyst": {
      const k = await kedjan(b.kedja);
      if (k instanceof NextResponse) return k;
      const tyst = b.tyst === true;
      const forra = await minSett(k.id);
      const { error } = await db
        .from("mote_anteckning_sett")
        // Utan markering sedan förut: inget räknas som sett av att tråden tystas.
        .upsert({ kedja_id: k.id, employee_id: mig, sett_till: forra?.sett_till ?? "1970-01-01T00:00:00Z", tyst }, { onConflict: "kedja_id,employee_id" });
      if (error) return svar({ fel: "Det sparades inte. Försök igen." }, 500);
      return svar({ ok: tyst ? "Du får inga notiser från anteckningarna här." : "Du får notiser från anteckningarna igen.", tyst });
    }
  }
  return svar({ fel: "Okänd handling." }, 400);
}
