import { RegisterLine } from '../../core/bpm-models';

/** Échéance à relire : retard, aujourd'hui, puis prochaine date. Aucune écriture implicite. */
export function nextOpenLine(lines: readonly RegisterLine[]): RegisterLine | null {
  const order: Record<string, number> = { late: 0, due: 1, pending: 2 };
  return (
    [...lines]
      .filter((line) => !line.special && !line.settled && line.status in order)
      .sort(
        (a, b) =>
          order[a.status] - order[b.status] ||
          a.plannedDate.localeCompare(b.plannedDate) ||
          a.id.localeCompare(b.id),
      )[0] ?? null
  );
}
