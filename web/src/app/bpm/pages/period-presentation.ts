import { RegisterLine } from '../../core/bpm-models';

/** Repère d'affichage seulement : les montants et leur rattachement viennent des lectures métier. */
export function settlementOutsideWindow(
  line: RegisterLine,
  window: { from: string; to: string } | null | undefined,
): boolean {
  return (
    !!window &&
    !!line.settled &&
    !!line.realizedDate &&
    (line.realizedDate < window.from || line.realizedDate > window.to)
  );
}
