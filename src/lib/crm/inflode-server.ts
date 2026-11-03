import "server-only";

import { supabaseAdmin } from "@/lib/supabase/server";
import { notifieraFlera } from "@/lib/notishandelse-server";
import { nivaFor } from "@/lib/nav2/forma";
import { avtaletsOrder, inkioKonfigurerad, inkioKund, inkioLank, inkioUrl, kundhistorik, type Kundaktivitet } from "./inkio";
import { arSlutbetald } from "./ekonomi-server";
import {
  aktivitetsrader,
  attJamfora,
  attLasa,
  avtryck,
  jamfor,
  kopplaPaOrgnr,
  kretsen,
  notisFor,
  provfilter,
  senastHant,
  statusFranInkio,
  statusfelNotis,
  tolkaPost,
  type Forfattarnyckel,
  type Lagrad,
  type Navanteckning,
  type Niva,
  type Rad,
  type Statusandring,
  type Tidigare,
} from "./inflode";

/**
 * Inkio in i Nav (0277): bevakningen. Ringd varje minut av `nav-inkio`
 * (pg_cron → /api/jobb/inkio) och direkt av Inkios webhooks för en enda kund.
 *
 * =============================================================================
 * VARJE KUND, OCH DATABASEN RÖRS BARA NÄR NÅGOT HÄNT
 *
 * Varje kund som har en order i Nav (inte utkast) läses med ett anrop: den
 * med något nytt varje minut, den tysta minst var femte (`attLasa`). Hela
 * svaret får ett avtryck; är det samma som förra gången skrivs bara att
 * kunden lästs, och en gång i timmen jämförs Navs kopia ändå (`attJamfora`),
 * så att en rad som försvunnit därifrån kommer tillbaka. Databasen är Nano
 * och swappar (2026-11-02) — trettio kunder i minuten får inte bli trettio
 * skrivningar i minuten.
 * =============================================================================
 *
 * Det som kommer in:
 *   - sparas i `crm_handelse` (ny, ändrad, raderad), och syns i kundkortets
 *     flik Aktivitet;
 *   - ger notis till kretsen (`kretsen` i inflode.ts) — aldrig till den som
 *     skrev, aldrig om Navs eget eko, aldrig om det gamla (tolv timmar);
 *   - makulerar, markerar betald eller avslutar avtalsbevakningen när Inkio
 *     säger det om en kopplad order (`styr_status`); betald först när ordern är
 *     slutbetald, alla fakturor i planen betalda (`arSlutbetald`, som Inkio);
 *   - kopplar äldre order på organisationsnummer när det är entydigt.
 *
 * Kastar aldrig. Fel per kund står på `crm_kund.fel`; står hela bevakningen
 * still larmar utkorgens minutjobb superadmin (`larmaOmBevakningenStar`).
 */

const SAMTIDIGA = 4;
const SOK_IGEN_MS = 30 * 60 * 1000;
const NAV_SKAPADE_NYSS_MS = 2 * 60 * 60 * 1000;
const AKTIV = new Set(["active", "onboarding"]);

export type Bevakning = {
  kunder: number;
  /** Tysta kunder som inte stod på tur det här varvet. */
  vilande: number;
  lasta: number;
  ororda: number;
  nya: number;
  andrade: number;
  notiser: number;
  status: number;
  kopplade: number;
  /** Rader som saknades i Navs kopia och lades tillbaka (`attJamfora`). */
  lagade: number;
  fel: string[];
  ms: number;
};

type Order = {
  id: string;
  org_number: string;
  company_name: string;
  salesperson_id: string;
  status: string;
  order_value: number | string | null;
  approved_at: string | null;
};

type Kundrad = {
  org_number: string;
  customer_id: string | null;
  customer_number: string | null;
  customer_name: string | null;
  forsta_klar: boolean;
  avtryck: string | null;
  senast_sokt: string | null;
  senast_last: string | null;
  andrad_at: string | null;
};

type Person = { id: string; email: string | null; status: string; manager_id: string | null; team_id: string | null; first_name: string | null; last_name: string | null };

/** Supabase-API:t kapar tyst vid 1000 rader. Läs sidvis. */
async function allaOrder(): Promise<Order[]> {
  const db = supabaseAdmin();
  const ut: Order[] = [];
  for (let fran = 0; ; fran += 1000) {
    const { data, error } = await db
      .from("sales_order")
      .select("id, org_number, company_name, salesperson_id, status, order_value, approved_at")
      .neq("status", "utkast")
      .not("org_number", "is", null)
      .order("created_at")
      .range(fran, fran + 999);
    if (error) throw new Error(`Orderna gick inte att läsa: ${error.message}`);
    ut.push(...((data ?? []) as Order[]));
    if (!data || data.length < 1000) break;
  }
  return ut.filter((o) => /^\d{6}-\d{4}$/.test(o.org_number));
}

