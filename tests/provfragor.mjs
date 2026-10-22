#!/usr/bin/env node
/**
 * C6: vad kursredigeraren uppdaterar, lagger till och tar bort nar ett prov
 * sparas. Ingen databas.
 *
 *   node --experimental-strip-types tests/provfragor.mjs
 *
 * `learning_answer`, `team_repetition` och `roleplay_self` kaskaderar pa
 * fragans och kriteriets id. En fraga som skrivs om fran grunden tar alltsa
 * varje saljares repetitionshistorik med sig. Har provas att en fraga som star
 * kvar behaller sitt id, och att bara den som faktiskt tas bort forsvinner.
 */
import { paraIhop, planeraProvfragor } from "../src/lib/provfragor.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

const alt = (...etiketter) => etiketter.map((label, i) => ({ label, ratt: i === 0 }));
const gammal = (id, sort, prompt, ...etiketter) => ({
  id,
  sort,
  prompt,
  alternativ: etiketter.map((label, j) => ({ id: `${id}-${j + 1}`, sort: j + 1, label })),
});
const ny = (prompt, ...etiketter) => ({ prompt, alternativ: alt(...etiketter) });
const ids = (lista) => lista.map((u) => u.id).join(",");

rubrik("En fraga far ny text");
{
  const p = planeraProvfragor(
    [gammal("q1", 1, "Vad ar A?", "a", "b"), gammal("q2", 2, "Vad ar B?", "a", "b"), gammal("q3", 3, "Vad ar C?", "a", "b")],
    [ny("Vad ar A?", "a", "b"), ny("Vad är B?", "a", "b"), ny("Vad ar C?", "a", "b")],
  );
  ok("tre uppdateras", p.uppdatera.length === 3);
  ok("med samma id, i ordning", ids(p.uppdatera) === "q1,q2,q3", ids(p.uppdatera));
  ok("den andra far den nya texten", p.uppdatera[1].prompt === "Vad är B?");
  ok("ingen laggs till, ingen tas bort", p.lagg.length === 0 && p.tabort.length === 0);
  ok("ingen byter plats", p.uppdatera.every((u) => u.sort === u.gammalSort));
}

rubrik("En fraga laggs till sist");
{
  const p = planeraProvfragor(
    [gammal("q1", 1, "A", "x"), gammal("q2", 2, "B", "x")],
    [ny("A", "x"), ny("B", "x"), ny("C", "x", "y")],
  );
  ok("tva uppdateras", p.uppdatera.length === 2 && ids(p.uppdatera) === "q1,q2");
  ok("en laggs till, som nummer tre", p.lagg.length === 1 && p.lagg[0].sort === 3 && p.lagg[0].prompt === "C");
  ok("med sina alternativ", p.lagg[0].alternativ.length === 2 && p.lagg[0].alternativ[0].ratt === true);
  ok("ingen tas bort", p.tabort.length === 0);
}

rubrik("Den sista fragan tas bort");
{
  const p = planeraProvfragor(
    [gammal("q1", 1, "A", "x"), gammal("q2", 2, "B", "x"), gammal("q3", 3, "C", "x")],
    [ny("A", "x"), ny("B", "x")],
  );
  ok("tva uppdateras", p.uppdatera.length === 2 && ids(p.uppdatera) === "q1,q2");
  ok("den tredje tas bort", p.tabort.join() === "q3");
}

// Review Focus 2: bara den borttagna fragans svar far forsvinna. Paras de pa
// position enbart tar fragan efter over den borttagnas id — och svar.
rubrik("En fraga i mitten tas bort");
{
  const p = planeraProvfragor(
    [gammal("q1", 1, "A", "x"), gammal("q2", 2, "B", "x"), gammal("q3", 3, "C", "x")],
    [ny("A", "x"), ny("C", "x")],
  );
  ok("bara den borttagna tas bort", p.tabort.join() === "q2", p.tabort.join());
  ok("C behaller sitt id", p.uppdatera.find((u) => u.prompt === "C")?.id === "q3");
  ok("och flyttar upp till plats tva", p.uppdatera.find((u) => u.id === "q3")?.sort === 2);
  ok("och markeras som flyttad", p.uppdatera.find((u) => u.id === "q3")?.gammalSort === 3);
}

rubrik("En fraga laggs in i mitten");
{
  const p = planeraProvfragor(
    [gammal("q1", 1, "A", "x"), gammal("q2", 2, "B", "x")],
    [ny("A", "x"), ny("Ny", "x"), ny("B", "x")],
  );
  ok("B behaller sitt id pa plats tre", p.uppdatera.find((u) => u.id === "q2")?.sort === 3);
  ok("den nya laggs till pa plats tva", p.lagg.length === 1 && p.lagg[0].sort === 2 && p.lagg[0].prompt === "Ny");
  ok("ingen tas bort", p.tabort.length === 0);
}

rubrik("Ordningen byts");
{
  const p = planeraProvfragor([gammal("q1", 1, "A", "x"), gammal("q2", 2, "B", "x")], [ny("B", "x"), ny("A", "x")]);
  ok("A och B behaller sina id", p.uppdatera.find((u) => u.prompt === "A")?.id === "q1" && p.uppdatera.find((u) => u.prompt === "B")?.id === "q2");
  ok("med bytta platser", p.uppdatera.find((u) => u.id === "q1")?.sort === 2 && p.uppdatera.find((u) => u.id === "q2")?.sort === 1);
}

