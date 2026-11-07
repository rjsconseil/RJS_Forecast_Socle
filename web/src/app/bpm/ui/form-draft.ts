import { afterEveryRender, DestroyRef, Directive, ElementRef, inject, input } from '@angular/core';
import { BpmDrafts, DraftHandle } from './drafts';

/** Brouillon des petits formulaires natifs : même reprise que les éditeurs, par profil et objet. */
@Directive({
  selector: 'form[bpmFormDraft]',
  exportAs: 'bpmFormDraft',
  host: { '(input)': 'save()', '(change)': 'save()' },
})
export class BpmFormDraft {
  readonly bpmFormDraft = input.required<string>();
  private readonly element = inject<ElementRef<HTMLFormElement>>(ElementRef).nativeElement;
  private readonly drafts = inject(BpmDrafts);
  private readonly destroy = inject(DestroyRef);
  private key: string | null = null;
  private draft?: DraftHandle;
  private fields() {
    return [...this.element.elements].filter((e): e is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement =>
      ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.tagName) && !!e.getAttribute('name') && !['file', 'submit', 'button', 'hidden'].includes((e as HTMLInputElement).type));
  }
  constructor() {
    afterEveryRender(() => {
      const key = this.bpmFormDraft();
      if (key === this.key) return;
      this.draft?.detach();
      this.key = key;
      this.draft = this.drafts.connect(`form:${key}`, () => Object.fromEntries(this.fields().map(e =>
        [e.name, e instanceof HTMLInputElement && ['checkbox', 'radio'].includes(e.type) ? e.checked : e.value])), values => {
        for (const e of this.fields()) if (e.name in values) {
          if (typeof values[e.name] === 'boolean' && e instanceof HTMLInputElement) e.checked = values[e.name] as boolean;
          else e.value = String(values[e.name]);
          e.dispatchEvent(new Event('input', { bubbles: true }));
          e.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, this.destroy);
    });
    this.destroy.onDestroy(() => this.draft?.detach());
  }
  save() { this.draft?.save(); }
  clear() { this.draft?.clear(); }
}
