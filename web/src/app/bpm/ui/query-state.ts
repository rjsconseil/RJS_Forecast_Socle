import { effect, inject, signal, Signal } from '@angular/core';
import { BpmPageContext } from './page-context';

/** Même contrat qu'un signal de formulaire, avec l'URL comme source pour les retours et reprises. */
export function bpmQueryState<T = string>(
  name: string,
  fallback: T,
  options: {
    parse?: (value: string) => T;
    format?: (value: T) => string;
    replace?: boolean;
    context?: BpmPageContext;
  } = {},
): Signal<T> & { set(value: T): void; update(change: (value: T) => T): void; sync(): void } {
  const context = options.context ?? inject(BpmPageContext);
  const parse = (raw: string | null): T =>
    raw === null ? fallback : options.parse ? options.parse(raw) : (raw as T);
  const value = signal(parse(context.query().get(name)));
  effect(() => value.set(parse(context.query().get(name))));
  const set = (next: T) => {
    value.set(next);
    void context.setQuery(
      { [name]: next === fallback ? null : options.format ? options.format(next) : String(next) },
      { replace: options.replace },
    );
  };
  return Object.assign(value.asReadonly(), {
    set,
    sync: () => value.set(parse(context.query().get(name))),
    update: (change: (value: T) => T) => set(change(value())),
  });
}
