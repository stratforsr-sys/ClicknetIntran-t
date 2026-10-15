/**
 * Nav 2.0 (0095): rutinens innehåll i `document.body_md`, med en fast form.
 *
 * Innehållet — när, vem, hur lång tid, sammanfattningen, stegen, "klart när"
 * och "om det går fel" — ligger i brödtexten och inte i egna kolumner. Då
 * följer det med i versionerna (`document_version` sparar rubrik och
 * brödtext), i fritextsökningen och på repots egen rutinsida, som visar samma
 * text som markdown.
 *
 * Formen:
 *
 *   Sammanfattningen, ett stycke.
 *
 *   - **När:** …
 *   - **Tar:** …
 *   - **Vem:** …
 *
 *   ## Gör så här
 *   1. **Rubrik.** Förklaring
 *
 *   ## Klart när
 *   - …
 *
 *   ## Om det går fel
 *   - **Problemet.** Gör så här
 *
 * En text som inte har formen (en rutin skriven i repots redaktör) läses inte
 * om: den visas som den är, i `md`, och ingenting i den går förlorat.
 */

export type Rutinfalt = {
  tldr: string;
  nar: string;
  tid: string;
  vem: string;
  steg: [string, string][];
  klart: string[];
  fel: [string, string][];
};

const META: [keyof Pick<Rutinfalt, "nar" | "tid" | "vem">, string][] = [
  ["nar", "När"],
  ["tid", "Tar"],
  ["vem", "Vem"],
];

const rad = (s: string) => s.replace(/\s*\n\s*/g, " ").trim();

export function tillMarkdown(f: Rutinfalt): string {
  const delar: string[] = [];
  if (rad(f.tldr)) delar.push(rad(f.tldr));
  const meta = META.filter(([k]) => rad(f[k])).map(([k, l]) => `- **${l}:** ${rad(f[k])}`);
  if (meta.length) delar.push(meta.join("\n"));
  const steg = f.steg.filter(([r]) => rad(r));
  if (steg.length) delar.push(["## Gör så här", ...steg.map(([r, t], i) => `${i + 1}. **${rad(r).replace(/\.$/, "")}.**${rad(t) ? ` ${rad(t)}` : ""}`)].join("\n"));
  const klart = f.klart.map(rad).filter(Boolean);
  if (klart.length) delar.push(["## Klart när", ...klart.map((k) => `- ${k}`)].join("\n"));
  const fel = f.fel.filter(([p]) => rad(p));
  if (fel.length) delar.push(["## Om det går fel", ...fel.map(([p, g]) => `- **${rad(p).replace(/\.$/, "")}.**${rad(g) ? ` ${rad(g)}` : ""}`)].join("\n"));
  return delar.join("\n\n") + "\n";
}

/** Rubrik och förklaring ur "**Rubrik.** Förklaring". */
function par(s: string): [string, string] {
  const m = s.match(/^\*\*(.+?)\.?\*\*\s*(.*)$/);
  return m ? [m[1].trim(), m[2].trim()] : [s.trim(), ""];
}

/**
 * Tillbaka till fälten. `form` är sann bara när texten har formen ovan; annars
 * är fälten tomma utom sammanfattningen (första stycket), och hela texten
 * ligger i `md`.
 */
export function franMarkdown(md: string): Rutinfalt & { form: boolean; md: string } {
  const text = (md ?? "").replace(/\r\n/g, "\n").trim();
  const tom: Rutinfalt = { tldr: "", nar: "", tid: "", vem: "", steg: [], klart: [], fel: [] };
  const block = text.split(/\n(?=## )/);
  const forst = block[0].startsWith("## ") ? "" : block[0];
  const sektioner = new Map<string, string[]>();
  for (const b of block.slice(forst ? 1 : 0)) {
    const [rubrik, ...rader] = b.split("\n");
    sektioner.set(rubrik.replace(/^##\s*/, "").trim().toLowerCase(), rader.map((r) => r.trim()).filter(Boolean));
  }
  const kanda = ["gör så här", "klart när", "om det går fel"];
  const form = sektioner.size > 0 && [...sektioner.keys()].every((k) => kanda.includes(k)) && !/^#\s/m.test(text);
  const stycken = forst.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  const forstaStycke = stycken.find((s) => !s.startsWith("#") && !s.startsWith("-") && !/^\d+\./.test(s)) ?? "";
  if (!form) {
    // Utan formen: första stycket i hela texten som inte är en rubrik eller en lista.
    const alla = text.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
    const sam = alla.find((s) => !s.startsWith("#") && !s.startsWith("-") && !/^\d+\./.test(s)) ?? "";
    return { ...tom, tldr: rad(sam).replace(/[*_`]/g, "").slice(0, 400), form: false, md: text };
  }

  const f: Rutinfalt = { ...tom, tldr: rad(forstaStycke) };
  for (const s of stycken) {
    for (const r of s.split("\n")) {
      const m = r.match(/^-\s*\*\*(När|Tar|Vem):\*\*\s*(.*)$/);
      if (m) f[META.find(([, l]) => l === m[1])![0]] = m[2].trim();
    }
  }
  f.steg = (sektioner.get("gör så här") ?? []).filter((r) => /^\d+\.\s/.test(r)).map((r) => par(r.replace(/^\d+\.\s*/, "")));
  f.klart = (sektioner.get("klart när") ?? []).filter((r) => r.startsWith("- ")).map((r) => r.slice(2).trim());
  f.fel = (sektioner.get("om det går fel") ?? []).filter((r) => r.startsWith("- ")).map((r) => par(r.slice(2)));
  return { ...f, form: true, md: "" };
}