type Katalog = { personer: Map<string, Person>; epost: Map<string, string>; niva: Map<string, Niva>; lead: Map<string, string> };

/** Personerna, rollerna och teamen — små tabeller, lästa en gång per varv och bara när något kom in. */
class Personer {
  private las: Promise<Katalog> | null = null;

  private hamta(): Promise<Katalog> {
    if (!this.las) this.las = (async () => {
      const db = supabaseAdmin();
      const [{ data: p }, { data: r }, { data: t }] = await Promise.all([
        db.from("employee").select("id, email, status, manager_id, team_id, first_name, last_name"),
        db.from("employee_role").select("employee_id, role"),
        db.from("team").select("id, lead_id"),
      ]);
      const personer = new Map(((p ?? []) as Person[]).map((x) => [x.id, x] as const));
      const epost = new Map<string, string>();
      for (const x of personer.values()) if (x.email && AKTIV.has(x.status)) epost.set(x.email.toLowerCase(), x.id);
      const roller = new Map<string, string[]>();
      for (const x of (r ?? []) as { employee_id: string; role: string }[]) roller.set(x.employee_id, [...(roller.get(x.employee_id) ?? []), x.role]);
      const niva = new Map<string, Niva>();
      for (const [id, rr] of roller) niva.set(id, nivaFor(rr));
      const lead = new Map(((t ?? []) as { id: string; lead_id: string | null }[]).filter((x) => x.lead_id).map((x) => [x.id, x.lead_id as string] as const));
      return { personer, epost, niva, lead };
    })();
    return this.las;
  }

  /**
   * Författarens nivå i Nav, för kundkortets Per roll: anställnings-id:t för en
   * anteckning skriven i Nav, e-posten för en i Inkio, namnet för Navs eko.
   * Null när hen inte finns i Nav (EffektivMedias personal).
   */
  async nivaAv(): Promise<(k: Forfattarnyckel) => Niva | null> {
    const { personer, epost, niva } = await this.hamta();
    const namn = new Map<string, string>();
    for (const p of personer.values()) {
      const n = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim().toLowerCase();
      if (n && (AKTIV.has(p.status) || !namn.has(n))) namn.set(n, p.id);
    }
    return (k) => {
      const id = (k.id && personer.has(k.id) ? k.id : null) ?? (k.epost ? epost.get(k.epost.toLowerCase()) : null) ?? (k.namn ? namn.get(k.namn.trim().toLowerCase()) : null) ?? null;
      return id ? (niva.get(id) ?? "salesperson") : null;
    };
  }

  /** Namnet på en anställd (den som tog bort en anteckning, 0283). */
  async namnAv(): Promise<(id: string) => string | null> {
    const { personer } = await this.hamta();
    return (id) => {
      const p = personer.get(id);
      return p ? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || null : null;
    };
  }

  async fran(epost: string | null): Promise<string | null> {
    if (!epost) return null;
    return (await this.hamta()).epost.get(epost.toLowerCase()) ?? null;
  }

  /** Kretsen för en kund: alla superadmin, säljarna på kundens order, och admin som leder dem. Bara aktiva. */
  async kretsFor(saljare: readonly string[]): Promise<string[]> {
    const { personer, niva, lead } = await this.hamta();
    const aktiv = (id: string) => AKTIV.has(personer.get(id)?.status ?? "");
    const superadmin = [...niva].filter(([id, n]) => n === "superadmin" && aktiv(id)).map(([id]) => id);
    const chefer = new Map<string, string[]>();
    for (const s of saljare) {
      const p = personer.get(s);
      chefer.set(s, [p?.manager_id, p?.team_id ? lead.get(p.team_id) : null].filter((x): x is string => Boolean(x) && x !== s));
    }
    return provfilter(kretsen({ superadmin, saljare: saljare.filter(aktiv), chefer, niva }).filter(aktiv));
  }
}

/** Hur många i taget. Inkio svarar på ~130 ms; fyra i taget gör trettio kunder på en sekund. */
async function iTur<T>(lista: readonly T[], fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(SAMTIDIGA, lista.length) }, async () => {
      while (i < lista.length) await fn(lista[i++]);
    }),
  );
}

/**
 * Ett varv. `bara` läser bara de kunderna (webhooken); annars alla.
 */
