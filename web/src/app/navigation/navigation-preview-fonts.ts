/** Les polices sont intégrées au document statique : son origine isolée ne partage pas celle du site. */
const fonts = new Map<string, Promise<string>>();

async function fontData(url: string): Promise<string> {
  let pending = fonts.get(url);
  if (!pending) {
    pending = fetch(url).then(async (response) => {
      if (!response.ok) throw new Error('Police indisponible pour la simulation.');
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return 'data:font/woff2;base64,' + btoa(binary);
    });
    fonts.set(url, pending);
    pending.catch(() => fonts.delete(url));
  }
  return pending;
}

export async function previewFonts(document: Document): Promise<string> {
  const rules: { css: string; base: string }[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    if (sheet.href && new URL(sheet.href).origin !== document.location.origin) continue;
    for (const rule of Array.from(sheet.cssRules)) {
      if (rule.type === 5) rules.push({ css: rule.cssText, base: sheet.href ?? document.baseURI });
    }
  }
  const embedded = await Promise.all(
    rules.map(async ({ css, base }) => {
      const references = [...css.matchAll(/url\(["']?([^"'\s)]+)["']?\)/g)];
      for (const reference of references) {
        const url = new URL(reference[1], base);
        if (url.origin !== document.location.origin) continue;
        css = css.replace(reference[0], 'url("' + (await fontData(url.href)) + '")');
      }
      return css;
    }),
  );
  return embedded.join('\n');
}
