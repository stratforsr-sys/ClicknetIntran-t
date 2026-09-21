#!/usr/bin/env node
/**
 * Provar R2 skarpt, innan ett enda samtal beror av den.
 *
 * ===========================================================================
 * VARFOR DET HAR PROVET FINNS
 *
 * `tests/lagring.mjs` provar VALET mellan lagringarna — ren logik, inga
 * anrop. Det som inte gar att prova dar ar om nycklarna, endpointen och
 * bucketen faktiskt hanger ihop, och det ar precis det som gar sonder: en
 * endpoint utan jurisdiktionsdel, en token med bara lasratt, ett bucketnamn
 * som stavats om.
 *
 * Och felet ar dyrt just har. Vaxelns adress till ljudet lever en halvtimme;
 * en uppladdning som nekas betyder att INSPELNINGEN ar borta, inte att den
 * kommer fram senare. Darfor provas hela kedjan — lagg upp, signera, hamta
 * hem, jamfor byte for byte, ta bort — mot en egen provfil innan navet slas pa.
 *
 * Provfilen heter `prov/` och inte `call_recording/` med flit. Gallringen
 * letar bara i `call_recording`, och en kvarglomd provfil ska inte se ut som
 * ett samtal.
 *
 *   set -a; . ~/.clicknet/nav.env; set +a
 *   node scripts/prova-r2.mjs
 */
import { randomUUID, createHash } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const KRAVS = ["R2_ENDPOINT", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"];

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(
    `  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`,
  );
  if (!villkor) fel++;
};

const saknas = KRAVS.filter((n) => !process.env[n]?.trim());
if (saknas.length) {
  console.error(`\nSaknar ${saknas.join(", ")}.\n`);
  console.error("Kor:  set -a; . ~/.clicknet/nav.env; set +a\n");
  process.exit(2);
}

const bucket = process.env.R2_BUCKET.trim();
const klient = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT.trim(),
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID.trim(),
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY.trim(),
  },
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

// Nagra hundra kilobyte, inte nagra byte. En tom fil gar igenom pa stallen dar
// en riktig inspelning inte gor det.
const innehall = Buffer.alloc(300 * 1024);
for (let i = 0; i < innehall.length; i++) innehall[i] = (i * 31 + 7) % 256;
const summa = createHash("sha256").update(innehall).digest("hex");
const nyckel = `prov/${randomUUID()}`;

console.log(`\nR2: ${process.env.R2_ENDPOINT.trim()}`);
console.log(`Bucket: ${bucket}`);
console.log(`Provfil: ${nyckel}  (${innehall.length} byte)\n`);

let uppladdad = false;

try {
  console.log("1. Lagga upp");
  await klient.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: nyckel,
      Body: innehall,
      ContentType: "audio/mpeg",
    }),
  );
  uppladdad = true;
  ok("PutObject gick igenom", true);

  console.log("\n2. Signera en lank");
  const url = await getSignedUrl(klient, new GetObjectCommand({ Bucket: bucket, Key: nyckel }), {
    expiresIn: 300,
  });
  ok("getSignedUrl gav en https-adress", url.startsWith("https://"));
  ok("lanken ar signerad", url.includes("X-Amz-Signature="));

  console.log("\n3. Hamta hem den igen — som webblasaren skulle");
  const svar = await fetch(url);
  ok(`GET svarade 200`, svar.status === 200, `fick ${svar.status}`);
  const hem = Buffer.from(await svar.arrayBuffer());
  ok("samma antal byte", hem.length === innehall.length, `${hem.length} mot ${innehall.length}`);
  ok(
    "samma innehall (sha256)",
    createHash("sha256").update(hem).digest("hex") === summa,
  );
  ok(
    "content-type folde med",
    (svar.headers.get("content-type") ?? "").startsWith("audio/"),
    svar.headers.get("content-type") ?? "(inget)",
  );

  // Spelaren hamtar ett langt samtal i bitar. Kan lagringen inte svara pa en
  // Range-begaran slutar spelaren fungera mitt i, utan felmeddelande.
  console.log("\n4. Range — det spelaren gor i ett langt samtal");
  const del = await fetch(url, { headers: { Range: "bytes=1000-1999" } });
  ok("206 Partial Content", del.status === 206, `fick ${del.status}`);
  const bit = Buffer.from(await del.arrayBuffer());
  ok("ratt lang bit", bit.length === 1000, `${bit.length} byte`);
  ok("ratt bit", bit.equals(innehall.subarray(1000, 2000)));
} catch (e) {
  ok("kedjan gick igenom", false, e instanceof Error ? e.message : String(e));
} finally {
  if (uppladdad) {
    console.log("\n5. Stada undan");
    try {
      await klient.send(new DeleteObjectCommand({ Bucket: bucket, Key: nyckel }));
      ok("DeleteObject gick igenom", true);
      const borta = await fetch(
        await getSignedUrl(klient, new GetObjectCommand({ Bucket: bucket, Key: nyckel }), {
          expiresIn: 60,
        }),
      );
      ok("filen ar verkligen borta", borta.status === 404, `fick ${borta.status}`);
    } catch (e) {
      ok("stadningen gick igenom", false, e instanceof Error ? e.message : String(e));
    }
  }
}

console.log(
  fel
    ? `\n\x1b[31m${fel} fel — sla INTE pa R2 i navet an\x1b[0m\n`
    : "\n\x1b[32mAllt gront — kedjan bar\x1b[0m\n",
);
process.exit(fel ? 1 : 0);
