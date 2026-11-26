import { TestBed } from '@angular/core/testing';
import { describe, it, expect } from 'vitest';
import { NavigationLivePreview } from './navigation-live-preview';
describe('simulation statique', () => {
  it('attend Simuler et conserve le rendu jusqu’à la prochaine simulation', async () => {
    TestBed.configureTestingModule({ imports: [NavigationLivePreview] });
    const fixture = TestBed.createComponent(NavigationLivePreview);
    fixture.componentRef.setInput('configuration', { version: 1, scopes: {} });
    fixture.componentRef.setInput('pages', []);
    const preview = fixture.componentInstance;
    expect(preview.document()).toBe('');
    await preview.simulate();
    const previous = preview.document();
    fixture.componentRef.setInput('configuration', {
      version: 1,
      scopes: { 'module:bpm-astra': { labels: { '/bpm-astra/mouvements': 'Nouvelle vision' } } },
    });
    expect(preview.document()).toBe(previous);
    await preview.simulate();
    expect(preview.document()).not.toBe(previous);
  });
});

it('intègre les polices pour les charger dans le document statique isolé', async () => {
  const { previewFonts } = await import('./navigation-preview-fonts');
  const { vi } = await import('vitest');
  // jsdom omet le descripteur src des règles @font-face lors de leur sérialisation.
  const sheets = vi.spyOn(document, 'styleSheets', 'get').mockReturnValue([
    { href: null, cssRules: [{ type: 5, cssText: '@font-face { font-family: TestPreview; src: url("/preview-font-test.woff2"); }' }] },
  ] as unknown as StyleSheetList);
  const fetchFont = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
  try {
    const css = await previewFonts(document);
    expect(css).toContain('data:font/woff2;base64,AQID');
    expect(fetchFont).toHaveBeenCalledWith(
      new URL('/preview-font-test.woff2', document.baseURI).href,
    );
  } finally {
    sheets.mockRestore();
    fetchFont.mockRestore();
  }
});
