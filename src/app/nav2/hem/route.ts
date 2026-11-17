import { NextResponse } from "next/server";
import { fullName, getCurrentUser } from "@/lib/auth";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { skrivFel } from "@/lib/fel-server";
import { notifiera } from "@/lib/notishandelse-server";
import { byggGolvet, golvetsKrets, hemmetsTidszon } from "@/lib/nav2/hem";
import { felkod, textFel } from "@/lib/nav2/hemtext";
import { lokalDag } from "@/lib/nav2/motesflode";
import { harGodkants, type Order } from "@/lib/order";
import { byggKvall } from "@/lib/nav2/hem-kvall";
import { pushaTill, vapidPublik } from "@/lib/nav2/push";
import { arPushtjanst } from "@/lib/nav2/pushvard";
import { LASLAGE_TEXT, SKRIVLAGE, sammaUrsprung } from "@/lib/nav2/skrivlage";
import { chattMiljo } from "@/lib/nav2/chatt/logg";
import { EJ_KLAR_BESKED, STAMMER_INTE_HUVUD, vantarSlutrad } from "@/lib/nav2/chatt/chattforma";

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
 *            Med `var: "manad"` är det "Fråga om raden" i Din månad: en
 *            provisionsrad som ser fel ut. Den går till samma kö, men raden
 *            göms aldrig, för den är pengar och inte en sammanfattning.
 *            Med `var: "chatt"` är det "Stämmer inte" under ett svar i chatten:
 *            klienten skickar bara `rad` (loggradens id), och frågan och svaret
 *            läses ur personens egen loggrad, till samma kö (hela ärendet högst
 *            MAX_BODY tecken, id:t först). 409 med `kod: "ej-klar"` medan raden
 *            pågår eller stoppas och är yngre än PAGAR_MS. Samma rad en gång
 *            till, efter att det första ärendet är skrivet, ger `redan: true`
 *            och inget nytt ärende. Två klick samtidigt kan bli två ärenden:
 *            spärren läser och skriver sedan, och det finns inget unikt index
 *            för manuella ärenden (det kräver en migration).
 *   dolj     "Visa inte X här": sorten döljs i din sammanfattning (`hem.dolda`).
 *            `visa` tar tillbaka den.
 *   sett     När du senast tittade på startsidan (`hem.sett`), för "Sedan du tittade".
 *   golvet   Valet `hem.golvet` sparas, men styr inget längre: alla i laget ser lagets rader.
 *   push     Slå på kvällsnotisen på den här enheten (0121 `push_subscription`).
 *   push-av  Stäng av den på den här enheten.
 *   push-prov  Skicka notisen till dina enheter nu, för att se att den kommer fram.
 *
 * Lagets mål sätts i Provision (säljarnas mål, 0049); Golvet räknar summan.
 *
 * GET ?golvet=1 läser Golvet igen (Live), med samma regler som sidan. Svaret är
 * `{ golvet, golvetUtanLag }`: golvet null och golvetUtanLag true för den som inte har något lag.
 *
 * FEL: databasens eller tjänstens egen text går bara till loggen. Klienten får en
 * kort svensk mening och en felkod på fem tecken (`felkod`) att slå upp i loggen.
 * GET ?kvall=1 är kvällsnotisens text för den inloggade (`hem-kvall.ts`). Den
 * hämtas av enhetens service worker när pushen kommer, med personens kaka.
 *
 * LÄSLÄGE: står `SKRIVLAGE.hem` på false svarar POST 423 innan något skrivs.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SORTER = ["tid", "order", "coachning", "uppgift", "lead", "rutin", "frånvaro", "ärenden", "kv", "personal", "rekrytering", "leads", "utbildning", "fel"];

type Svar = { ok?: string; fel?: string; [k: string]: unknown };
const svar = (data: Svar, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });

