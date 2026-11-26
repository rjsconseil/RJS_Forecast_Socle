import { describe, expect, it } from 'vitest';
import { BPM_RETIRED_VERBS, BPM_VERBS } from './lexicon';

// Le contrôle des libellés dans les sources est fait côté API (api/test/bpm-lexicon.test.mjs).
describe('lexique des actions de BPM (docs/LORE-BPM.md)', () => {
  it('chaque verbe écarté renvoie à un verbe du lexique', () => {
    for (const target of Object.values(BPM_RETIRED_VERBS)) {
      for (const verb of target.split(' ou ').map((part) => part.split(' ')[0])) expect(BPM_VERBS as readonly string[], target).toContain(verb);
    }
  });
});
