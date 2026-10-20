import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Utkastet i tre delar: sidans borjan, stilen och skriptet.
 *
 * ===========================================================================
 * SKRIPTET OCH STILEN AR SAMMA FOR ALLA, DATAN AR DIN EGEN. Forr lag allt i
 * samma svar: 3,2 MB (0,9 MB komprimerat) som inte gick att cacha eftersom
 * datan lag bredvid. Nu hamtas skriptet och stilen som egna filer med
 * versionen i adressen (`?v=<hash>`), och webblasaren sparar dem tills filen
 * andras. Svaret pa /nav2 ar bara sidans borjan och datan.
 * ===========================================================================
 *
 * Filen `src/nav2/utkast.html` ar fortfarande exakt den som ligger som
 * artifact: en `<style>`, lite markup och en `<script>`. Delningen sker har,
 * en gang per instans.
 */
export type Utkastdelar = {
  fore: string; // allt fore <style>
  stil: string;
  mitt: string; // mellan </style> och <script>
  skript: string;
  efter: string; // efter </script>
  vStil: string;
  vSkript: string;
};

const kort = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 12);

let delar: Promise<Utkastdelar> | null = null;
export function lasUtkast(): Promise<Utkastdelar> {
  if (!delar) {
    delar = readFile(path.join(process.cwd(), "src/nav2/utkast.html"), "utf8").then((html) => {
      const s0 = html.indexOf("<style>"), s1 = html.indexOf("</style>", s0);
      const k0 = html.indexOf("<script>", s1), k1 = html.lastIndexOf("</script>");
      if (s0 < 0 || s1 < 0 || k0 < 0 || k1 < k0) throw new Error("Utkastet saknar sin stil eller sitt skript.");
      const stil = html.slice(s0 + "<style>".length, s1);
      const skript = html.slice(k0 + "<script>".length, k1);
      return {
        fore: html.slice(0, s0),
        stil,
        mitt: html.slice(s1 + "</style>".length, k0),
        skript,
        efter: html.slice(k1 + "</script>".length),
        vStil: kort(stil),
        vSkript: kort(skript),
      };
    });
    // Ett fel ska inte fastna for instansens livstid.
    delar.catch(() => { delar = null; });
  }
  return delar;
}

/** Svaret for skriptet eller stilen. Ratt version sparas i ett ar; en gammal adress laddas om varje gang. */
export function utkastfil(innehall: string, typ: string, version: string, fragad: string | null): Response {
  return new Response(innehall, {
    headers: {
      "Content-Type": `${typ}; charset=utf-8`,
      "Cache-Control": fragad === version ? "private, max-age=31536000, immutable" : "private, no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