rubrik("Text andrad och sista borttagen samtidigt");
{
  const p = planeraProvfragor(
    [gammal("q1", 1, "Vad ar A?", "x"), gammal("q2", 2, "Vad galler vid sjukanmalan?", "x"), gammal("q3", 3, "Vad ar C?", "x")],
    [ny("Vad ar A?", "x"), ny("Vad gäller vid sjukanmälan?", "x")],
  );
  ok("den rattade behaller id:t pa sin plats", p.uppdatera.find((u) => u.prompt === "Vad gäller vid sjukanmälan?")?.id === "q2");
  ok("den sista tas bort", p.tabort.join() === "q3");
}

// En ny fraga far aldrig ta over en annan frågas historik for att den rakar
// sta pa en ledig plats. Den kvarvarande paras bara om texten liknar den nya.
rubrik("En ny fraga och en rattad text i samma sparning");
{
  const p = planeraProvfragor(
    [gammal("q1", 1, "Vem ringer du forst?", "x"), gammal("q2", 2, "Vad galler vid sjukanmalan?", "x"), gammal("q3", 3, "Nar skickas avtalet?", "x")],
    [ny("Vem ringer du forst?", "x"), ny("Hur lang ar provanstallningen?", "x"), ny("Vad gäller vid sjukanmälan?", "x"), ny("Nar skickas avtalet?", "x")],
  );
  ok("den nya fragan laggs till, tar inget id", p.lagg.length === 1 && p.lagg[0].prompt === "Hur lang ar provanstallningen?", JSON.stringify(p.lagg.map((l) => l.prompt)));
  ok("den rattade behaller sitt id", p.uppdatera.find((u) => u.prompt === "Vad gäller vid sjukanmälan?")?.id === "q2");
  ok("ingen tas bort", p.tabort.length === 0);
}
rubrik("Den forsta tas bort och den andra rattas");
{
  const p = planeraProvfragor(
    [gammal("q1", 1, "Vem ringer du forst?", "x"), gammal("q2", 2, "Vad galler vid sjukanmalan?", "x"), gammal("q3", 3, "Nar skickas avtalet?", "x")],
    [ny("Vad gäller vid sjukanmälan?", "x"), ny("Nar skickas avtalet?", "x")],
  );
  ok("den rattade behaller sitt id", p.uppdatera.find((u) => u.prompt === "Vad gäller vid sjukanmälan?")?.id === "q2", ids(p.uppdatera));
  ok("bara den forsta tas bort", p.tabort.join() === "q1", p.tabort.join());
}
rubrik("En helt ny text pa samma plats");
{
  const p = planeraProvfragor(
    [gammal("q1", 1, "Vem ringer du forst?", "x"), gammal("q2", 2, "Vad galler vid sjukanmalan?", "x")],
    [ny("Vem ringer du forst?", "x"), ny("Hur lang ar provanstallningen?", "x")],
  );
  ok("ar en ny fraga, inte den gamla med ny text", p.lagg.length === 1 && p.tabort.join() === "q2", JSON.stringify({ lagg: p.lagg.length, tabort: p.tabort }));
}

rubrik("Alternativen");
{
  const [u] = planeraProvfragor([gammal("q1", 1, "A", "ja", "nej", "kanske")], [{ prompt: "A", alternativ: [{ label: "ja", ratt: false }, { label: "nej", ratt: true }] }]).uppdatera;
  ok("alternativ som star kvar behaller sina id", ids(u.alternativ.uppdatera) === "q1-1,q1-2", ids(u.alternativ.uppdatera));
  ok("ett nytt facit foljer med", u.alternativ.uppdatera[1].ratt === true && u.alternativ.uppdatera[0].ratt === false);
  ok("det borttagna tas bort", u.alternativ.tabort.join() === "q1-3");
  const [v] = planeraProvfragor([gammal("q1", 1, "A", "ja")], [ny("A", "ja", "nej")]).uppdatera;
  ok("ett nytt alternativ laggs till pa sin plats", v.alternativ.lagg.length === 1 && v.alternativ.lagg[0].sort === 2 && v.alternativ.lagg[0].label === "nej");
}

rubrik("paraIhop (aven for rollspelets kriterier)");
{
  const p = paraIhop(
    [{ id: "k1", sort: 1, label: "Oppning" }, { id: "k2", sort: 2, label: "Behov" }, { id: "k3", sort: 3, label: "Avslut" }],
    [{ label: "Oppning" }, { label: "Avslut" }],
    (g) => g.label,
    (n) => n.label,
  );
  ok("text forst, position sedan", p.par.map((x) => `${x.gammal.id}:${x.sort}`).join() === "k1:1,k3:2", p.par.map((x) => `${x.gammal.id}:${x.sort}`).join());
  ok("bara det borttagna tas bort", p.tabort.join() === "k2");
  ok("tomt in, tomt ut", paraIhop([], [], String, String).par.length === 0);
  const t = paraIhop([{ id: "a", sort: 1, t: " Hej " }], [{ t: "Hej" }], (g) => g.t, (n) => n.t);
  ok("blanksteg runt texten raknas inte", t.par.length === 1 && t.par[0].gammal.id === "a");
  const luckor = paraIhop([{ id: "a", sort: 1, t: "A" }, { id: "c", sort: 4, t: "C" }], [{ t: "A" }, { t: "C" }, { t: "D" }], (g) => g.t, (n) => n.t);
  ok("luckor i den gamla ordningen sluts", luckor.par.find((x) => x.gammal.id === "c")?.sort === 2 && luckor.lagg[0].sort === 3);
}

console.log(fel === 0 ? "\n\x1b[32mAlla prov gick igenom.\x1b[0m" : `\n\x1b[31m${fel} prov föll.\x1b[0m`);
process.exit(fel === 0 ? 0 : 1);