/** Ett oväntat fel: hela texten i loggen med en kod, kort svenska och samma kod till klienten. */
const krasch = (e: unknown, sort: "lasa" | "spara") => {
  const kod = felkod();
  console.error(`nav2/hem ${kod}: ${e instanceof Error ? e.message : String(e)}`);
  return svar({ fel: textFel(sort, kod), felkod: kod }, 500);
};

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user?.employee) return svar({ fel: "Du måste vara inloggad." }, 401);
  const url = new URL(request.url);
  try {
    if (url.searchParams.get("kvall") === "1") return svar({ kvall: await byggKvall(await supabaseServer(), user) });
    if (url.searchParams.get("golvet") !== "1") return svar({ fel: "Okänd läsning." }, 400);
    const golvet = await byggGolvet(user);
    return svar({ golvet, golvetUtanLag: golvet === null });
  } catch (e) {
    return krasch(e, "lasa");
  }
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
  // En kropp som inte är ett objekt (`null`, en lista, en text) är lika ogiltig som en som inte går att läsa.
  if (!b || typeof b !== "object" || Array.isArray(b)) return svar({ fel: "Ogiltig begäran." }, 400);
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
        // Bara en order som står på Golvet för den här personen: godkänd i dag, i laget. Samma krets och samma
        // regel som Golvet (`golvetsKrets`), men en läsning av just den ordern i stället för hela Golvet.
        const [krets, tz, { data: o, error: oFel }, { data: given, error: gFel }] = await Promise.all([
          golvetsKrets(user),
          hemmetsTidszon(),
          db.from("sales_order").select("salesperson_id, company_name, status, approved_at").eq("id", id).maybeSingle(),
          db.from("order_grattis").select("order_id").eq("order_id", id).eq("employee_id", mig).maybeSingle(),
        ]);
        if (oFel || gFel) throw new Error((oFel ?? gFel)?.message);
        const order = o as { salesperson_id: string; company_name: string | null; status: string; approved_at: string | null } | null;
        const godkandIdag = !!order?.approved_at && ["signerad", "betald"].includes(order.status) && harGodkants(order.status as Order["status"]) && lokalDag(order.approved_at, tz) === lokalDag(new Date(), tz);
        const iLaget = !!krets && !!order && (krets.lag === null || krets.folk.some((p) => p.id === order.salesperson_id));
        if (!order || !godkandIdag || !iLaget) return svar({ fel: "Ordern står inte på Golvet." }, 404);
        if (order.salesperson_id === mig) return svar({ fel: "Det är din egen order." }, 400);
        if (given) {
          const { error } = await db.from("order_grattis").delete().eq("order_id", id).eq("employee_id", mig);
          if (error) return svar({ fel: "Det gick inte att ta bort." }, 500);
          return svar({ ok: "Grattis borttaget." });
        }
        // Två klick samtidigt blir ett Grattis: den andra raden ignoreras, och bara den som sparade skickar plingen.
        const { data: ny, error } = await db.from("order_grattis").upsert({ order_id: id, employee_id: mig }, { onConflict: "order_id,employee_id", ignoreDuplicates: true }).select("order_id");
        if (error) return svar({ fel: "Det gick inte att spara." }, 500);
        if ((ny ?? []).length) {
          // Plingen är en bonus: Grattis är sparat även om notisen inte går iväg.
          try {
            await notifiera({
              till: order.salesperson_id,
              av: mig,
              kalla: "order-grattis",
              typ: "order",
              rubrik: `${fullName(user.employee)} gratulerar`,
              detalj: order.company_name ?? "",
              href: `/order/${id}`,
              objekt: { typ: "sales_order", id },
            });
          } catch (e) {
            console.error(`nav2/hem: grattis-plingen gick inte iväg: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        return svar({ ok: "Grattis skickat. Säljaren får en pling." });
      }

      case "flagga": {
        if (b.var === "chatt") {
          // Chattens svar: frågan och svaret ur personens egen loggrad i samma miljö, inte ur klienten.
          const id = String(b.rad ?? "").trim().toLowerCase();
          if (!UUID.test(id)) return svar({ fel: "Svaret saknas." }, 400);
          const { data: logg, error } = await db.from("nav_chatt_logg").select("fraga, svar, stop_reason, nar").eq("id", id).eq("employee_id", mig).eq("miljo", chattMiljo()).maybeSingle();
          if (error) throw new Error(error.message);
          const l = logg as { fraga?: unknown; svar?: unknown; stop_reason?: unknown; nar?: unknown } | null;
          if (!l) return svar({ fel: "Svaret finns inte längre." }, 404);
          // R1: svaret kommer före loggens slutrad. Pågår raden, eller väntar en stoppad rad på sin slutrad, står
          // svaret inte i den än: 409, och klienten försöker igen när strömmen har stängts. En sådan rad äldre än
          // PAGAR_MS får aldrig sin slutrad, och ärendet skickas då med "(inget svar sparat)".
          if (vantarSlutrad(l.stop_reason, l.nar, Date.now())) return svar({ fel: EJ_KLAR_BESKED, kod: "ej-klar" }, 409);
          // Loggradens id står först, så att det överlever när en lång text klipps (MAX_BODY), och så att samma svar
          // inte skickas två gånger: ett andra Stämmer inte på samma rad från samma person blir inget nytt ärende.
          // Spärren läser och skriver sedan, så den fångar ett klick som kommer efter att det första är skrivet, inte
          // två samtidiga (det kräver ett unikt index, alltså en migration). Går läsningen inte att göra skickas ärendet
          // ändå: hellre ett ärende för mycket än ett Stämmer inte som försvinner.
          const huvud = `${STAMMER_INTE_HUVUD}${id}).`;
          const { data: redan, error: redanFel } = await db.from("error_report").select("id").eq("reporter_id", mig).eq("kind", "manual").like("body", `${huvud}%`).limit(1);
          if (!redanFel && Array.isArray(redan) && redan.length > 0) return svar({ ok: "Redan skickat till den som förvaltar Nav.", redan: true });
          const fraga = typeof l.fraga === "string" && l.fraga.trim() ? l.fraga.trim() : "(sparas inte längre)";
          const svaret = typeof l.svar === "string" && l.svar.trim() ? l.svar.trim() : "(inget svar sparat)";
          const ok = await skrivFel({
            kind: "manual",
            path: "/nav2",
            digest: null,
            body: `${huvud}\n\nFråga: ”${fraga}”\n\nSvar: ”${svaret}”`,
            blocking: false,
            reporterId: mig,
            userAgent: request.headers.get("user-agent"),
            pointedAt: `Startsidan · Chatten · ${fraga}`.slice(0, 300),
          });
          if (!ok) return svar({ fel: "Det gick inte att spara." }, 500);
          return svar({ ok: "Skickat till den som förvaltar Nav, med frågan och svaret." });
        }
        const rad = String(b.rad ?? "").trim().slice(0, 80);
        const text = String(b.text ?? "").trim().slice(0, 300);
        if (!rad || !text) return svar({ fel: "Raden saknas." }, 400);
        // Din månad: en fråga om en provisionsrad. Samma kö, men raden står kvar.
        const manad = b.var === "manad";
        const plats = manad ? "Din månad" : "Din dag i korthet";
        const ok = await skrivFel({
          kind: "manual",
          path: "/nav2",
          digest: null,
          body: manad ? `Startsidan, Din månad: en fråga om provisionsraden. ”${text}”` : `Startsidan, Din dag i korthet: raden stämmer inte. ”${text}”`,
          blocking: false,
          reporterId: mig,
          userAgent: request.headers.get("user-agent"),
          // Var raden stod, i ord. Radens id står kvar i `hem.flaggade` för den som flaggade.
          pointedAt: `Startsidan · ${plats} · ${text}`.slice(0, 300),
        });
        if (!ok) return svar({ fel: "Det gick inte att spara." }, 500);
        if (manad) return svar({ ok: "Frågan är skickad till den som förvaltar Nav, med provisionsraden bifogad." });
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
        // Valet sparas men styr inget: alla i laget ser lagets rader (beställaren 2026-10-19). Svaret lovar inget annat.
        return svar({ ok: "Sparat. Alla i laget ser lagets godkända order på Golvet, också dina." });
      }

      case "push": {
        const sub = (b.sub ?? {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
        const endpoint = String(sub.endpoint ?? ""), p256dh = String(sub.keys?.p256dh ?? ""), auth = String(sub.keys?.auth ?? "");
        if (!vapidPublik()) return svar({ fel: "Pushnotiser är inte inställda i Nav än." }, 503);
        if (!/^https:\/\/[^\s]+$/.test(endpoint) || !arPushtjanst(endpoint) || !p256dh || !auth) return svar({ fel: "Enheten gick inte att registrera." }, 400);
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
        const u = await pushaTill(db, mig, { sort: "push-prov" });
        if (!u.enheter) return svar({ fel: "Ingen enhet har slagit på kvällsnotisen." }, 400);
        await db.from("push_sent").upsert({ employee_id: mig, kind: "prov", day: nu.slice(0, 10), sent_at: nu, devices: u.ok }, { onConflict: "employee_id,kind,day" });
        if (!u.ok) {
          if (u.fel.length) console.error(`nav2/hem: push-prov kom inte fram: ${u.fel.join(" | ")}`);
          return svar({ fel: "Notisen kom inte fram till någon av dina enheter. Slå av och på kvällsnotisen och försök igen." }, 502);
        }
        return svar({ ok: `Skickad till ${u.ok} ${u.ok === 1 ? "enhet" : "enheter"}. Den kommer om några sekunder.` });
      }

      default:
        return svar({ fel: "Okänd handling." }, 400);
    }
  } catch (e) {
    return krasch(e, "spara");
  }
}
