import { afterEveryRender, Directive, ElementRef, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';

/** Attend le contenu chargé avant d'ouvrir et d'afficher une section liée du module BPM. */
@Directive({ selector: '[bpmFragmentNavigation]' })
export class BpmFragmentNavigation {
  readonly bpmFragmentReady = input(true);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly route = inject(ActivatedRoute);
  private readonly fragment = toSignal(this.route.fragment, {
    initialValue: this.route.snapshot.fragment,
  });
  private handled: string | null = null;

  constructor() {
    afterEveryRender(() => {
      const fragment = this.fragment();
      if (!fragment) {
        this.handled = null;
        return;
      }
      if (!this.bpmFragmentReady() || fragment === this.handled) return;
      const target = this.host.ownerDocument.getElementById(fragment);
      if (!target || !this.host.contains(target)) return;
      for (
        let node: HTMLElement | null = target;
        node && node !== this.host;
        node = node.parentElement
      ) {
        if (node.tagName === 'DETAILS') (node as HTMLDetailsElement).open = true;
      }
      target.scrollIntoView?.({ block: 'start' });
      this.handled = fragment;
    });
  }
}
