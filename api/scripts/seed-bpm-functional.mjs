// API arrêtée : ajoute les cas à la base existante et garde les autres profils intacts.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createSocle } from "../src/socle/index.mjs";
import { SOCLE_MODULES } from "../src/modules/index.mjs";
import { runBpmFunctionalScenarios } from "./bpm-functional-scenarios.mjs";

const arg = (key, fallback) => {
  const i = process.argv.indexOf(`--${key}`);
  return i < 0 ? fallback : process.argv[i + 1];
};
const dataFile = resolve(arg("data", "api/data/store.json"));
const until = arg("until", "2026-11-06");
if (until !== "2026-11-06")
  throw new Error(
    "Cette recette documente les cycles d’août 2026 à février 2027, avec une date de référence au 6 novembre 2026.",
  );
const prefix = arg("prefix", "RECETTE BPM");
const suffix =
  prefix === "RECETTE BPM" ? "" : "-" + Buffer.from(prefix).toString("hex");
const output = resolve(
  arg("report", `api/data/recettes/bpm-functional-${until}${suffix}.json`),
);
if (output === dataFile)
  throw new Error(
    "Le rapport doit être un fichier différent de la base du site.",
  );
let socle;
try {
  const original = await readFile(dataFile).catch((e) => {
    if (e.code !== "ENOENT") throw e;
    return null;
  });
  socle = await createSocle({ dataFile, modules: SOCLE_MODULES });
  const backup = `/tmp/rjs-bpm-avant-recette-${Date.now()}.json`;
  if (original) await writeFile(backup, original, { flag: "wx" });
  const report = await runBpmFunctionalScenarios(socle, { until, prefix });
  // Un second lancement garde les profils et les résultats de la première recette.
  if (report.profiles.every((u) => u.existing)) {
    const previous = await readFile(output, "utf8")
      .then(JSON.parse)
      .catch((e) => {
        if (e.code !== "ENOENT") throw e;
        return null;
      });
    const sameProfiles =
      previous?.date === until &&
      previous.profiles?.length === report.profiles.length &&
      report.profiles.every((u) =>
        previous.profiles.some((p) => p.id === u.id),
      );
    if (sameProfiles) {
      console.log(
        JSON.stringify(
          {
            report: output,
            preserved: true,
            profiles: report.profiles.length,
            passed: previous.checks.filter((c) => c.ok).length,
          },
          null,
          2,
        ),
      );
      if (!previous.ok) process.exitCode = 1;
    } else {
      console.log(
        JSON.stringify(
          {
            profiles: report.profiles,
            note: "Profils déjà présents ; aucune donnée modifiée. Utiliser un autre préfixe pour une nouvelle recette.",
          },
          null,
          2,
        ),
      );
      process.exitCode = 1;
    }
  } else {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2) + "\n");
    console.log(
      JSON.stringify(
        {
          backup,
          report: output,
          profiles: report.profiles.map((u) => ({
            id: u.id,
            label: u.label,
            projects: u.projects.length,
            existing: u.existing ?? false,
          })),
          checks: report.checks.length,
          passed: report.checks.filter((c) => c.ok).length,
          errors: report.checks.filter((c) => !c.ok),
        },
        null,
        2,
      ),
    );
    if (!report.ok) process.exitCode = 1;
  }
} finally {
  await socle?.close();
}