export async function bevaka(o: { bara?: readonly string[] } = {}): Promise<Bevakning> {
  const start = Date.now();
  const ut: Bevakning = { kunder: 0, vilande: 0, lasta: 0, ororda: 0, nya: 0, andrade: 0, notiser: 0, status: 0, kopplade: 0, lagade: 0, fel: [], ms: 0 };
  const klar = () => ({ ...ut, ms: Date.now() - start });

  try {
    if (!inkioKonfigurerad()) {
      ut.fel.push("Inkio är inte konfigurerat i den här miljön.");
      return klar();
    }
    const db = supabaseAdmin();
    const { data: inst } = await db.from("crm_installning").select("aktiv, inflode, styr_status").eq("id", true).maybeSingle();
    if (!inst?.aktiv || !inst.inflode) {
      ut.fel.push("Bevakningen är avstängd (crm_installning).");
      return klar();
    }

    // ETT VARV I TAGET. Minutjobbet och en webhook kan komma samtidigt, och då
    // hade båda sett samma nya rad och notifierat om den. Låset tas i en enda
    // UPDATE och släpps när varvet är klart; dör funktionen går det ut av sig
    // självt. Den som inte får låset gör ingenting — nästa minut tar det.
    const nuIso = new Date().toISOString();
    const { data: las } = await db
      .from("crm_installning")
      .update({ las_till: new Date(Date.now() + 55_000).toISOString() })
      .eq("id", true)
      .or(`las_till.is.null,las_till.lt.${nuIso}`)
      .select("id");
    if (!las || !las.length) {
      ut.fel.push("Ett annat varv pågår.");
      return klar();
    }
    try {
      await varv(o, ut, inst.styr_status === true);
    } finally {
      await db.from("crm_installning").update({ las_till: null }).eq("id", true);
    }
  } catch (e) {
    ut.fel.push(e instanceof Error ? e.message : String(e));
  }
  return klar();
}

async function varv(o: { bara?: readonly string[] }, ut: Bevakning, styrStatus: boolean): Promise<void> {
  const db = supabaseAdmin();
  const ordrar = await allaOrder();
  const perKund = new Map<string, Order[]>();
  for (const x of ordrar) perKund.set(x.org_number, [...(perKund.get(x.org_number) ?? []), x]);
  const alla = [...perKund.keys()].filter((k) => !o.bara || o.bara.includes(k));
  ut.kunder = alla.length;
  if (!alla.length) return;

  const { data: k } = await db
    .from("crm_kund")
    .select("org_number, customer_id, customer_number, customer_name, forsta_klar, avtryck, senast_sokt, senast_last, andrad_at")
    .in("org_number", alla);
  const kunder = new Map(((k ?? []) as Kundrad[]).map((x) => [x.org_number, x] as const));
  // En webhook om en viss kund läser den direkt; minutjobbet väljer varma och de kalla som står på tur.
  const nu = Date.now();
  const orgnr = o.bara
    ? alla
    : attLasa(
        alla.map((org) => {
          const x = kunder.get(org);
          const godkanda = (perKund.get(org) ?? []).map((y) => y.approved_at).filter((t): t is string => Boolean(t)).sort();
          return {
            org,
            klar: Boolean(x?.customer_id && x.forsta_klar),
            andrad: x?.andrad_at ?? null,
            last: x?.senast_last ?? null,
            godkand: godkanda[godkanda.length - 1] ?? null,
          };
        }),
        nu,
      );
  ut.vilande = alla.length - orgnr.length;
  const personer = new Personer();
  const ororda: string[] = [];

  await iTur(orgnr, async (org) => {
    try {
      let kund = kunder.get(org) ?? null;

      // Kunden i Inkio, uppslagen en gång och sedan var trettionde minut tills den finns.
      if (!kund?.customer_id) {
        if (kund?.senast_sokt && Date.now() - Date.parse(kund.senast_sokt) < SOK_IGEN_MS) return;
        const hittad = await inkioKund(org);
        const rad = {
          org_number: org,
          customer_id: hittad?.id ?? null,
          customer_number: hittad?.number ?? null,
          customer_name: hittad?.customer_name ?? null,
          senast_sokt: new Date().toISOString(),
          andrad_at: new Date().toISOString(),
        };
        await db.from("crm_kund").upsert(rad, { onConflict: "org_number" });
        kund = {
          org_number: org,
          customer_id: rad.customer_id,
          customer_number: rad.customer_number,
          customer_name: rad.customer_name,
          senast_sokt: rad.senast_sokt,
          forsta_klar: kund?.forsta_klar ?? false,
          avtryck: kund?.avtryck ?? null,
          senast_last: kund?.senast_last ?? null,
          andrad_at: rad.andrad_at,
        };
        if (!hittad) return;
        // Anteckningar skrivna i Nav innan kunden fanns i Inkio går ut nu.
        await kaAnteckningarSomVantar(org);
      }

      const kundId = kund?.customer_id;
      if (!kund || !kundId) return;
      const historik = await kundhistorik(kundId);
      ut.lasta++;
      const helt = avtryck(historik.items);
      const samma = kund.forsta_klar && kund.avtryck === helt;
      if (samma && !attJamfora(org, kund.senast_last, Date.now())) {
        ut.ororda++;
        ororda.push(org);
        return;
      }

      await lasIn(org, kund, historik.items, historik.roller, perKund.get(org) ?? [], personer, styrStatus, ut, samma);
      if (samma) {
        ut.ororda++;
        ororda.push(org);
        return;
      }
      const nuIso = new Date().toISOString();
      await db
        .from("crm_kund")
        .update({
          avtryck: helt,
          forsta_klar: true,
          senast_last: nuIso,
          senast_ok: nuIso,
          fel: null,
          andrad_at: kund.forsta_klar ? nuIso : senastHant(historik.items, Date.now()),
        })
        .eq("org_number", org);
    } catch (e) {
      const fel = e instanceof Error ? e.message : String(e);
      ut.fel.push(`${org}: ${fel}`.slice(0, 300));
      await db.from("crm_kund").update({ fel: fel.slice(0, 500), senast_last: new Date().toISOString() }).eq("org_number", org);
    }
  });

  // De oförändrade i en skrivning, inte en per kund.
  if (ororda.length) {
    const nu = new Date().toISOString();
    await db.from("crm_kund").update({ senast_last: nu, senast_ok: nu, fel: null }).in("org_number", ororda);
  }
  if (!o.bara) await kaOmAnteckningar();
}

