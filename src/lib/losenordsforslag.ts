/**
 * "Föreslå ett åt mig" i lösenordsbytet: fyra ord och ett tal, till exempel
 * `Kanel-Fyr-Pumpa-Komet-47`.
 *
 * Ett ord man kan se framför sig går att minnas, och att skriva på en telefon.
 * Det tillfälliga lösenordet (losenord.ts) är byggt för att läsas upp; det här
 * för att behållas. Inga å, ä eller ö: förslaget ska gå att skriva på vilket
 * tangentbord som helst, även en lånad dator.
 *
 * Styrkan: 4 ord ur ORD (se längden nedan) och ett tal 10–99 ger runt 37
 * bitar. Inloggningen är spärrad mot många försök i rad, så det räcker gott
 * mot gissning över nätet. Den som vill ha mer skriver ett längre själv.
 *
 * Ren logik över `crypto.getRandomValues`, utan import, så att provet kan köra
 * den rakt av (tests/inloggning.mjs). Körs i webbläsaren: förslaget lämnar
 * aldrig datorn förrän användaren själv sparar det.
 */

export const ORD = [
  "Alm", "Ankare", "Apelsin", "Ask", "Bambu", "Banan", "Bark", "Bastu", "Berg", "Bild",
  "Bok", "Boll", "Borg", "Bricka", "Bro", "Brons", "Bulle", "Buss", "Citron", "Cykel",
  "Dal", "Dimma", "Drake", "Droppe", "Duva", "Ek", "Eld", "Fackla", "Falk", "Filt",
  "Fikon", "Fiol", "Fjord", "Flagga", "Flod", "Fors", "Frost", "Fyr", "Gaffel", "Gata",
  "Gitarr", "Gran", "Grus", "Guld", "Gurka", "Hamn", "Harpa", "Hav", "Hink", "Hjort",
  "Hjul", "Holme", "Honung", "Humla", "Hummer", "Hund", "Is", "Jade", "Jolle", "Kaffe",
  "Kaka", "Kalv", "Kanel", "Kanot", "Karta", "Katt", "Kabel", "Klocka", "Komet",
  "Kompass", "Koppar", "Korp", "Kotte", "Krabba", "Krok", "Kristall", "Kudde", "Kust", "Kvarn",
  "Kvist", "Kyrka", "Lada", "Lampa", "Lamm", "Lax", "Lera", "Lilja", "Lind", "Ljung",
  "Ljus", "Lykta", "Magnet", "Mandel", "Mango", "Matta", "Melon", "Moln", "Mossa",
  "Motor", "Mus", "Myra", "Nyckel", "Opal", "Ost", "Park", "Penna", "Peppar", "Persika",
  "Piano", "Pixel", "Planet", "Plommon", "Prisma", "Pumpa", "Radar", "Raket", "Regn", "Ren",
  "Rep", "Robot", "Ros", "Rot", "Rubin", "Russin", "Safir", "Saft", "Salt", "Sand",
  "Segel", "Signal", "Sill", "Silver", "Sked", "Skola", "Slott", "Sol", "Sparv", "Spegel",
  "Spiral", "Stare", "Sten", "Stol", "Storm", "Stuga", "Svamp", "Svan", "Sylt", "Tall",
  "Tavla", "Te", "Tenn", "Tomat", "Torg", "Torsk", "Trana", "Trumma", "Tulpan", "Uggla",
  "Val", "Varg", "Vass", "Vik", "Vind", "Vagn", "Bord", "Soffa", "Kopp", "Tallrik",
  "Kniv", "Spade", "Hassel", "Lingon", "Gryta", "Panna", "Kanin", "Ekorre", "Delfin",
  "Pingvin", "Zebra", "Tiger", "Lejon", "Panter", "Kamel", "Papegoja", "Flamingo", "Pelikan", "Struts",
  "Vulkan", "Oas", "Atoll", "Kanjon", "Boj",
];

/** Ett jämnt fördelat heltal i [0, n). Rejektionsurval, inte modulo. */
function slump(n: number): number {
  const tak = Math.floor(0x100000000 / n) * n;
  for (;;) {
    const [v] = crypto.getRandomValues(new Uint32Array(1));
    if (v < tak) return v % n;
  }
}

export function foreslaLosenord(antalOrd = 4): string {
  const ord: string[] = [];
  while (ord.length < antalOrd) {
    const o = ORD[slump(ORD.length)];
    // Samma ord två gånger gör förslaget svagare och ser ut som ett fel.
    if (!ord.includes(o)) ord.push(o);
  }
  return `${ord.join("-")}-${10 + slump(90)}`;
}
