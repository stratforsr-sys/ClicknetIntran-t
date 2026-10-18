import { NextResponse } from "next/server";
import { fullName, getCurrentUser } from "@/lib/auth";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { skrivFel } from "@/lib/fel-server";
import { notifiera } from "@/lib/notishandelse-server";
import { byggGolvet } from "@/lib/nav2/hem";
import { byggKvall } from "@/lib/nav2/hem-kvall";
import { pushaTill, vapidPublik } from "@/lib/nav2/push";
import { LASLAGE_TEXT, SKRIVLAGE, sammaUrsprung } from "@/lib/nav2/skrivlage";

export const dynamic = "force-dynamic";

/**
 * Nav 2.0: det startsidan själv ändrar, i en rutt.
 *
 * Handlingarna i startsidans rader (bekräfta en sjukanmälan, bevilja, bocka av
 * en uppgift, kvittera en rutin) går till respektive vys rutt och står bakom
 * den vyns brytare. Här ligger bara startsidans egna:
 *
 *   grattis  Grattis på en order på Golvet (0120 `order_grattis`), en gång per
 *            person och order. Säljaren får notisen `order-grattis`. Igen = ta bort.
 *   flagga   "Stämmer inte" i Din dag i korthet: raden döljs för dig
 *            (`hem.flaggade`) och blir en felrapport i kön på /fel, med raden i
 *            klartext, så att den som förvaltar Nav kan rätta sammanfattningen.
 *   dolj     "Visa inte X här": sorten döljs i din sammanfattning (`hem.dolda`).
 *            `visa` tar tillbaka den.
 *   sett     När du senast tittade på startsidan (`hem.sett`), för "Sedan du tittade".
 *   golvet   Om du syns på Golvet för kollegorna (`hem.golvet`).
 *   push     Slå på kvällsnotisen på den här enheten (0121 `push_subscription`).
 *   push-av  Stäng av den på den här enheten.
 *   push-prov  Skicka notisen till dina enheter nu, för att se att den kommer fram.
 *
 * Lagets mål sätts i Provision (säljarnas mål, 0049); Golvet räknar summan.
 *
 * GET ?golvet=1 läser Golvet igen (Live), med samma regler som sidan.
 * GET ?kvall=1 är kvällsnotisens text för den inloggade (`hem-kvall.ts`). Den
 * hämtas av enhetens service worker när pushen kommer, med personens kaka.
 *
 * LÄSLÄGE: står `SKRIVLAGE.hem` på false svarar POST 423 innan något skrivs.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SORTER = ["tid", "order", "coachning", "uppgift", "lead", "rutin", "frånvaro", "ärenden", "kv", "personal", "rekrytering", "leads", "utbildning", "fel"];

type Svar = { ok?: string; fel?: string; [k: string]: unknown };
const svar = (data: Svar, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user?.employee) return svar({ fel: "Du måste vara inloggad." }, 401);
  const url = new URL(request.url);
  if (url.searchParams.get("kvall") === "1") return svar({ kvall: await byggKvall(await supabaseServer(), user) });
  if (url.searchParams.get("golvet") !== "1") return svar({ fel: "Okänd läsning." }, 400);
  return svar({ golvet: await byggGolvet(user) });
}

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
  const handling = String(b.handling ?? "");

  if (!SKRIVLAGE.hem) return svar({ fel: LASLAGE_TEXT, laslage: true }, 423);
  const db = supabaseAdmin();
  const nu = new Date().toISOString();

  const lasVal = async (key: string): Promise<string[]> => {
    const { data } = await db.from("nav_preference").select("value").eq("employee_id", mig).eq("key", key).maybeSingle();
    const v = data?.value as unknown;
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
  };
  const sparaVal = async (key: string, value: unknown) => {
    const { error } = await db.from("nav_preference").upsert({ employee_id: mig, key, value, updated_at: nu }, { onConflict: "employee_id,key" });
    return !error;
  };

  try {
    switch (handling) {
      case "grattis": {
        const id = String(b.order ?? "");
        if (!UUID.test(id)) return svar({ fel: "Ordern finns inte." }, 400);
        // Bara en order som står på Golvet för den här personen: godkänd i dag, i laget.
        const golvet = await byggGolvet(user);
        const rad = golvet?.idag.find((r) => r.id === id);
        if (!rad) return svar({ fel: "Ordern står inte på Golvet." }, 404);
        if (rad.du) return svar({ fel: "Det är din egen order." }, 400);
        if (rad.jag) {
          await db.from("order_grattis").delete().eq("order_id", id).eq("employee_id", mig);
          return svar({ ok: "Grattis borttaget." });
        }
        const { error } = await db.from("order_grattis").insert({ order_id: id, employee_id: mig });
        if (error) return svar({ fel: "Det gick inte att spara." }, 500);
        const { data: o } = await db.from("sales_order").select("salesperson_id, company_name").eq("id", id).maybeSingle();
        if (o) {
          await notifiera({
            till: o.salesperson_id as string,
            av: mig,
            kalla: "order-grattis",
            typ: "order",
            rubrik: `${fullName(user.employee)} gratulerar`,
            detalj: (o.company_name as string | null) ?? "",
            href: "/",
            objekt: { typ: "sales_order", id },
          });
        }
        return svar({ ok: "Grattis skickat. Säljaren får en pling." });
      }

      case "flagga": {
        const rad = String(b.rad ?? "").trim().slice(0, 80);
        const text = String(b.text ?? "").trim().slice(0, 300);
        if (!rad || !text) return svar({ fel: "Raden saknas." }, 400);
        const ok = await skrivFel({
          kind: "manual",
          path: "/nav2",
          digest: null,
          body: `Startsidan, Din dag i korthet: raden stämmer inte. ”${text}”`,
          blocking: false,
          reporterId: mig,
          userAgent: request.headers.get("user-agent"),
          pointedAt: `Din dag i korthet · ${rad}`,
        });
        if (!ok) return svar({ fel: "Det gick inte att spara." }, 500);
        const l = await lasVal("hem.flaggade");
        if (!l.includes(rad)) await sparaVal("hem.flaggade", [...l, rad].slice(-50));
        return svar({ ok: "Markerad som fel. Raden blir underlag för att rätta sammanfattningen." });
      }

      case "dolj":
      case "visa": {
        const sort = String(b.sort ?? "");
        if (!SORTER.includes(sort)) return svar({ fel: "Okänd sort." }, 400);
        const l = await lasVal("hem.dolda");
        const ny = handling === "dolj" ? [...new Set([...l, sort])] : l.filter((x) => x !== sort);
        if (!(await sparaVal("hem.dolda", ny))) return svar({ fel: "Det gick inte att spara." }, 500);
        return svar({ ok: handling === "dolj" ? "Sorten visas inte i sammanfattningen längre." : "Sorten visas igen." });
      }

      case "sett": {
        if (!(await sparaVal("hem.sett", nu))) return svar({ fel: "Det gick inte att spara." }, 500);
        return svar({ ok: "Sparat." });
      }

      case "golvet": {
        const ja = b.syns === true;
        if (!(await sparaVal("hem.golvet", ja))) return svar({ fel: "Det gick inte att spara." }, 500);
        return svar({ ok: ja ? "Dina godkända order syns på Golvet för laget." : "Dina order syns inte på Golvet för kollegorna." });
      }

      case "push": {
        const sub = (b.sub ?? {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
        const endpoint = String(sub.endpoint ?? ""), p256dh = String(sub.keys?.p256dh ?? ""), auth = String(sub.keys?.auth ?? "");
        if (!vapidPublik()) return svar({ fel: "Pushnotiser är inte inställda i Nav än." }, 503);
        if (!/^https:\/\/[^\s]+$/.test(endpoint) || endpoint.length > 1000 || !p256dh || !auth) return svar({ fel: "Enheten gick inte att registrera." }, 400);
        const { error } = await db.from("push_subscription").upsert(
          { employee_id: mig, endpoint, p256dh, auth, user_agent: (request.headers.get("user-agent") ?? "").slice(0, 300), created_at: nu, last_error: null },
          { onConflict: "endpoint" },
        );
        if (error) return svar({ fel: "Det gick inte att spara." }, 500);
        return svar({ ok: "Kvällsnotisen kommer till den här enheten." });
      }

      case "push-av": {
        const endpoint = String(b.endpoint ?? "");
        if (!endpoint) return svar({ fel: "Enheten saknas." }, 400);
        await db.from("push_subscription").delete().eq("employee_id", mig).eq("endpoint", endpoint);
        return svar({ ok: "Kvällsnotisen kommer inte hit längre." });
      }

      case "push-prov": {
        const u = await pushaTill(db, mig);
        if (!u.enheter) return svar({ fel: "Ingen enhet har slagit på kvällsnotisen." }, 400);
        await db.from("push_sent").upsert({ employee_id: mig, kind: "prov", day: nu.slice(0, 10), sent_at: nu, devices: u.ok }, { onConflict: "employee_id,kind,day" });
        if (!u.ok) return svar({ fel: `Notisen kom inte fram${u.fel.length ? `: ${u.fel[0]}` : "."}` }, 502);
        return svar({ ok: `Skickad till ${u.ok} ${u.ok === 1 ? "enhet" : "enheter"}. Den kommer om några sekunder.` });
      }

      default:
        return svar({ fel: "Okänd handling." }, 400);
    }
  } catch (e) {
    return svar({ fel: e instanceof Error ? e.message : "Något gick fel." }, 500);
  }
}