/**
 * EN ANTECKNING FRÅN NAV FÅR INTE BLI LIGGANDE. Står den kvar i kö efter fem
 * minuter (kopplingen var avslagen, eller raden försvann) köas den igen; gick
 * den fel (Inkio svarade inte tre gånger) försöks den igen en gång i timmen.
 * `anteckningICrm` skriver aldrig samma anteckning två gånger.
 */
async function kaOmAnteckningar(): Promise<void> {
  const db = supabaseAdmin();
  const { data: inst } = await db.from("crm_installning").select("utflode").eq("id", true).maybeSingle();
  if (!inst?.utflode) return;
  // `*`: `raderad_at` (0283) finns först när migrationen körts. En borttagen anteckning skrivs aldrig dit.
  const { data } = await db
    .from("kundanteckning")
    .select("*")
    .in("crm_state", ["ko", "fel"])
    .is("crm_id", null)
    .lt("skriven_at", new Date(Date.now() - 5 * 60 * 1000).toISOString())
    .limit(50);
  const vantar = ((data ?? []) as { id: string; crm_state: string; raderad_at?: string | null }[]).filter((a) => !a.raderad_at);
  if (!vantar.length) return;
  const { data: rader } = await db
    .from("outbox")
    .select("payload, created_at, sent_at, error")
    .eq("kind", "crm")
    .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .contains("payload", { handling: "anteckning" });
  const senast = new Map<string, { created_at: string; klar: boolean }>();
  for (const r of (rader ?? []) as { payload: { id?: string }; created_at: string; sent_at: string | null; error: string | null }[]) {
    const id = r.payload?.id;
    if (!id) continue;
    const f = senast.get(id);
    if (!f || f.created_at < r.created_at) senast.set(id, { created_at: r.created_at, klar: Boolean(r.sent_at || r.error) });
  }
  for (const a of vantar) {
    const f = senast.get(a.id);
    if (f && !f.klar) continue;
    if (a.crm_state === "fel" && f && Date.now() - Date.parse(f.created_at) < 60 * 60 * 1000) continue;
    await kaAnteckning(a.id, 0);
  }
}

