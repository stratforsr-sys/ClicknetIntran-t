import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { LAGE_KOL, REGEL_OBEKRAFTAT, arChefFor, lasGenomgang, lasInst, lasKrets, motesInfo, type LageRad } from "@/lib/nav2/forslag";
import { farAndraForslagInst, nyckelDelar, oppetLage, provaForslagInst, FORSLAG_NYCKLAR, type Val } from "@/lib/nav2/forslagforma";
import { dagText, textKvitto } from "@/lib/nav2/hemtext";
import { MATT, type MattNyckel } from "@/lib/nav2/matt";
import { lokalDag } from "@/lib/nav2/motesflode";
import { LASLAGE_TEXT, SKRIVLAGE, sammaUrsprung } from "@/lib/nav2/skrivlage";

export const dynamic = "force-dynamic";

/**
 * Nav 2.0: förslagsloggen, i en rutt (0303).
 *
 * GET ?las=forslag&id=…  Ett förslag, med Navs tre rader.
 * GET ?las=andrat        Det som ändrats: ändringar och dömda förslag läsaren får se.
 * GET ?las=facit         Navs facit per val, för den som leder ett lag.
 * GET ?las=team          Teamet i månaden, genomgången.
 *
 * POST, handlingar:
 *   valj          Den som håller mötet väljer Jag ringer själv eller Låt stå. Ett val per förslag: databasen
 *                 låser raden (`nav_forslag_valj`), så två klick ger ett beslut. Jag ringer själv lämnar över
 *                 bekräftelseuppgiften (`mote_bekrafta_overta`) och skriver vad som gjordes. Flytta mötet sparas
 *                 inte här, utan av Mötens rutt när mötet är flyttat.
 *   angra         Tar tillbaka valet och det valet skapade. Går inte efter domen.
 *   kommentar     Personens egen rad om sina tal, högst 200 tecken. Personens ord, inte Navs.
 *   beratta       Berätta om en ändring: om sig själv (alla), om en person i kretsen eller om laget (chefer).
 *   prova         Pröva med laget: en ändring för laget från en vald dag, som sedan följs och döms.
 *   installningar Gränserna och klockslaget (admin och uppåt), brytarna (superadmin).
 *
 * Nav kontaktar aldrig kunden, och ingenting här gör något på egen hand: varje skrivning är ett val en människa
 * gjorde. Loggen tar bara emot nya rader, så Ångra är en egen rad och inte en radering.
 *
 * LÄSLÄGE: står `SKRIVLAGE.hem` på false svarar POST 423 innan något skrivs.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAG = /^\d{4}-\d{2}-\d{2}$/;
const VAL: readonly Val[] = ["ringer-sjalv", "flytta", "lat-sta"];
const LASNINGAR = ["forslag", "andrat", "facit", "team"];

type Svar = { ok?: string; fel?: string; [k: string]: unknown };
const svar = (data: Svar, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user?.employee) return svar({ fel: "Du måste vara inloggad." }, 401);
  const url = new URL(request.url);
  const vad = url.searchParams.get("las") ?? "";
  if (!LASNINGAR.includes(vad)) return svar({ fel: "Okänd läsning." }, 400);
  try {
    const g = await lasGenomgang(user, vad, url.searchParams.get("id"));
    return svar(g.data, g.status);
  } catch (e) {
    return svar({ fel: e instanceof Error ? e.message : "Något gick fel." }, 500);
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
  const handling = String(b.handling ?? "");

  if (!SKRIVLAGE.hem) return svar({ fel: LASLAGE_TEXT, laslage: true }, 423);
  const db = supabaseAdmin();
  const nu = new Date();

  const lasRad = async (): Promise<LageRad | Response> => {
    const id = String(b.forslag ?? "");
    if (!UUID.test(id)) return svar({ fel: "Förslaget finns inte." }, 404);
    const { data } = await db.from("nav_forslag_lage").select(LAGE_KOL).eq("id", id).maybeSingle();
    const rad = data as unknown as LageRad | null;
    return rad ?? svar({ fel: "Förslaget finns inte." }, 404);
  };

  /** En ändring i loggen. Samma ändring två gånger får samma nyckel, så ett dubbelklick ger en rad. */
  const laggAndring = async (o: { text: string; om: string | null; lag: string | null; fran: string; matt: MattNyckel; avsikt: "beratta" | "prova" }): Promise<Response> => {
    const m = MATT[o.matt];
    const nyckel = createHash("sha256").update([o.matt, o.om ?? "", o.lag ?? "", o.fran, o.text].join("\n")).digest("hex").slice(0, 32);
    const { error } = await db.from("nav_forslag").insert({
      sort: "andring",
      regel: o.matt,
      nyckel,
      kalla: "person",
      om: o.om,
      lag: o.lag,
      skapad_av: mig,
      text: o.text,
      foljer: { matt: m.nyckel, motvikt: m.motvikt, version: m.version, fran: o.fran, avsikt: o.avsikt },
      prov: false,
    });
    if (error) {
      if ((error as { code?: string }).code === "23505") return svar({ fel: "Den ändringen finns redan." }, 409);
      return svar({ fel: "Ändringen kunde inte sparas." }, 500);
    }
    return svar({ ok: o.avsikt === "prova" ? "Sparat. Jag följer måttet från den dagen och säger hur det gick." : "Sparat. Jag följer måttet och säger hur det gick.", nyckel });
  };

  /** Texten, dagen och måttet i en ändring. Bara mått av sorten andel går att följa i det här steget. */
  const andringIndata = (): { text: string; fran: string; matt: MattNyckel } | Response => {
    const text = String(b.text ?? "").trim();
    if (!text) return svar({ fel: "Skriv vad som ändrades." }, 400);
    if (text.length > 500) return svar({ fel: "Texten får ha högst 500 tecken." }, 400);
    const fran = String(b.fran ?? "");
    if (!DAG.test(fran) || !Number.isFinite(Date.parse(`${fran}T12:00:00Z`))) return svar({ fel: "Välj från vilken dag ändringen gäller." }, 400);
    const matt = MATT[String(b.matt ?? "") as MattNyckel];
    if (!matt) return svar({ fel: "Välj vilket mått som ska följas." }, 400);
    if (matt.sort !== "andel") return svar({ fel: "Det måttet går inte att följa än." }, 400);
    return { text, fran, matt: matt.nyckel };
  };

  /** Laget en ändring gäller: teamledarens eget lag, eller hela företaget (null) för den som ser alla. */
  const lagetFor = async (krets: readonly string[] | null): Promise<{ lag: string | null } | Response> => {
    if (krets === null) return { lag: null };
    const { data } = await db.from("team").select("id").eq("lead_id", mig).limit(1);
    const lag = ((data ?? []) as unknown as { id: string }[])[0]?.id;
    return lag ? { lag } : svar({ fel: "Du leder inget lag." }, 403);
  };

  try {
    switch (handling) {
      case "valj": {
        const rad = await lasRad();
        if (rad instanceof Response) return rad;
        if (rad.sort !== "forslag") return svar({ fel: "Förslaget finns inte." }, 404);
        if (rad.om !== mig) return svar({ fel: "Bara den som håller mötet väljer." }, 403);
        const val = String(b.val ?? "") as Val;
        if (!VAL.includes(val) || !(rad.val ?? []).includes(val)) return svar({ fel: "Det valet finns inte i förslaget." }, 400);
        if (val === "flytta") return svar({ fel: "Flytta mötet i Möten. Valet sparas när mötet är flyttat." }, 400);
        if (rad.dom) return svar({ fel: "Förslaget har redan fått sin dom." }, 409);
        if (rad.beslut_id) return svar({ fel: "Valet är redan gjort." }, 409);

        const inst = await lasInst(db);
        const tz = inst.m.tidszon;
        const moteId = rad.regel === REGEL_OBEKRAFTAT ? nyckelDelar(rad.nyckel)?.mote ?? "" : "";
        const info = (await motesInfo(db, [moteId])).get(moteId);
        if (oppetLage(rad.nyckel, rad.utgar ?? "", info?.m ?? null, nu, tz) !== "oppet" || !info) {
          return svar({ fel: "Förslaget gäller inte längre. Mötet har ändrats, bekräftats eller börjat." }, 409);
        }

        const { data: beslut, error } = await db.rpc("nav_forslag_valj", { p_forslag: rad.id, p_av: mig, p_data: { val } });
        if (error) return svar({ fel: "Valet kunde inte sparas." }, 500);
        if (!beslut) return svar({ fel: "Valet är redan gjort." }, 409);

        if (val === "ringer-sjalv") {
          const idag = lokalDag(nu, tz);
          const { data: tagen, error: tfel } = await db.rpc("mote_bekrafta_overta", {
            p_mote: info.m.id,
            p_till: mig,
            p_dag: idag,
            p_titel: `Bekräfta mötet med ${info.kund}`,
            p_beskrivning:
              "Du valde att ringa själv. Ring kunden och bekräfta mötet.\n\n" +
              "Bockar du av uppgiften blir mötet bekräftat i Möten, och bekräftar du i Möten bockas uppgiften av. Får du inte tag på kunden: tryck Fick inte tag på mötet, så ligger uppgiften kvar.",
          });
          const t = tagen as { task?: string; fran?: string | null; ny?: boolean } | null;
          if (tfel || !t?.task) {
            // Valet står inte kvar utan sin åtgärd: det tas tillbaka, så att förslaget är öppet eller stängs av jobbet.
            await db.rpc("nav_forslag_angra", { p_forslag: rad.id, p_av: mig, p_data: { skal: "Uppgiften gick inte att ta över." } });
            return svar({ fel: "Bekräftelsen gick inte att ta över. Mötet kan redan vara bekräftat." }, 409);
          }
          const { error: afel } = await db.from("nav_forslag_handelse").insert({ forslag: rad.id, sort: "atgard", av: mig, data: { uppgift: t.task, fran: t.fran ?? null, ny: t.ny === true } });
          if (afel) return svar({ fel: "Uppgiften ligger hos dig, men kvittot kunde inte sparas. Ångra går inte för det här valet." }, 500);
        }
        const dom = rad.doms_dag ? dagText(rad.doms_dag, lokalDag(nu, tz)) : "efter mötet";
        return svar({ ok: textKvitto(val, dom), forslag: rad.id, val, angra: true });
      }

      case "angra": {
        const rad = await lasRad();
        if (rad instanceof Response) return rad;
        if (rad.om !== mig) return svar({ fel: "Bara den som valde ångrar." }, 403);
        if (rad.dom) return svar({ fel: "Förslaget har fått sin dom. Valet går inte att ångra." }, 409);
        const val = rad.beslut?.val;
        if (!rad.beslut_id || !val || val === "ingen" || val === "inaktuellt") return svar({ fel: "Det finns inget val att ångra." }, 409);
        if (val === "flytta") return svar({ fel: "Mötet är flyttat. Flytta tillbaka det i Möten om det blev fel." }, 409);
        const { data: angrat, error } = await db.rpc("nav_forslag_angra", { p_forslag: rad.id, p_av: mig, p_data: {} });
        if (error) return svar({ fel: "Det gick inte att ångra." }, 500);
        if (!angrat) return svar({ fel: "Det finns inget val att ångra." }, 409);
        let varning: string | undefined;
        if (rad.atgard?.uppgift) {
          const { data: tillbaka, error: tfel } = await db.rpc("mote_bekrafta_aterlamna", { p_task: rad.atgard.uppgift, p_fran: rad.atgard.fran ?? null, p_ny: rad.atgard.ny === true, p_av: mig });
          if (tfel || tillbaka !== true) varning = "Uppgiften gick inte att lämna tillbaka. Den kan redan vara avbockad.";
        }
        return svar({ ok: "Ångrat. Förslaget är öppet igen.", forslag: rad.id, oppet: true, ...(varning ? { varning } : {}) });
      }

      case "kommentar": {
        const rad = await lasRad();
        if (rad instanceof Response) return rad;
        if (rad.om !== mig) return svar({ fel: "Bara den raden handlar om skriver sin egen rad." }, 403);
        const text = String(b.text ?? "").trim();
        if (!text) return svar({ fel: "Skriv en rad." }, 400);
        if (text.length > 200) return svar({ fel: "Raden får ha högst 200 tecken." }, 400);
        const { error } = await db.from("nav_forslag_handelse").insert({ forslag: rad.id, sort: "kommentar", av: mig, data: { text } });
        if (error) return svar({ fel: "Raden kunde inte sparas." }, 500);
        return svar({ ok: "Sparat. Din rad står bredvid talen.", forslag: rad.id, kommentar: text });
      }

      case "beratta": {
        const inn = andringIndata();
        if (inn instanceof Response) return inn;
        const om = String(b.om ?? "");
        if (om === "jag" || om === mig) return await laggAndring({ ...inn, om: mig, lag: null, avsikt: "beratta" });
        // Om någon annan, eller om laget: bara den som har en krets större än sig själv.
        const krets = await lasKrets(await supabaseServer(), user);
        if (krets === undefined) return svar({ fel: "Det gick inte att läsa vilka du leder." }, 500);
        if (!arChefFor(krets, mig)) return svar({ fel: om === "laget" ? "Bara den som leder ett lag berättar för laget." : "Du berättar bara om dig själv." }, 403);
        if (om === "laget") {
          const l = await lagetFor(krets);
          if (l instanceof Response) return l;
          return await laggAndring({ ...inn, om: null, lag: l.lag, avsikt: "beratta" });
        }
        if (!UUID.test(om)) return svar({ fel: "Välj vem ändringen gäller." }, 400);
        if (krets !== null && !krets.includes(om)) return svar({ fel: "Personen hör inte till ditt lag." }, 403);
        const { data: finns } = await db.from("employee").select("id").eq("id", om).neq("status", "offboarded").maybeSingle();
        if (!finns) return svar({ fel: "Personen finns inte eller har slutat." }, 400);
        return await laggAndring({ ...inn, om, lag: null, avsikt: "beratta" });
      }

      case "prova": {
        const krets = await lasKrets(await supabaseServer(), user);
        if (krets === undefined) return svar({ fel: "Det gick inte att läsa vilka du leder." }, 500);
        if (!arChefFor(krets, mig)) return svar({ fel: "Bara den som leder ett lag prövar med laget." }, 403);
        const inn = andringIndata();
        if (inn instanceof Response) return inn;
        const l = await lagetFor(krets);
        if (l instanceof Response) return l;
        return await laggAndring({ ...inn, om: null, lag: l.lag, avsikt: "prova" });
      }

      case "installningar": {
        const nyckel = String(b.nyckel ?? "");
        const p = provaForslagInst(nyckel, b.varde);
        if (!farAndraForslagInst(user.roles, nyckel)) {
          if (!p.ok && p.fel === "Okänd inställning.") return svar({ fel: p.fel }, 400);
          return svar({ fel: "Den inställningen ändras av en superadmin." }, 403);
        }
        if (!p.ok) return svar({ fel: p.fel }, 400);
        if (nyckel === FORSLAG_NYCKLAR.hemNytt && Array.isArray(p.varde)) {
          const ids = p.varde as string[];
          const { data } = ids.length ? await db.from("employee").select("id").in("id", ids).neq("status", "offboarded").limit(ids.length) : { data: [] };
          if (((data ?? []) as unknown[]).length !== ids.length) return svar({ fel: "Någon i listan finns inte eller har slutat." }, 400);
        }
        // Gammalt och nytt värde skrivs i händelseloggen av triggern på nav_setting (0303).
        const { error } = await db.from("nav_setting").upsert({ key: nyckel, value: p.varde, updated_by: mig, updated_at: nu.toISOString() });
        if (error) return svar({ fel: "Inställningen kunde inte sparas." }, 500);
        return svar({ ok: "Sparat.", nyckel, varde: p.varde });
      }

      default:
        return svar({ fel: "Okänd handling." }, 400);
    }
  } catch (e) {
    return svar({ fel: e instanceof Error ? e.message : "Något gick fel." }, 500);
  }
}
