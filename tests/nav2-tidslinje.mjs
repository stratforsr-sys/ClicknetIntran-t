#!/usr/bin/env node
/**
 * Kundkortets tidslinje (0278): Markdown-tolken som ritar anteckningarna.
 *
 *   node tests/nav2-tidslinje.mjs
 *
 * Anteckningarna kommer från Inkio och från Nav, och de skrivs i Markdown som
 * Inkios egna. Tolken (`kktMd` i src/nav2/utkast.html) ritar dem som HTML i
 * kundkortet, så den får aldrig släppa igenom HTML eller en länk som kör kod:
 * texten escapas först, och bara http(s)-länkar blir länkar. Provet plockar
 * funktionen ur utkastet och kör den.
 *
 * Fliken i webbläsaren (Hedbloms riktiga historik, 38 kontroller) provas i
 * ~/nav2-utkast/delar/kund-tidslinje/prov.mjs.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const rot = join(fileURLToPath(import.meta.url), "..", "..");
const html = readFileSync(join(rot, "src/nav2/utkast.html"), "utf8");

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

const a = html.indexOf("/* kktMd: start");
const b = html.indexOf("/* kktMd: slut */");
if (a < 0 || b < 0) {
  console.log("\x1b[31mkktMd finns inte i utkastet\x1b[0m");
  process.exit(1);
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const kktMd = new Function("esc", `${html.slice(a, b)}; return kktMd;`)(esc);

rubrik("Markdown som Inkios");
ok("fetstil", kktMd("Kunden vill ha **fler bilder**.") === "<p>Kunden vill ha <b>fler bilder</b>.</p>");
ok("kursiv med _ och *", kktMd("_igen_ och *snart*") === "<p><i>igen</i> och <i>snart</i></p>", kktMd("_igen_ och *snart*"));
ok("genomstruket", kktMd("~~gammalt~~ nytt") === "<p><s>gammalt</s> nytt</p>");
ok("ord_med_understreck blir inte kursiv", kktMd("filen hej_och_hå.png") === "<p>filen hej_och_hå.png</p>");
ok("punktlista", kktMd("Att göra:\n- byt bild\n- ring") === "<p>Att göra:</p><ul><li>byt bild</li><li>ring</li></ul>", kktMd("Att göra:\n- byt bild\n- ring"));
ok("numrerad lista", kktMd("1. först\n2. sedan") === "<ol><li>först</li><li>sedan</li></ol>");
ok("radbrytning i ett stycke, tom rad mellan stycken", kktMd("rad ett\nrad två\n\nnytt stycke") === "<p>rad ett<br>rad två</p><p>nytt stycke</p>");
ok("ett datum i början av raden är ingen lista", kktMd("2026-10-27 ringde") === "<p>2026-10-27 ringde</p>");
ok("Markdown-länk", kktMd("[sidan](https://hedbloms.se/a?b=1&c=2)") === '<p><a href="https://hedbloms.se/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">sidan</a></p>', kktMd("[sidan](https://hedbloms.se/a?b=1&c=2)"));
ok("en lös adress blir en länk, utan punkten efter", kktMd("Se https://hedbloms.se/ref.") === '<p>Se <a href="https://hedbloms.se/ref" target="_blank" rel="noopener noreferrer">https://hedbloms.se/ref</a>.</p>', kktMd("Se https://hedbloms.se/ref."));
ok("tom text ger inget", kktMd("") === "" && kktMd(null) === "");

rubrik("Ingen inskjuten kod");
const farliga = [
  "<script>alert(1)</script>",
  '<img src=x onerror="alert(1)">',
  "[klick](javascript:alert(1))",
  "[klick](JaVaScRiPt:alert(1))",
  '[x](https://a.se" onmouseover="alert(1))',
  "https://a.se/\"><script>alert(1)</script>",
  "**<b onclick=alert(1)>fet</b>**",
  "- <svg onload=alert(1)>",
  "\u00000\u0000",
];
for (const t of farliga) {
  const h = kktMd(t);
  const taggar = [...h.matchAll(/<([a-z]+)\b([^>]*)>/gi)];
  const tillatna = taggar.every(([, tagg, attr]) => ["p", "b", "i", "s", "ul", "ol", "li", "br", "a"].includes(tagg.toLowerCase()) && (tagg.toLowerCase() !== "a" ? attr.trim() === "" : /^ href="https?:\/\/[^"]*" target="_blank" rel="noopener noreferrer"$/.test(attr)));
  // Bara de här taggarna, utan attribut, och en länk bara till http(s): allt annat står kvar som text.
  ok(`ofarlig: ${JSON.stringify(t).slice(0, 50)}`, tillatna, h);
}
ok("en adress slutar vid citattecknet", kktMd('se https://a.se"x') === '<p>se <a href="https://a.se" target="_blank" rel="noopener noreferrer">https://a.se</a>&quot;x</p>', kktMd('se https://a.se"x'));
ok("koden syns som text", kktMd("<script>x</script>") === "<p>&lt;script&gt;x&lt;/script&gt;</p>");
ok("apostrof och citattecken escapas", kktMd(`"a" & 'b'`) === "<p>&quot;a&quot; &amp; &#39;b&#39;</p>", kktMd(`"a" & 'b'`));

console.log(fel ? `\n\x1b[31m${fel} fel\x1b[0m` : "\n\x1b[32mAllt grönt\x1b[0m");
process.exit(fel ? 1 : 0);