/** En kunds historik in i `crm_handelse`, med notiser, status och koppling. */
/** `lagaKopian`: Inkios svar är detsamma som förra gången, och bara det som saknas i Navs kopia skrivs. */
async function lasIn(org: string, kund: Kundrad, items: Parameters<typeof tolkaPost>[0][], roller: Readonly<Record<string, string>>, ordrar: Order[], personer: Personer, styrStatus: boolean, ut: Bevakning, lagaKopian = false) {
  const db = supabaseAdmin();
  const rader = items.map((p) => tolkaPost(p, roller)).filter((r): r is Rad => r !== null);
  const sedda = new Set<string>();
  const unika = rader.filter((r) => !sedda.has(r.extern_id) && sedda.add(r.extern_id));

  const { data: finns } = await db
    .from("crm_handelse")
    .select("extern_id, avtryck, text, data, raderad, andrad")
    .eq("system", "inkio")
    .eq("org_number", org);
  const tidigare = new Map(((finns ?? []) as (Tidigare & { extern_id: string })[]).map((x) => [x.extern_id, x] as const));

  const bolag = ordrar.slice().sort((a, b) => (a.approved_at ?? "").localeCompare(b.approved_at ?? "")).pop()?.company_name ?? kund.customer_name ?? org;
  const saljare = [...new Set(ordrar.map((x) => x.salesperson_id))];
  const { data: navKoppling } = await db.from("crm_order").select("order_id, crm_order_id, kopplad, synced_at").in("order_id", ordrar.map((x) => x.id));
  const kopplingar = (navKoppling ?? []) as { order_id: string; crm_order_id: string | null; kopplad: string; synced_at: string }[];
  const navSkapadeNyss = kopplingar.some((x) => x.kopplad === "nav" && Date.now() - Date.parse(x.synced_at) < NAV_SKAPADE_NYSS_MS);

  const nu = Date.now();
  const skriv: Record<string, unknown>[] = [];
  const att: { r: Rad; f: ReturnType<typeof jamfor>; av: string | null }[] = [];
  for (const r of unika) {
    const f = jamfor(tidigare.get(r.extern_id), r);
    if (f.typ === "samma") continue;
    const av = await personer.fran(r.forfattare_epost);
    if (lagaKopian) ut.lagade++;
    else if (f.typ === "ny") ut.nya++;
    else ut.andrade++;
    att.push({ r, f, av });
    skriv.push({
      system: "inkio",
      extern_id: r.extern_id,
      org_number: org,
      slag: r.slag,
      sort: r.sort,
      om_typ: r.om_typ,
      om_id: r.om_id,
      om_titel: r.om_titel,
      om_nummer: r.om_nummer,
      text: r.text,
      data: r.data,
      forfattare: r.forfattare,
      forfattare_epost: r.forfattare_epost,
      forfattare_id: av,
      fran_nav: r.fran_nav,
      skapad: r.skapad,
      andrad: r.andrad,
      raderad: r.raderad,
      avtryck: r.avtryck,
      uppdaterad_at: new Date().toISOString(),
    });
  }
  if (!skriv.length) return;

  // Raden först: en notis om något som inte går att se i Nav är värre än ingen.
  const { error } = await db.from("crm_handelse").upsert(skriv, { onConflict: "system,extern_id" });
  if (error) throw new Error(`crm_handelse: ${error.message}`);
  // Inkio har inte ändrats, bara kopian: notisen, statusen och kopplingen har redan hänt en gång.
  if (lagaKopian) return;

  let krets: string[] | null = null;
  for (const { r, f, av } of att) {
    // Ändrar Inkio ordern i Nav skickar `tillampa` den riktiga notisen (med
    // avdraget vid en makulering). Den allmänna om samma sak hade blivit en till.
    const s = statusFranInkio(r, f, nu);
    const tillampad = s && styrStatus ? await tillampa(s, bolag, personer) : false;
    if (tillampad) ut.status++;

    const n = tillampad && s?.vad !== "uppsagt" ? null : notisFor(r, f, { bolag, nu, navSkapadeNyss, forsta: !kund.forsta_klar });
    if (n) {
      krets ??= await personer.kretsFor(saljare);
      const antal = await notifieraFlera(krets, {
        av,
        kalla: n.kalla,
        typ: "order",
        rubrik: n.rubrik,
        detalj: n.detalj,
        href: `/order/kund/${encodeURIComponent(org)}`,
        objekt: { typ: "customer", id: org },
      });
      ut.notiser += antal;
      await db.from("crm_handelse").update({ notifierad_at: new Date().toISOString() }).eq("system", "inkio").eq("extern_id", r.extern_id);
    }
  }

  // Inte `+= await`: summan lästes före väntan, och fyra kunder i taget skrev över varandra (provet räknade 10 av 20).
  const kopplade = await koppla(org, kund, unika, ordrar, kopplingar);
  ut.kopplade += kopplade;
}

/**
 * Inkio sa makulerad, betald eller uppsagt om en order Nav har kopplad.
 * Ändringen går genom `lk_inkio_andra_order`, som gör att den inte skrivs
 * tillbaka till Inkio. Returnerar om ordern ändrades.
 */
