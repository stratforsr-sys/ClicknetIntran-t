import "server-only";
import { SUPABASE_SERVICE_KEY } from "@/lib/env";
import { ATERSTALL_MINUTER } from "@/lib/inloggning";

/**
 * "Glömt lösenordet?": kvittot som släpper fram ett nytt lösenord utan det
 * gamla.
 *
 * Den som loggat in med en engångskod till sin mejl har visat att den äger
 * brevlådan, och det är samma sak som varje återställning av ett lösenord
 * bygger på. Kvittot skrivs när koden godkänts med syftet "glomt" (eller när
 * kontot har ett tvingat byte), är bundet till kontot och gäller i
 * ATERSTALL_MINUTER minuter. /byt-losenord frågar då inte efter det gamla
 * ordet.
 *
 * Egen signering och inte `skapaKvitto` i mfa.ts. Båda bygger på samma
 * hemlighet, så signaturen tar med syftet: annars hade ett återställnings-
 * kvitto gått att visa upp som ett steg två-kvitto, och tvärtom.
 */

export const ATERSTALL_KAKA = "nav_aterstall";

const SYFTE = "aterstall";

function hemlighet(): string {
  return process.env.STEG2_SECRET || SUPABASE_SERVICE_KEY;
}

async function signera(data: string): Promise<string> {
  const nyckel = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(hemlighet()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", nyckel, new TextEncoder().encode(`${SYFTE}.${data}`));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function likaLangsamt(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let skillnad = 0;
  for (let i = 0; i < a.length; i++) skillnad |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return skillnad === 0;
}

export async function skapaAterstallning(authUserId: string): Promise<{ varde: string; utgang: Date }> {
  const utgang = new Date(Date.now() + ATERSTALL_MINUTER * 60 * 1000);
  const kropp = `${authUserId}.${utgang.getTime()}`;
  return { varde: `${kropp}.${await signera(kropp)}`, utgang };
}

/**
 * När kvittot slutar gälla, eller null om det inte gäller (saknas, fel konto,
 * fel signatur, utgånget). Sidan visar tiden: "Välj ett nytt lösenord före 22:02".
 */
export async function aterstallningTill(varde: string | undefined, authUserId: string): Promise<Date | null> {
  if (!varde) return null;
  const bitar = varde.split(".");
  if (bitar.length !== 3) return null;
  const [id, utgang, sig] = bitar;
  if (id !== authUserId) return null;
  const tid = Number(utgang);
  if (!Number.isFinite(tid) || tid < Date.now()) return null;
  return likaLangsamt(sig, await signera(`${id}.${utgang}`)) ? new Date(tid) : null;
}

export async function aterstallningGiltig(varde: string | undefined, authUserId: string): Promise<boolean> {
  return (await aterstallningTill(varde, authUserId)) !== null;
}
