import { DestroyRef, inject, Injectable, isSignal, WritableSignal } from '@angular/core';
import { RecetteContext } from '../../core/api.service';

export interface DraftHandle {
  restored: boolean;
  save(): void;
  clear(): void;
  detach(): void;
}

/** Brouillons de présentation par utilisateur : aucune écriture métier, aucun mélange de profils. */
@Injectable({ providedIn: 'root' })
export class BpmDrafts {
  private user = inject(RecetteContext).userId;
  private memory = new Map<string, unknown>();

  fields(
    scope: string,
    target: object,
    fields: readonly string[],
    destroy: DestroyRef,
  ): DraftHandle {
    const host = target as Record<string, unknown>;
    return this.connect(
      scope,
      () =>
        Object.fromEntries(
          fields.map((key) => [
            key,
            isSignal(host[key]) ? (host[key] as () => unknown)() : host[key],
          ]),
        ),
      (values) => {
        for (const key of fields)
          if (key in values) {
            if (isSignal(host[key])) (host[key] as WritableSignal<unknown>).set(values[key]);
            else host[key] = values[key];
          }
      },
      destroy,
    );
  }

  connect<T extends object>(
    scope: string,
    read: () => T,
    restore: (value: T) => void,
    destroy: DestroyRef,
  ): DraftHandle {
    if (destroy.destroyed) return { restored: false, save() {}, clear() {}, detach() {} };
    const owner = this.user();
    if (!owner) return { restored: false, save() {}, clear() {}, detach() {} };
    const key = `bpm-form:${owner ?? 'anonymous'}:${scope}`;
    let active = true;
    let stored = this.memory.get(key) as T | undefined;
    try {
      stored ??= JSON.parse(sessionStorage.getItem(key) ?? 'null') ?? undefined;
    } catch {
      /* mémoire seule */
    }
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) restore(stored);
    const handle: DraftHandle = {
      restored: !!stored,
      save: () => {
        if (!active || this.user() !== owner) return;
        const value = read();
        this.memory.set(key, structuredClone(value));
        try {
          sessionStorage.setItem(key, JSON.stringify(value));
        } catch {
          /* mémoire seule */
        }
      },
      clear: () => {
        active = false;
        this.memory.delete(key);
        try {
          sessionStorage.removeItem(key);
        } catch {
          /* mémoire seule */
        }
      },
      detach: () => { handle.save(); active = false; },
    };
    destroy.onDestroy(() => handle.save());
    return handle;
  }
}
