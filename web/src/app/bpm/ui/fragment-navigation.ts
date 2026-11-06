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
      this.settle(target);
    });
  }

  /**
   * Le contenu chargé au-dessus de la section (volets, tableaux) peut la repousser après le premier défilement :
   * la section est remise en vue tant que la page se stabilise, sauf si l'utilisateur fait défiler lui-même.
   */
  private settle(target: HTMLElement) {
    const win = this.host.ownerDocument.defaultView;
    if (!win) return;
    let userMoved = false;
    const stop = () => (userMoved = true);
    const events = ['wheel', 'touchstart', 'keydown', 'mousedown'] as const;
    for (const e of events) win.addEventListener(e, stop, { once: true, passive: true });
    const first = target.getBoundingClientRect().top;
    for (const delay of [250, 700, 1500]) {
      win.setTimeout(() => {
        if (userMoved || !target.isConnected) return;
        if (Math.abs(target.getBoundingClientRect().top - first) > 40) target.scrollIntoView?.({ block: 'start' });
      }, delay);
    }
    win.setTimeout(() => events.forEach((e) => win.removeEventListener(e, stop)), 1600);
  }
}