async function tillampa(s: Statusandring, bolag: string, personer: Personer): Promise<boolean> {
  const db = supabaseAdmin();
  const inkioOrder = s.vad === "uppsagt" ? await avtaletsOrder(s.inkioAvtal) : s.inkioOrder;
  if (!inkioOrder) return false;
  const { data: k } = await db.from("crm_order").select("order_id, state").eq("crm_order_id", inkioOrder).maybeSingle();
  if (!k) return false;
  const orderId = k.order_id as string;

  if (s.vad === "makulerad") {
    // Nav makulerade själv (bocken i Makulera): ekot ska inte göra något.
    if (k.state === "makulerad") return false;
    // En rättning från Nav nyss: Inkio kan ha ersatt ordern. Makulera inte —
    // säg till superadmin, som avgör (provisionen dras annars i fel månad).
    const halvtimme = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: nyss } = await db
      .from("outbox")
      .select("id")
      .eq("kind", "crm")
      .contains("payload", { handling: "nav-handelse", typ: "rattad", order_id: orderId })
      .gte("created_at", halvtimme)
      .limit(1);
    if (nyss && nyss.length) {
      const krets = await personer.kretsFor([]);
      await notifieraFlera(krets, {
        av: null,
        kalla: "order-inkio-makulerad",
        typ: "order",
        rubrik: `${bolag}: ordern makulerades i Inkio strax efter en rättning i Nav`,
        detalj: "Nav makulerade den inte. Kontrollera i Inkio och makulera i Nav om den ska bort.",
        href: `/order/${orderId}`,
        objekt: { typ: "sales_order", id: orderId },
      });
      return false;
    }
  }

  // BETALD = SLUTBETALD, som i Inkio (`ekonomi.ts`): en betald faktura av tolv gör inte ordern
  // betald. Ordern sätts betald först när Inkio säger att varje faktura i planen är betald;
  // fram till dess syns betalningarna på kortet ("3 av 12 betalda").
  if (s.vad === "betald") {
    const b = await arSlutbetald(inkioOrder);
    if (!b?.slutbetald) return false;
    s = { ...s, skal: `Slutbetald i Inkio: ${b.betalda} av ${b.totalt} fakturor betalda.` };
  }

  const { data: andrad, error } = await db.rpc("lk_inkio_andra_order", { p_order: orderId, p_vad: s.vad, p_skal: s.skal });
  if (error) {
    // Aldrig tyst igen: raden står redan i crm_handelse med det nya läget, så
    // övergången provas inte en gång till. Superadmin får göra det för hand.
    await db.from("integration_log").insert({ system: "crm", direction: "in", body: { fel: error.message, kod: error.code, order_id: orderId, vad: s.vad, inkio_order: inkioOrder } });
    const larm = statusfelNotis(s, bolag, error.message);
    await notifieraFlera(await personer.kretsFor([]), {
      av: null,
      kalla: "inkio-bevakning",
      typ: "fel",
      rubrik: larm.rubrik,
      detalj: larm.detalj,
      href: `/order/${orderId}`,
      objekt: { typ: "sales_order", id: orderId },
    });
    return false;
  }
  if (andrad !== true) return false;

  const { data: o } = await db.from("sales_order").select("company_name, salesperson_id, commission_amount, cancelled_on").eq("id", orderId).maybeSingle();
  const action = s.vad === "makulerad" ? "sales_order.cancelled_in_crm" : s.vad === "betald" ? "sales_order.paid_in_crm" : "sales_order.not_renewed_in_crm";
  await db.from("audit_log").insert({ actor_id: null, action, object_type: "sales_order", object_id: orderId, meta: { skal: s.skal, inkio_order: inkioOrder } });

  if (s.vad === "makulerad") {
    await db.from("crm_order").update({ state: "makulerad", error: null, synced_at: new Date().toISOString() }).eq("order_id", orderId);
    const belopp = Number(o?.commission_amount ?? 0);
    const manad = String(o?.cancelled_on ?? "").slice(0, 7);
    await notifieraFlera(provfilter([o?.salesperson_id as string | undefined, ...(await personer.kretsFor([]))]), {
      av: null,
      kalla: "order-makulerad",
      typ: "order",
      rubrik: `Makulerad i Inkio: ${o?.company_name ?? bolag}`,
      detalj: `${belopp ? `Avdrag ${belopp.toLocaleString("sv-SE")} kr i ${manad}` : "Provisionen dras tillbaka"} · ${s.skal}`,
      href: `/order/${orderId}`,
      objekt: { typ: "sales_order", id: orderId },
    });
  } else if (s.vad === "betald") {
    await notifieraFlera(provfilter([o?.salesperson_id as string | undefined]), {
      av: null,
      kalla: "order-betald",
      typ: "order",
      rubrik: `Slutbetald: ${o?.company_name ?? bolag}`,
      detalj: `${s.skal} Provisionen är oförändrad — den utgår från signeringen.`,
      href: `/order/${orderId}`,
      objekt: { typ: "sales_order", id: orderId },
    });
  }
  return true;
}

