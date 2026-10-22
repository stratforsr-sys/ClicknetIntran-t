import { NextResponse } from "next/server";
import { getCurrentUser, type CurrentUser } from "@/lib/auth";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { svensktDatum, svenskTidpunkt } from "@/lib/klocka";
import { arArbetsdag, dagPlus, veckodag } from "@/lib/saljtakt";
import { notisId } from "@/lib/notiser";
import { avfardaNotis } from "@/lib/notiser-server";
import { notifieraFlera } from "@/lib/notishandelse-server";
import { hamtaNavnyhet, navnyheterFor } from "@/navnyheter";
import { arkiveraNyhet, publiceraNyhet, skapaNyhet } from "@/app/(app)/nyheter/actions";
import { LASLAGE_TEXT, SKRIVLAGE, sammaUrsprung } from "@/lib/nav2/skrivlage";
import { medNyckel } from "@/lib/nav2/nyckel";
import { NH_GRUPPER, byggNyheter, farSkrivaNyheter, iMalgrupp, saknas0130, type NhGrupp } from "@/lib/nav2/nyheter";

export const dynamic = "force-dynamic";

/**
 * Nav 2.0: allt som ändrar Nyheter, i en rutt.
 *
 * ===========================================================================
 * REPOTS ACTIONS. Ett nytt inlägg skrivs av `skapaNyhet` (behörigheten, slugen
 * ur rubriken, målgruppen, audit_log), ett utkast publiceras av
 * `publiceraNyhet` och ett inlägg arkiveras av `arkiveraNyhet`. Utkastets
 * grupper (Alla, Säljare, Ledningen, Leveransen) blir roller (`NH_GRUPPER`).
 *
 * DET NYA (0130): kvittens med sista dag, schemaläggning ("I morgon 07:30",
 * "måndag 07:30"), läskvittot, påminnelsen till den som inte läst, fäst och
 * lossa efter publiceringen, och Ångra (kvittensen, fäst, arkivet, Nytt i
 * navet, och publiceringen i tio minuter). Läst är klockans avfärdning
 * (`nyhet-<id>`), som "Jag har läst det här" på Nytt i navet
 * (`markeraNavnyhetLast`).
 *
 * Svaret bär Nyheters data efter ändringen (`nyheter`), så att utkastet ritar
 * om utan att ladda om sidan och Ångra står kvar.
 * ===========================================================================
 *
 * LÄSLÄGE: står `SKRIVLAGE.nyheter` på false svarar rutten 423 innan något skrivs.
 */

type Svar = { ok?: string; fel?: string; [k: string]: unknown };
const svar = (data: Svar, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });
const PNR = /\d{6}[-+]?\d{4}/;
const ANGRA_MIN = 10;

function form(falt: Record<string, unknown>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(falt)) {
    if (Array.isArray(v)) v.forEach((x) => f.append(k, String(x)));
    else if (v !== undefined && v !== null) f.set(k, String(v));
  }
  return f;
}
/** Repots skapaNyhet avslutar med redirect(), som kastar. Den är ett ja, och adressen bär slugen. */
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
    const d = (e as { digest?: string })?.digest;
    if (typeof d === "string" && d.startsWith("NEXT_REDIRECT")) return null;
    return e instanceof Error ? e.message : "Något gick fel.";
  }
}

/** När ett schemalagt inlägg går ut, som utkastet: nästa arbetsdag eller måndagen efter i morgon, 07:30. */
function schemaTid(nar: string, idag: string): string | null {
  if (nar === "morgon") {
    let d = dagPlus(idag, 1);
    for (let i = 0; i < 14 && !arArbetsdag(d); i++) d = dagPlus(d, 1);
    return svenskTidpunkt(d, "07:30").toISOString();
  }
  if (nar === "mandag") {
    let d = dagPlus(idag, 1);
    while (veckodag(d) !== 1) d = dagPlus(d, 1);
    return svenskTidpunkt(d, "07:30").toISOString();
  }
  return null;
}

type Post = { id: string; slug: string; title: string; status: string; pinned: boolean; author_id: string; published_at: string | null; audience_roles: string[] | null; audience_teams: string[] | null; ack_due?: string | null; scheduled_at?: string | null };

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
  // Publicera skapar ett inlägg och en notisrunda. Samma nyckel en gång till ger samma svar, inte ett inlägg till (granskningen G2, F2-3).
  if (b.handling === "publicera") return medNyckel(request, mig, () => utfor(user, mig, b));
  return utfor(user, mig, b);
}

