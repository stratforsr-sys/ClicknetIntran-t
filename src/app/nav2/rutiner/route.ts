import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { fullName, getCurrentUser, hasRole } from "@/lib/auth";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { dagarBakat, svensktDatum } from "@/lib/klocka";
import { notifiera, notifieraFlera } from "@/lib/notishandelse-server";
import { DOC_TYPES, type DocType } from "@/lib/dokument";
import { arkivera, forberedBilaga, kvittera, markeraGranskad, registreraBilaga, skapaDokument, sparaDokument, taBortBilaga } from "@/app/(app)/rutiner/actions";
import { skapaUppgift } from "@/app/(app)/uppgifter/actions";
import { franMarkdown, tillMarkdown, type Rutinfalt } from "@/lib/nav2/rutinformat";
import { LASLAGE_TEXT, SKRIVLAGE, sammaUrsprung } from "@/lib/nav2/skrivlage";

export const dynamic = "force-dynamic";

/**
 * Nav 2.0: allt som ändrar Rutiner, i en rutt.
 *
 * ===========================================================================
 * REPOTS ACTIONS. Skapa och spara (`skapaDokument`, `sparaDokument`: en ändrad
 * rubrik eller text blir en ny version, AC-5.4), kvittera (`kvittera`),
 * granska (`markeraGranskad`, sex månader som i utkastet) och arkivera
 * (`arkivera`). Uppgifter ur en rutin läggs med `skapaUppgift`.
 *
 * Innehållet skrivs i `body_md` med formen i `rutinformat.ts`. En text som
 * saknar formen (skriven i repots redaktör) skrivs inte om förrän stegen
 * fylls i, och då står den gamla texten kvar under de nya fälten.
 *
 * Det nya (0095): visad, sparad, anteckning, loggat som gjort, "Hjälpte
 * rutinen dig?" och ägarens svar, bevakning av ett område, veckans rutin,
 * skicka till en kollega, påminnelse om kvittens, återställ ur arkivet och
 * släng ett utkast.
 *
 * Gamla Nav E (2026-10-21): bilagor (`forberedBilaga`, `registreraBilaga`,
 * `taBortBilaga`). Filen går direkt till lagringen (R2 eller Supabase) med
 * den signerade adressen; CSP:ns connect-src släpper in R2 (`csp.ts`).
 * ===========================================================================
 *
 * LÄSLÄGE: står `SKRIVLAGE.rutiner` på false svarar rutten 423 innan något skrivs.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OMR: Record<string, string> = { salj: "Försäljning", kund: "Kund och leverans", pers: "Personal och samarbete", miljo: "Arbetsmiljö", adm: "Administration och system" };
const SKAL = ["Otydligt", "Inaktuellt", "Saknar ett steg", "Stämmer inte"];

type Svar = { ok?: string; fel?: string; [k: string]: unknown };
const svar = (data: Svar, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });

function form(falt: Record<string, unknown>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(falt)) {
    if (Array.isArray(v)) v.forEach((x) => f.append(k, String(x)));
    else if (v !== undefined && v !== null) f.set(k, String(v));
  }
  return f;
}

/** Repots skapa och spara avslutar med redirect(), som kastar. Den är ett ja. */
async function medOmdirigering(f: () => Promise<{ fel?: string }>): Promise<{ fel?: string; till?: string }> {
  try {
    const s = await f();
    return s?.fel ? { fel: s.fel } : {};
  } catch (e) {
    const d = (e as { digest?: string })?.digest;
    if (typeof d === "string" && d.startsWith("NEXT_REDIRECT")) return { till: d.split(";")[2] };
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}
async function fangad(f: () => Promise<unknown>): Promise<string | null> {
  try {
    await f();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Något gick fel.";
  }
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user?.employee) return svar({ fel: "Du måste vara inloggad." }, 401);
  if (!sammaUrsprung(request)) return svar({ fel: "Fel ursprung." }, 403);
  const mig = user.employee.id;
  const jagNamn = fullName(user.employee);

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return svar({ fel: "Ogiltig begäran." }, 400);
  }
  const handling = String(b.handling ?? "");
  const slug = String(b.id ?? "");

  if (!SKRIVLAGE.rutiner) return svar({ fel: LASLAGE_TEXT, laslage: true }, 423);
  const db = supabaseAdmin();
  const redaktor = hasRole(user, "sales_manager", "admin");

  // Dokumentet som den inloggade ser det (RLS), ur sin slug.
  const dokument = async () => {
    if (!slug) return null;
    const { data } = await (await supabaseServer())
      .from("document")
      .select("id, slug, title, body_md, version, status, owner_id, requires_ack, routine_meta, category_path, review_due, doc_type, audience_roles, decided_on")
      .eq("slug", slug)
      .maybeSingle();
    return data;
  };
  const farRedigera = (d: { owner_id: string }) => redaktor || d.owner_id === mig;

  try {
    switch (handling) {
      case "visa": {
        const d = await dokument();
        if (!d) return svar({ ok: "" });
        const { data: finns } = await db.from("document_view").select("views").eq("document_id", d.id).eq("employee_id", mig).maybeSingle();
        if (finns) await db.from("document_view").update({ views: (finns.views as number) + 1, last_seen: new Date().toISOString() }).eq("document_id", d.id).eq("employee_id", mig);
        else await db.from("document_view").insert({ document_id: d.id, employee_id: mig });
        await db.from("document_view_log").insert({ document_id: d.id, employee_id: mig });
        return svar({ ok: "" });
      }

      case "sok": {
        // Dina senaste sökningar, och en sökning utan träff utan ditt namn (0096).
        const q = String(b.q ?? "").trim().slice(0, 200);
        if (q.length < 2) return svar({ ok: "" });
        const { data: pref } = await db.from("nav_preference").select("value").eq("employee_id", mig).eq("key", "rutiner.sok").maybeSingle();
        const fore = Array.isArray(pref?.value) ? (pref.value as string[]) : [];
        await db.from("nav_preference").upsert({ employee_id: mig, key: "rutiner.sok", value: [q, ...fore.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 5), updated_at: new Date().toISOString() }, { onConflict: "employee_id,key" });
        if (b.traffar === 0) await db.from("document_search_miss").insert({ query: q });
        return svar({ ok: "" });
      }

      case "kvittera": {
        const d = await dokument();
        if (!d) return svar({ fel: "Rutinen finns inte." }, 404);
        await kvittera(form({ document_id: d.id, slug: d.slug }));
        const { data: kv } = await db.from("document_ack").select("acked_at").eq("document_id", d.id).eq("employee_id", mig).eq("version", d.version).maybeSingle();
        return kv ? svar({ ok: `Kvitterad, version ${d.version}. Kommer en ny version kvitterar du igen.` }) : svar({ fel: "Rutinen kräver ingen kvittens, eller är inte publicerad." }, 400);
      }

      case "spara-stjarna": {
        const d = await dokument();
        if (!d) return svar({ fel: "Rutinen finns inte." }, 404);
        if (b.pa === true) await db.from("document_saved").upsert({ employee_id: mig, document_id: d.id });
        else await db.from("document_saved").delete().eq("employee_id", mig).eq("document_id", d.id);
        return svar({ ok: b.pa === true ? "Sparad. Den står nu också som snabbval under sökfältet." : "Borttagen från Sparade." });
      }

      case "anteckning": {
        const d = await dokument();
        if (!d) return svar({ fel: "Rutinen finns inte." }, 404);
        const text = String(b.text ?? "").slice(0, 2000);
        if (text.trim()) await db.from("document_note").upsert({ employee_id: mig, document_id: d.id, text, updated_at: new Date().toISOString() });
        else await db.from("document_note").delete().eq("employee_id", mig).eq("document_id", d.id);
        return svar({ ok: "" });
      }

      case "logga": {
        const d = await dokument();
        if (!d) return svar({ fel: "Rutinen finns inte." }, 404);
        await db.from("document_run").insert({ document_id: d.id, version: d.version, employee_id: mig, customer: String(b.kund ?? "").trim().slice(0, 200) || null });
        return svar({ ok: "Loggat som gjort i dag. Det syns i rutinens historik." });
      }

      case "hjalpte": {
        const d = await dokument();
        if (!d) return svar({ fel: "Rutinen finns inte." }, 404);
        const ja = b.ja === true;
        const skal = SKAL.includes(String(b.skal ?? "")) ? String(b.skal) : null;
        const text = String(b.text ?? "").trim().slice(0, 1000) || null;
        await db.from("document_feedback").insert({ document_id: d.id, version: d.version, employee_id: mig, helped: ja, reason: ja ? null : skal, text: ja ? null : text });
        if (!ja)
          await notifiera({ till: d.owner_id as string, av: mig, kalla: "rutin-aterkoppling", typ: "rutin", rubrik: `${jagNamn}: ”${d.title}” hjälpte inte`, detalj: [skal, text].filter(Boolean).join(": "), href: `/rutiner/${d.slug}` });
        return svar({ ok: ja ? "Tack. Ägaren ser att rutinen hjälper." : "Tack. Ägaren får det, och svarar i Nav." });
      }

      case "svara": {
        const id = String(b.fb ?? "");
        const text = String(b.text ?? "").trim().slice(0, 1000);
        if (!UUID.test(id) || !text) return svar({ fel: "Skriv ett svar först." }, 400);
        const { data: fb } = await db.from("document_feedback").select("id, employee_id, document_id, answer").eq("id", id).maybeSingle();
        if (!fb) return svar({ fel: "Frågan finns inte." }, 404);
        const { data: d } = await db.from("document").select("owner_id, slug, title").eq("id", fb.document_id).maybeSingle();
        if (!d || !(redaktor || d.owner_id === mig)) return svar({ fel: "Bara ägaren svarar." }, 403);
        await db.from("document_feedback").update({ answer: text, answered_by: mig, answered_at: new Date().toISOString() }).eq("id", id);
        await notifiera({ till: fb.employee_id as string, av: mig, kalla: "rutin-svar", typ: "rutin", rubrik: `${jagNamn} svarade om ”${d.title}”`, detalj: text, href: `/rutiner/${d.slug}` });
        return svar({ ok: "Svaret är skickat." });
      }

      case "bevaka": {
        const omr = String(b.omr ?? "");
        if (!OMR[omr]) return svar({ fel: "Okänt område." }, 400);
        if (b.pa === true) await db.from("document_area_watch").upsert({ employee_id: mig, area: omr });
        else await db.from("document_area_watch").delete().eq("employee_id", mig).eq("area", omr);
        return svar({ ok: b.pa === true ? `Du får en notis när något ändras i ${OMR[omr].toLowerCase()}.` : "Bevakningen är borttagen." });
      }

      case "veckans": {
        if (!redaktor) return svar({ fel: "Bara säljchef och administratör väljer veckans rutin." }, 403);
        const d = await dokument();
        if (!d || d.status !== "published") return svar({ fel: "Rutinen finns inte." }, 404);
        await db.from("nav_setting").upsert({ key: "rutiner.veckans", value: d.slug, updated_by: mig, updated_at: new Date().toISOString() });
        return svar({ ok: `Veckans rutin är nu ”${d.title}”. Säljarna ser den överst.` });
      }

      case "skicka": {
        const d = await dokument();
        const till = String(b.till ?? "");
        if (!d || !UUID.test(till)) return svar({ fel: "Rutinen eller mottagaren finns inte." }, 404);
        const { data: p } = await db.from("employee").select("first_name").eq("id", till).maybeSingle();
        if (!p) return svar({ fel: "Mottagaren finns inte." }, 404);
        await notifiera({ till, av: mig, kalla: "rutin-delad", typ: "rutin", rubrik: `${jagNamn} skickade en rutin till dig`, detalj: d.title as string, href: `/rutiner/${d.slug}` });
        return svar({ ok: `${p.first_name} fick rutinen i Nav.` });
      }

      case "uppgifter": {
        const d = await dokument();
        if (!d) return svar({ fel: "Rutinen finns inte." }, 404);
        const rader = (Array.isArray(b.rader) ? (b.rader as [string, number][]) : []).slice(0, 20);
        if (!rader.length) return svar({ fel: "Välj minst en uppgift." }, 400);
        const kund = String(b.kund ?? "").trim().slice(0, 120);
        const idag = svensktDatum();
        for (const [titel, dag] of rader) {
          const s = await skapaUppgift({}, form({ title: `${String(titel).slice(0, 180)}${kund ? ` · ${kund}` : ""}`, due_date: dagarBakat(idag, -Math.max(0, Number(dag) || 0)), priority: 3, description_md: `Ur rutinen [${d.title}](/rutiner/${d.slug}).` }));
          if (s.fel) return svar({ fel: s.fel }, 400);
        }
        return svar({ ok: rader.length === 1 ? "Uppgiften är skapad." : `${rader.length} uppgifter skapade${kund ? ` för ${kund}` : ""}.` });
      }

      case "granska": {
        const d = await dokument();
        if (!d) return svar({ fel: "Rutinen finns inte." }, 404);
        const fel = await fangad(() => markeraGranskad(form({ document_id: d.id, slug: d.slug, manader: 6 })));
        return fel ? svar({ fel }, 403) : svar({ ok: "Markerad som granskad. Nästa granskning om sex månader." });
      }

      case "paminn":
      case "paminn-alla": {
        if (!redaktor) return svar({ fel: "Bara säljchef och administratör påminner om kvittenser." }, 403);
        const { data: doks } = handling === "paminn"
          ? await db.from("document").select("id, slug, title, version, audience_roles, audience_teams, audience_employees").eq("slug", slug).eq("status", "published").eq("requires_ack", true)
          : await db.from("document").select("id, slug, title, version, audience_roles, audience_teams, audience_employees").eq("status", "published").eq("requires_ack", true);
        const [{ data: pers }, { data: roller }, { data: kvitton }] = await Promise.all([
          db.from("employee").select("id, team_id").neq("status", "offboarded"),
          db.from("employee_role").select("employee_id, role"),
          db.from("document_ack").select("document_id, version, employee_id"),
        ]);
        const rp = new Map<string, string[]>();
        for (const r of roller ?? []) rp.set(r.employee_id as string, [...(rp.get(r.employee_id as string) ?? []), r.role as string]);
        let n = 0;
        for (const d of doks ?? []) {
          const harKvitterat = new Set((kvitton ?? []).filter((k) => k.document_id === d.id && k.version === d.version).map((k) => k.employee_id as string));
          const ar = (d.audience_roles ?? []) as string[], at = (d.audience_teams ?? []) as string[], ae = (d.audience_employees ?? []) as string[];
          const till = (pers ?? [])
            .filter((p) => (ae.length && ae.includes(p.id as string)) || (!(ae.length && !ar.length && !at.length) && (!ar.length || (rp.get(p.id as string) ?? []).some((x) => ar.includes(x))) && (!at.length || at.includes(p.team_id as string))))
            .map((p) => p.id as string)
            .filter((id) => !harKvitterat.has(id) && id !== mig);
          n += await notifieraFlera(till, { av: mig, kalla: "rutin-kvittera", typ: "rutin", rubrik: `Kvittera ”${d.title}”`, detalj: `Version ${d.version}`, href: `/rutiner/${d.slug}` });
        }
        return svar({ ok: n ? `${n} ${n === 1 ? "person fick" : "personer fick"} en påminnelse om att kvittera.` : "Alla har kvitterat." });
      }

      case "arkivera": {
        const d = await dokument();
        if (!d) return svar({ fel: "Rutinen finns inte." }, 404);
        const fel = await fangad(() => arkivera(form({ document_id: d.id })));
        return fel ? svar({ fel }, 403) : svar({ ok: "Arkiverad. Den finns kvar under Arkiv." });
      }

      case "aterstall": {
        const d = await dokument();
        if (!d || d.status !== "archived") return svar({ fel: "Rutinen finns inte i arkivet." }, 404);
        if (!farRedigera(d)) return svar({ fel: "Du saknar behörighet att redigera dokument." }, 403);
        await db.from("document").update({ status: "published", updated_at: new Date().toISOString() }).eq("id", d.id);
        await db.from("audit_log").insert({ actor_id: mig, action: "document.restored", object_type: "document", object_id: d.id });
        revalidatePath("/rutiner");
        return svar({ ok: `”${d.title}” är tillbaka.` });
      }

      case "utkast-bort": {
        const d = await dokument();
        if (!d || d.status !== "draft") return svar({ fel: "Utkastet finns inte." }, 404);
        if (!farRedigera(d)) return svar({ fel: "Du saknar behörighet att redigera dokument." }, 403);
        await db.from("document").delete().eq("id", d.id).eq("status", "draft");
        await db.from("audit_log").insert({ actor_id: mig, action: "document.draft_deleted", object_type: "document", object_id: d.id, meta: { titel: d.title } });
        return svar({ ok: "Utkastet är slängt." });
      }

      case "bilaga-forbered": {
        // Gamla Nav E: repots forberedBilaga prövar redaktören (säljchef, admin, ägaren) och ger en signerad adress.
        const d = await dokument();
        if (!d) return svar({ fel: "Rutinen finns inte." }, 404);
        const s = await forberedBilaga(d.id, String(b.filnamn ?? "bilaga").slice(0, 200), String(b.mime ?? ""), Number(b.storlek ?? 0));
        return "fel" in s && s.fel ? svar({ fel: s.fel }, 400) : svar({ ok: "Klar att ladda upp.", ...s, supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? null });
      }
      case "bilaga-registrera": {
        // Filen ligger uppe: repots registreraBilaga knyter den till rutinen och gör en PDF sökbar.
        const d = await dokument();
        if (!d) return svar({ fel: "Rutinen finns inte." }, 404);
        if (!UUID.test(String(b.fil ?? ""))) return svar({ fel: "Okänd fil." }, 400);
        const s = await registreraBilaga(d.id, String(b.fil), String(b.filnamn ?? "bilaga").slice(0, 200), String(b.store ?? ""));
        return s.fel ? svar({ fel: s.fel }, 400) : svar({ ok: "Bilagan är tillagd." });
      }
      case "bilaga-bort": {
        // Bara en bilaga på just den rutinen: repots taBortBilaga prövar dokumentet, inte filen.
        const d = await dokument();
        if (!d) return svar({ fel: "Rutinen finns inte." }, 404);
        const fil = String(b.fil ?? "");
        const { data: rad } = UUID.test(fil) ? await db.from("file_object").select("id").eq("id", fil).eq("document_id", d.id).eq("purpose", "document_attachment").is("removed_at", null).maybeSingle() : { data: null };
        if (!rad) return svar({ fel: "Bilagan finns inte." }, 404);
        const s = await taBortBilaga({}, form({ id: d.id, fil_id: fil }));
        return s.fel ? svar({ fel: s.fel }, 400) : svar({ ok: "Bilagan är borttagen." });
      }

      case "spara": {
        // Redaktören: utkastets fält, repots skapa eller spara.
        const f = (b.f ?? {}) as Partial<Rutinfalt> & { t?: string; omr?: string; kat?: string; typ?: string; agare?: string; nasta?: string; kvitt?: boolean; not?: string; resa?: number | null; syn?: string[]; rel?: string[]; uppg?: [string, number][]; ny?: boolean };
        const publicera = b.hur === "publicera";
        const typ = String(f.typ ?? "routine");
        if (!DOC_TYPES.includes(typ as DocType)) return svar({ fel: "Okänd dokumenttyp." }, 400);
        if (!String(f.t ?? "").trim()) return svar({ fel: "Rutinen behöver en rubrik." }, 400);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(f.nasta ?? ""))) return svar({ fel: "Ange när rutinen senast ska granskas." }, 400);
        const agare = UUID.test(String(f.agare ?? "")) ? String(f.agare) : mig;
        const falt: Rutinfalt = {
          tldr: String(f.tldr ?? ""),
          nar: String(f.nar ?? ""),
          tid: String(f.tid ?? ""),
          vem: String(f.vem ?? ""),
          steg: (Array.isArray(f.steg) ? f.steg : []).map((s) => [String(s[0] ?? ""), String(s[1] ?? "")] as [string, string]),
          klart: (Array.isArray(f.klart) ? f.klart : []).map(String),
          fel: (Array.isArray(f.fel) ? f.fel : []).map((s) => [String(s[0] ?? ""), String(s[1] ?? "")] as [string, string]),
        };
        const omr = OMR[String(f.omr ?? "")] ? String(f.omr) : "adm";
        const meta = { omr, kat: String(f.kat ?? "").trim() || undefined, resa: f.resa ?? undefined, syn: f.syn, rel: f.rel, uppg: f.uppg, ny: f.ny === true || undefined };
        const fore = slug ? await dokument() : null;
        if (slug && !fore) return svar({ fel: "Rutinen finns inte." }, 404);
        let brodtext = tillMarkdown(falt);
        let kategori = `${OMR[omr]}/${String(f.kat ?? "").trim() || "Övrigt"}`;
        if (fore) {
          if (!farRedigera(fore)) return svar({ fel: "Du saknar behörighet att redigera dokument." }, 403);
          kategori = fore.category_path as string;
          const gammal = franMarkdown(fore.body_md as string);
          const struktur = falt.steg.length || falt.klart.length || falt.fel.length || falt.nar || falt.tid || falt.vem;
          if (!gammal.form) brodtext = struktur ? `${brodtext}\n${fore.body_md}` : (fore.body_md as string);
        }
        const falten = {
          titel: String(f.t).trim(),
          kategori,
          brodtext,
          doc_type: typ,
          review_due: f.nasta,
          decided_on: fore?.decided_on ?? "",
          kraver_kvittens: f.kvitt ? "on" : "",
          malgrupp: fore ? ((fore.audience_roles ?? []) as string[]) : [],
          owner_id: agare,
          publicera: publicera ? "1" : "",
        };
        const s = fore
          ? await medOmdirigering(() => sparaDokument({}, form({ ...falten, id: fore.id, slug: fore.slug, andringsnot: String(f.not ?? "").trim() })))
          : await medOmdirigering(() => skapaDokument({}, form(falten)));
        if (s.fel) return svar({ fel: s.fel }, 400);
        const nySlug = fore ? (fore.slug as string) : (s.till ?? "").replace(/^\/rutiner\//, "");
        const { data: efter } = await db.from("document").select("id, slug, title, version, status").eq("slug", nySlug).maybeSingle();
        if (efter) {
          await db.from("document").update({ routine_meta: meta }).eq("id", efter.id);
          // Bevakningen: den som bevakar området får veta när en rutin publiceras eller får en ny version.
          if (efter.status === "published" && (!fore || fore.status !== "published" || efter.version !== fore.version)) {
            const { data: vakter } = await db.from("document_area_watch").select("employee_id").eq("area", omr);
            await notifieraFlera((vakter ?? []).map((v) => v.employee_id as string), { av: mig, kalla: "rutin-bevakning", typ: "rutin", rubrik: `${fore ? "Ny version" : "Ny rutin"} i ${OMR[omr].toLowerCase()}`, detalj: efter.title as string, href: `/rutiner/${efter.slug}` });
          }
        }
        return svar({ ok: publicera ? (fore ? "Sparad och publicerad." : "Publicerad.") : "Sparat som utkast.", id: nySlug });
      }

      default:
        return svar({ fel: "Okänd handling." }, 400);
    }
  } catch (e) {
    return svar({ fel: e instanceof Error ? e.message : "Något gick fel." }, 500);
  }
}