/** Äldre order kopplas på organisationsnummer och värde (`kopplaPaOrgnr`). */
async function koppla(org: string, kund: Kundrad, rader: Rad[], ordrar: Order[], kopplingar: { order_id: string; crm_order_id: string | null }[]): Promise<number> {
  const godkanda = ordrar.filter((x) => x.status === "signerad" || x.status === "betald");
  const kopplade = new Set(kopplingar.map((x) => x.order_id));
  if (!godkanda.some((x) => !kopplade.has(x.id))) return 0;

  const inkioOrdrar = rader
    .filter((r) => r.slag === "post" && r.sort === "order" && r.om_id)
    .map((r) => {
      const v = r.data?.value;
      return { id: r.om_id as string, nummer: r.om_nummer, varde: v === undefined || v === null ? null : Number(v), makulerad: r.data?.cancelled === true };
    });
  if (!inkioOrdrar.length) return 0;

  const db = supabaseAdmin();
  const { data: upptagna } = await db.from("crm_order").select("crm_order_id").in("crm_order_id", inkioOrdrar.map((x) => x.id));
  const par = kopplaPaOrgnr(
    godkanda.map((x) => ({ id: x.id, varde: x.order_value === null ? null : Number(x.order_value), kopplad: kopplade.has(x.id) })),
    inkioOrdrar,
    new Set(((upptagna ?? []) as { crm_order_id: string }[]).map((x) => x.crm_order_id)),
  );
  let n = 0;
  for (const p of par) {
    const { error } = await db.from("crm_order").insert({
      order_id: p.navId,
      system: "inkio",
      customer_id: kund.customer_id,
      customer_number: kund.customer_number,
      crm_order_id: p.inkioId,
      crm_order_number: p.nummer,
      state: "inskickad",
      kopplad: "orgnr",
      synced_at: new Date().toISOString(),
    });
    if (error) continue;
    await db.from("audit_log").insert({ actor_id: null, action: "sales_order.linked_to_crm", object_type: "sales_order", object_id: p.navId, meta: { org, inkio_order: p.inkioId, nummer: p.nummer } });
    n++;
  }
  return n;
}

/** Kretsen för en kund, för det som händer i Nav (en anteckning från kundkortet). */
export async function kretsForKund(org: string): Promise<string[]> {
  const { data } = await supabaseAdmin().from("sales_order").select("salesperson_id").eq("org_number", org).neq("status", "utkast");
  const saljare = [...new Set(((data ?? []) as { salesperson_id: string }[]).map((x) => x.salesperson_id))];
  return new Personer().kretsFor(saljare);
}

/** Anteckningar som skrevs medan kunden saknades i Inkio köas när den finns. */
async function kaAnteckningarSomVantar(org: string): Promise<void> {
  const db = supabaseAdmin();
  const { data } = await db.from("kundanteckning").select("id").eq("org_number", org).eq("crm_state", "ingen-kund");
  for (const a of (data ?? []) as { id: string }[]) {
    await db.from("kundanteckning").update({ crm_state: "ko" }).eq("id", a.id);
    await kaAnteckning(a.id, 0);
  }
}

/**
 * En anteckning till utkorgen. `sekunder` = när den får gå. `handling`:
 * `anteckning` skriver den till Inkio, `anteckning-andrad` och
 * `anteckning-borttagen` (0283) skriver ändringen och borttagningen dit.
 */
export async function kaAnteckning(id: string, sekunder = 2, handling: "anteckning" | "anteckning-andrad" | "anteckning-borttagen" = "anteckning"): Promise<void> {
  await supabaseAdmin()
    .from("outbox")
    .insert({
      kind: "crm",
      payload: { handling, id },
      idempotency_key: `crm-${handling}:${id}:${Date.now()}`,
      not_before: new Date(Date.now() + sekunder * 1000).toISOString(),
    });
}

// -----------------------------------------------------------------------------
// Kundkortets flik Aktivitet
// -----------------------------------------------------------------------------

/**
 * Fliken ur Navs kopia: snabb, och kvar när Inkio inte svarar. Null när
 * bevakningen inte läst kunden än — då läser kortet Inkio direkt.
 *
 * `kundanteckning` läses med `*`: kolumnen `om_order` (0278) finns först när
 * migrationen körts, och fliken ska fungera före dess.
 */
export async function kundaktivitetUrNav(org: string, superadmin: boolean, o: { utanInkio?: boolean } = {}): Promise<Kundaktivitet | null> {
  const db = supabaseAdmin();
  const personer = new Personer();
  const [{ data: k }, { data: rader }, nav, nivaAv, namnAv] = await Promise.all([
    db.from("crm_kund").select("customer_id, customer_number, customer_name, forsta_klar").eq("org_number", org).maybeSingle(),
    db
      .from("crm_handelse")
      .select("extern_id, slag, sort, om_typ, om_id, om_titel, om_nummer, text, data, forfattare, forfattare_epost, fran_nav, skapad, andrad, raderad, avtryck")
      .eq("system", "inkio")
      .eq("org_number", org)
      .order("skapad", { ascending: false })
      .limit(400),
    navAnteckningar(org),
    personer.nivaAv(),
    personer.namnAv(),
  ]);

  // Utan Inkio (previewen) räcker Navs egna anteckningar; annars krävs att bevakningen läst kunden.
  if (!k?.forsta_klar && !(o.utanInkio && nav.length)) return null;
  const lista = aktivitetsrader((rader ?? []) as Lagrad[], nav, { superadmin, inkioBas: inkioUrl(), nivaAv, namnAv });
  if (!k?.customer_id) {
    return nav.length ? { kund: { id: "", nummer: "", namn: "", lank: "" }, rader: lista, avkortad: false } : { kund: null };
  }
  return {
    kund: { id: k.customer_id, nummer: k.customer_number ?? "", namn: k.customer_name ?? "", lank: inkioLank("kund", k.customer_id) },
    rader: lista,
    avkortad: (rader ?? []).length >= 400,
  };
}

