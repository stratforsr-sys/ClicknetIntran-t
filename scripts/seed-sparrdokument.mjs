/**
 * Lagger in utkasten till K12 och K14 i rutinbiblioteket.
 *
 *   node --env-file=$HOME/.clicknet/nav.env scripts/seed-sparrdokument.mjs
 *
 * Bada skapas som UTKAST. Skriptet publicerar ingenting och satter inget
 * beslutsdatum — det ar arbetsgivarens beslut, och spa­rren i databasen slapper
 * inte igenom nagot annat anda.
 *
 * Kors skriptet igen ror det inte dokument som redan finns. Texten redigeras i
 * navet efter forsta korningen, inte har.
 */
import { readFile } from "node:fs/promises";
import pg from "pg";

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const { rows: agare } = await c.query(`
  select e.id, e.first_name, e.last_name
    from employee e
    join employee_role r on r.employee_id = e.id
   where r.role in ('sales_manager','ceo') and e.status <> 'offboarded'
   order by case r.role when 'ceo' then 0 else 1 end
   limit 1
`);

if (agare.length === 0) {
  console.error("Ingen sa­ljchef eller VD finns upplagd. Dokumenten behover en agare (AC-5.1).");
  process.exit(1);
}

const owner = agare[0];
const omEttAr = new Date();
omEttAr.setFullYear(omEttAr.getFullYear() + 1);

const dokument = [
  {
    slug: "k12-intresseavvagning-arbetstid",
    title: "Intresseavvägning — registrering av arbetstid",
    fil: "docs/K12_INTRESSEAVVAGNING_UTKAST.md",
    doc_type: "interest_assessment",
    requires_ack: false,
    category_path: "HR/Dataskydd",
    // Avvagningen ar arbetsgivarens dokument, inte personalens lasning.
    audience_roles: ["sales_manager", "ceo", "admin"],
  },
  {
    slug: "k14-information-arbetstid",
    title: "Så registreras din arbetstid",
    fil: "docs/K14_INFORMATION_TILL_PERSONAL_UTKAST.md",
    doc_type: "staff_information",
    requires_ack: true,
    category_path: "HR/Arbetstid",
    audience_roles: [], // tom = alla
  },
];

for (const d of dokument) {
  const { rows: fanns } = await c.query("select id, status from document where slug = $1", [d.slug]);
  if (fanns.length > 0) {
    console.log(`  hoppar over ${d.slug} — finns redan (${fanns[0].status})`);
    continue;
  }

  const body = await readFile(d.fil, "utf8");

  const { rows } = await c.query(
    `insert into document
       (title, slug, category_path, body_md, owner_id, review_due, status,
        doc_type, requires_ack, audience_roles, created_by)
     values ($1,$2,$3,$4,$5::uuid,$6,'draft',$7,$8,$9,$5::uuid)
     returning id`,
    [
      d.title,
      d.slug,
      d.category_path,
      body,
      owner.id,
      omEttAr.toISOString().slice(0, 10),
      d.doc_type,
      d.requires_ack,
      d.audience_roles,
    ],
  );

  await c.query(
    `insert into document_version (document_id, version, title, body_md, changed_by)
     values ($1::uuid, 1, $2, $3, $4::uuid)`,
    [rows[0].id, d.title, body, owner.id],
  );

  console.log(`  skapade ${d.slug} som utkast — agare ${owner.first_name} ${owner.last_name}`);
}

await c.end();
console.log("\nKlart. Redigera, satt beslutsdatum och publicera i navet under Rutiner.");
