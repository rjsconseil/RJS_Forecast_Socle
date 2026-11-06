// Recette « 30 cas » : joue un ou plusieurs groupes de trois cas dans la base désignée (API arrêtée).
// node api/scripts/recette-30/run.mjs --group N01 [--data api/data/store.json] [--prefix "RECETTE 30"]
// Les profils déjà présents sont conservés tels quels ; une copie de la base est gardée avant écriture.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createSocle } from "../../src/socle/index.mjs";
import { SOCLE_MODULES } from "../../src/modules/index.mjs";
import { runCases, TODAY } from "./engine.mjs";
import { GROUPS as A } from "./n01-n05.mjs";
import { GROUPS as B } from "./n06-n10.mjs";

const GROUPS = { ...A, ...B };
const arg = (k, f) => {
  const i = process.argv.indexOf(`--${k}`);
  return i < 0 ? f : process.argv[i + 1];
};
const dataFile = resolve(arg("data", "api/data/store.json"));
const prefix = arg("prefix", "RECETTE 30");
const groups = arg("group", Object.keys(GROUPS).join(",")).split(",");
const output = resolve(arg("report", `api/data/recettes/recette-30-${groups.join("-")}.json`));
const unknown = groups.filter((g) => !GROUPS[g]);
if (unknown.length) throw new Error(`Groupes inconnus : ${unknown.join(", ")}`);

let socle;
try {
  const original = await readFile(dataFile).catch(() => null);
  if (original) await writeFile(`/tmp/rjs-avant-recette-30-${Date.now()}.json`, original, { flag: "wx" });
  socle = await createSocle({ dataFile, modules: SOCLE_MODULES });
  const sig = (c) => `${c.rule}|${c.description}|${JSON.stringify(c.ids)}`;
  const before = new Set(socle.inspector.checks(socle.state).filter((c) => c.result !== "passed").map(sig));
  const report = await runCases(socle, groups.flatMap((g) => GROUPS[g]), { prefix });
  const after = socle.inspector.checks(socle.state);
  report.integrity = {
    totals: after.reduce((m, c) => ((m[c.result] = (m[c.result] ?? 0) + 1), m), {}),
    new: after.filter((c) => c.result !== "passed" && !before.has(sig(c))),
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  const failed = report.checks.filter((c) => !c.ok);
  const integrity = report.integrity;
  console.log(
    JSON.stringify(
      {
        date: TODAY,
        report: output,
        profiles: report.profiles.map((p) => `${p.case} ${p.id}${p.existing ? " (déjà présent)" : ""}`),
        checks: report.checks.length,
        passed: report.checks.length - failed.length,
        failed,
        integrity: { totals: integrity.totals, new: integrity.new.map((c) => `${c.result} ${c.rule} ${c.description} : ${c.observed}`) },
        notes: report.notes,
      },
      null,
      2,
    ),
  );
  if (failed.length) process.exitCode = 1;
} finally {
  await socle?.close();
}