/** Kundens anteckningar skrivna i Nav. `*`: kolumnerna från 0278 och 0283 finns först när migrationerna körts. */
async function navAnteckningar(org: string): Promise<Navanteckning[]> {
  const { data } = await supabaseAdmin().from("kundanteckning").select("*").eq("org_number", org).order("skriven_at", { ascending: false }).limit(200);
  return (data ?? []) as Navanteckning[];
}

/**
 * Inkio direkt, tolkat på samma sätt som kopian, så att kortet ser likadant ut
 * före och efter. Navs egna anteckningar står med, och deras eko i Inkio visas
 * inte två gånger.
 */
export async function kundaktivitetUrInkio(org: string, superadmin: boolean): Promise<Kundaktivitet> {
  const personer = new Personer();
  const [kund, nav, nivaAv, namnAv] = await Promise.all([inkioKund(org), navAnteckningar(org), personer.nivaAv(), personer.namnAv()]);
  if (!kund) return { kund: null };
  const historik = await kundhistorik(kund.id);
  const rader = historik.items.map((p) => tolkaPost(p, historik.roller)).filter((r): r is Rad => r !== null);
  return {
    kund: { id: kund.id, nummer: kund.number, namn: kund.customer_name, lank: inkioLank("kund", kund.id) },
    rader: aktivitetsrader(rader, nav, { superadmin, inkioBas: inkioUrl(), nivaAv, namnAv }),
    avkortad: false,
  };
}

/**
 * Navs kopia när bevakningen går och har läst kunden, annars Inkio direkt.
 * Står bevakningen av (som fram till provet i produktionen) är kopian lika
 * gammal som den senaste läsningen, och då ska kortet inte visa den.
 */
export async function kundaktivitetForKortet(org: string, superadmin: boolean): Promise<Kundaktivitet> {
  const { data: inst } = await supabaseAdmin().from("crm_installning").select("aktiv, inflode").eq("id", true).maybeSingle();
  const kopian = inst?.aktiv && inst.inflode ? await kundaktivitetUrNav(org, superadmin) : null;
  return kopian ?? kundaktivitetUrInkio(org, superadmin);
}

// -----------------------------------------------------------------------------
// Larmet
// -----------------------------------------------------------------------------

const STILLA_MS = 15 * 60 * 1000;
const LARMA_IGEN_MS = 6 * 60 * 60 * 1000;

/**
 * Tystnad bevisar inte att något fungerar. Står bevakningen still i en
 * kvart får superadmin ett larm, högst var sjätte timme. Körs av utkorgens
 * minutjobb — ett ANNAT jobb än det som kan ha stannat.
 */
export async function larmaOmBevakningenStar(): Promise<string> {
  try {
    if (process.env.VERCEL_ENV !== "production" || !inkioKonfigurerad()) return "inte här";
    const db = supabaseAdmin();
    const { data: inst } = await db.from("crm_installning").select("aktiv, inflode, larm_at").eq("id", true).maybeSingle();
    if (!inst?.aktiv || !inst.inflode) return "avstängd";
    const { data: senast } = await db.from("crm_kund").select("senast_ok").not("senast_ok", "is", null).order("senast_ok", { ascending: false }).limit(1).maybeSingle();
    if (!senast) return "ingen läst än";
    const stilla = Date.now() - Date.parse(String(senast.senast_ok));
    if (stilla < STILLA_MS) return "går";
    if (inst.larm_at && Date.now() - Date.parse(String(inst.larm_at)) < LARMA_IGEN_MS) return "larmat";
    await db.from("crm_installning").update({ larm_at: new Date().toISOString() }).eq("id", true);
    const krets = await new Personer().kretsFor([]);
    await notifieraFlera(krets, {
      av: null,
      kalla: "inkio-bevakning",
      typ: "fel",
      rubrik: "Inkio-bevakningen står still",
      detalj: `Ingen kund har lästs från Inkio på ${Math.round(stilla / 60000)} minuter. Det som skrivs i Inkio når inte Nav förrän den går igen.`,
      href: "/fel",
    });
    return "larmade";
  } catch (e) {
    return `fel: ${e instanceof Error ? e.message : String(e)}`;
  }
}