async function utfor(user: CurrentUser, mig: string, b: Record<string, unknown>): Promise<Response> {
  const handling = String(b.handling ?? "");
  const slug = String(b.id ?? "");

  if (!SKRIVLAGE.nyheter) return svar({ fel: LASLAGE_TEXT, laslage: true }, 423);
  const db = supabaseAdmin();
  const far = farSkrivaNyheter(user);
  const idag = svensktDatum();

  // Inlägget som den inloggade ser det (RLS), ur sin slug.
  const inlagg = async (): Promise<Post | null> => {
    if (!slug) return null;
    const sb = await supabaseServer();
    const med = await sb.from("news_post").select("id, slug, title, status, pinned, author_id, published_at, audience_roles, audience_teams, ack_due, scheduled_at").eq("slug", slug).maybeSingle();
    if (!saknas0130(med.error)) return (med.data as Post | null) ?? null;
    const utan = await sb.from("news_post").select("id, slug, title, status, pinned, author_id, published_at, audience_roles, audience_teams").eq("slug", slug).maybeSingle();
    return (utan.data as Post | null) ?? null;
  };
  const farAndra = (p: Post) => far || p.author_id === mig;
  const klart = async (ok: string, extra: Record<string, unknown> = {}) => svar({ ok, ...extra, nyheter: await byggNyheter(await supabaseServer(), user) });
  const logga = (action: string, objekt: string, meta?: Record<string, unknown>) =>
    db.from("audit_log").insert({ actor_id: mig, action, object_type: "news_post", object_id: objekt, meta: meta ?? null });

  try {
    switch (handling) {
      // Öppnat: läst, samma rad som klockans avfärdning.
      case "last": {
        const p = await inlagg();
        if (!p || p.status !== "published") return svar({ ok: "" });
        await avfardaNotis(mig, notisId("nyhet", p.id));
        return svar({ ok: "" });
      }

      case "kvittera": {
        const p = await inlagg();
        if (!p || p.status !== "published") return svar({ fel: "Inlägget finns inte." }, 404);
        if (!p.ack_due) return svar({ fel: "Inlägget kräver ingen kvittens." }, 400);
        if (p.author_id === mig) return svar({ fel: "Du skrev inlägget själv." }, 400);
        const { error } = await db.from("news_ack").upsert({ post_id: p.id, employee_id: mig }, { onConflict: "post_id,employee_id" });
        if (error) return svar({ fel: `Kvittensen kunde inte sparas: ${error.message}` }, 500);
        await avfardaNotis(mig, notisId("nyhet", p.id));
        return klart("Kvitterat.");
      }

      case "kvittera-ater": {
        const p = await inlagg();
        if (!p) return svar({ fel: "Inlägget finns inte." }, 404);
        await db.from("news_ack").delete().eq("post_id", p.id).eq("employee_id", mig);
        return klart("Kvittensen är borttagen.");
      }

      // Nytt i navet: "Jag har läst det här" och "Läst alla", som repots markeraNavnyhetLast.
      case "nav-last":
      case "nav-ater": {
        const mina = new Set(navnyheterFor({ roller: user.roles, behorigheter: user.permissions }).map((n) => n.slug));
        const slugs = (Array.isArray(b.slugs) ? b.slugs : []).map(String).filter((s) => hamtaNavnyhet(s) && mina.has(s)).slice(0, 200);
        if (!slugs.length) return svar({ fel: "Posten finns inte." }, 404);
        if (handling === "nav-last") for (const s of slugs) await avfardaNotis(mig, notisId("navnyhet", s));
        else await db.from("notification_dismissed").delete().eq("employee_id", mig).in("notice_id", slugs.map((s) => notisId("navnyhet", s)));
        return klart(handling === "nav-last" ? "Markerat som läst." : "Olästa igen.");
      }

      case "fast": {
        const p = await inlagg();
        if (!p || p.status === "archived") return svar({ fel: "Inlägget finns inte." }, 404);
        if (!farAndra(p)) return svar({ fel: "Bara den som skrev inlägget, säljchefen, VD och administratören fäster inlägg." }, 403);
        const pa = b.pa === true;
        await db.from("news_post").update({ pinned: pa, updated_at: new Date().toISOString() }).eq("id", p.id);
        await logga(pa ? "news.pinned" : "news.unpinned", p.slug);
        return klart(pa ? "Inlägget står överst för alla." : "Inlägget är inte längre fäst.");
      }

      case "arkivera": {
        const p = await inlagg();
        if (!p || p.status === "archived") return svar({ fel: "Inlägget finns inte." }, 404);
        if (!far) return svar({ fel: "Du saknar behörighet." }, 403);
        const fel = await fangad(() => arkiveraNyhet(form({ nyhet_id: p.id })));
        return fel ? svar({ fel }, 403) : klart("Inlägget är arkiverat och syns inte längre.");
      }

      case "arkivera-ater": {
        const p = await inlagg();
        if (!p || p.status !== "archived" || !p.published_at) return svar({ fel: "Inlägget finns inte i arkivet." }, 404);
        if (!farAndra(p)) return svar({ fel: "Du saknar behörighet." }, 403);
        // Repots arkivering lossar inlägget; Ångra fäster det igen om det var fäst.
        await db.from("news_post").update({ status: "published", pinned: b.fast === true, updated_at: new Date().toISOString() }).eq("id", p.id);
        await logga("news.restored", p.slug);
        return klart("Inlägget är tillbaka.");
      }

      // Påminn den som inte läst (eller inte kvitterat), en gång om dagen per inlägg.
      case "paminn": {
        const p = await inlagg();
        if (!p || p.status !== "published") return svar({ fel: "Inlägget finns inte." }, 404);
        if (p.author_id !== mig) return svar({ fel: "Bara den som skrev inlägget påminner." }, 403);
        const { data: forr } = await db.from("audit_log").select("id").eq("action", "news.reminded").eq("object_id", p.slug).gte("ts", svenskTidpunkt(idag, "00:00").toISOString()).limit(1);
        if ((forr ?? []).length) return svar({ fel: "Du har redan påmint i dag." }, 400);
        const [{ data: pers }, { data: roller }, { data: lasta }, { data: kvitt }] = await Promise.all([
          db.from("employee").select("id, team_id").neq("status", "offboarded"),
          db.from("employee_role").select("employee_id, role"),
          db.from("notification_dismissed").select("employee_id").eq("notice_id", notisId("nyhet", p.id)),
          p.ack_due ? db.from("news_ack").select("employee_id").eq("post_id", p.id) : Promise.resolve({ data: [] as { employee_id: string }[] }),
        ]);
        const rp = new Map<string, string[]>();
        for (const r of (roller ?? []) as { employee_id: string; role: string }[]) rp.set(r.employee_id, [...(rp.get(r.employee_id) ?? []), r.role]);
        const klara = new Set(((p.ack_due ? kvitt : lasta) ?? []).map((x) => x.employee_id as string));
        const till = ((pers ?? []) as { id: string; team_id: string | null }[])
          .filter((x) => x.id !== mig && iMalgrupp(p.audience_roles, p.audience_teams, { roller: rp.get(x.id) ?? [], team_id: x.team_id }) && !klara.has(x.id))
          .map((x) => x.id);
        if (!till.length) return svar({ fel: p.ack_due ? "Alla har kvitterat." : "Alla har läst." }, 400);
        const n = await notifieraFlera(till, {
          av: mig,
          kalla: "nyhet-paminn",
          typ: "nyhet",
          rubrik: `${p.ack_due ? "Kvittera" : "Läs"} ”${p.title}”`.slice(0, 200),
          detalj: p.ack_due ? `Senast ${p.ack_due}.` : "Påminnelse om ett inlägg i Nyheter.",
          href: `/nyheter/${p.slug}`,
        });
        await logga("news.reminded", p.slug, { antal: n });
        return klart(`${n === 1 ? "En" : n} fick en påminnelse i klockan.`, { antal: n });
      }

      // Skrivrutan: publicera nu, schemalägg, eller spara som utkast.
      case "publicera":
      case "utkast": {
        if (!far) return svar({ fel: "Bara säljchefen, VD och administratören skriver inlägg." }, 403);
        const rubrik = String(b.rubrik ?? "").trim();
        const text = String(b.text ?? "").trim();
        const grupp = String(b.grupp ?? "salj") as NhGrupp;
        const kv = b.kv ? String(b.kv) : null;
        const fast = b.fast === true;
        const nar = handling === "utkast" ? "utkast" : String(b.nar ?? "nu");
        if (!(grupp in NH_GRUPPER)) return svar({ fel: "Välj vem det gäller." }, 400);
        if (!rubrik) return svar({ fel: "Skriv en rubrik.", falt: "rubrik" }, 400);
        if (rubrik.length > 140) return svar({ fel: "Rubriken får vara högst 140 tecken.", falt: "rubrik" }, 400);
        if (PNR.test(rubrik) || PNR.test(text)) return svar({ fel: "Det ser ut som ett personnummer. Navet sparar inga, så ta bort det.", falt: "text" }, 400);
        if (handling === "publicera" && text.length < 10) return svar({ fel: "Skriv några meningar om vad som gäller.", falt: "text" }, 400);
        if (kv && (!/^\d{4}-\d{2}-\d{2}$/.test(kv) || kv < idag)) return svar({ fel: "Sista dagen för kvittens kan inte ligga bakåt i tiden." }, 400);
        if (!["nu", "morgon", "mandag", "utkast"].includes(nar)) return svar({ fel: "Välj när." }, 400);
        const roller = [...NH_GRUPPER[grupp]];
        const schema = schemaTid(nar, idag);
        // Utan 0130 finns varken kvittens eller schemaläggning. Då sparas ingenting, hellre än ett inlägg utan dem.
        if (kv || schema) {
          const { error } = await db.from("news_post").select("ack_due, scheduled_at").limit(1);
          if (saknas0130(error)) return svar({ fel: "Kvittens och schemaläggning väntar på att databasen uppdateras (0130). Ingenting sparades." }, 409);
        }

        // Ett eget utkast som öppnats i skrivrutan skrivs över; annars läggs ett nytt upp med repots skapaNyhet.
        let p = slug ? await inlagg() : null;
        if (p && (p.author_id !== mig || p.status !== "draft")) p = null;
        let nySlug: string;
        if (p) {
          const { error } = await db.from("news_post").update({ title: rubrik, body_md: text, audience_roles: roller, audience_teams: [], pinned: fast, updated_at: new Date().toISOString() }).eq("id", p.id);
          if (error) return svar({ fel: `Inlägget kunde inte sparas: ${error.message}` }, 500);
          nySlug = p.slug;
        } else {
          const s = await medOmdirigering(() => skapaNyhet({}, form({ rubrik, text, roller, publicera: nar === "nu" ? "1" : "0", pinned: fast ? "1" : "0" })));
          if (s.fel) return svar({ fel: s.fel }, 400);
          nySlug = decodeURIComponent((s.till ?? "").replace(/^\/nyheter\//, ""));
        }
        const { data: rad } = await db.from("news_post").select("id, slug, status").eq("slug", nySlug).maybeSingle();
        if (!rad) return svar({ fel: "Inlägget kunde inte sparas." }, 500);
        // Utan 0130 ger uppdateringen ett fel, men då är både kv och schema null (se ovan) och inget går förlorat.
        await db.from("news_post").update({ ack_due: kv, scheduled_at: schema }).eq("id", rad.id);
        if (nar === "nu" && p) {
          const fel = await fangad(() => publiceraNyhet(form({ nyhet_id: rad.id })));
          if (fel) return svar({ fel }, 400);
        }
        if (schema) await logga("news.scheduled", nySlug, { nar: schema });
        if (handling === "utkast") return klart("Utkastet är sparat. Det öppnas nästa gång du skriver.", { slug: nySlug });
        if (schema) return klart(`Schemalagt till ${svensktDatum(schema)} 07:30.`, { slug: nySlug, schemalagt: schema });
        const { data: pers } = await db.from("employee").select("id, team_id").neq("status", "offboarded");
        const { data: rr } = await db.from("employee_role").select("employee_id, role");
        const rp = new Map<string, string[]>();
        for (const r of (rr ?? []) as { employee_id: string; role: string }[]) rp.set(r.employee_id, [...(rp.get(r.employee_id) ?? []), r.role]);
        const n = ((pers ?? []) as { id: string; team_id: string | null }[]).filter((x) => x.id !== mig && iMalgrupp(roller, [], { roller: rp.get(x.id) ?? [], team_id: x.team_id })).length;
        return klart(`Publicerat. ${n} fick en notis.`, { slug: nySlug });
      }

      // Ångra publiceringen i tio minuter: inlägget blir utkast igen och försvinner ur klockorna.
      case "publicera-ater": {
        const p = await inlagg();
        if (!p || p.author_id !== mig) return svar({ fel: "Inlägget finns inte." }, 404);
        const schemalagt = p.status === "draft" && !!p.scheduled_at;
        const nyss = p.status === "published" && !!p.published_at && Date.now() - Date.parse(p.published_at) < ANGRA_MIN * 60000;
        if (!schemalagt && !nyss) return svar({ fel: `Publiceringen går bara att ångra de första ${ANGRA_MIN} minuterna.` }, 400);
        await db.from("news_post").update({ status: "draft", published_at: null, scheduled_at: null, updated_at: new Date().toISOString() }).eq("id", p.id);
        if (!schemalagt) {
          await db.from("news_ack").delete().eq("post_id", p.id);
          await db.from("notification_event").delete().eq("kalla", "nyhet-paminn").eq("href", `/nyheter/${p.slug}`);
        }
        await logga("news.unpublished", p.slug);
        return klart("Ångrat. Inlägget är ett utkast igen.");
      }
    }
    return svar({ fel: "Okänd handling." }, 400);
  } catch (e) {
    return svar({ fel: e instanceof Error ? e.message : "Något gick fel." }, 500);
  }
}

