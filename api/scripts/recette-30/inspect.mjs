// Lecture rapide des volets de la gestion du projet de vie, cycle par cycle, pour les profils d'un rapport de recette.
// node api/scripts/recette-30/inspect.mjs api/data/recettes/recette-30-N02.json [http://localhost:3410]
import { readFile } from "node:fs/promises";

const [file, base = "http://localhost:3410"] = process.argv.slice(2);
const report = JSON.parse(await readFile(file, "utf8"));
const get = async (userId, path) => {
  const r = await fetch(base + path, { headers: { "x-user-id": userId } });
  return r.json();
};
for (const p of report.profiles) {
  console.log(`\n=== ${p.case} · ${p.label}`);
  const periods = (await get(p.id, "/api/bpm/periods?limit=6")).periods.map((x) => x.key).reverse();
  for (const key of periods) {
    const d = await get(p.id, `/api/bpm/life-management?period=${key}`);
    const line = (b) => `${b.key ?? ""}:${b.health}${b.alert ? ` « ${b.alert} »` : ""}`;
    console.log(`  ${key} ${d.cycle.label}`);
    for (const b of [d.cycle, d.natures.indispensable, d.natures.courante, d.projects, d.results, d.patrimoine]) console.log(`    ${line(b)}`);
  }
}
