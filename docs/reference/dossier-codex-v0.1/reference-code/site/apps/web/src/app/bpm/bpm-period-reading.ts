import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { BpmProject, BpmWorkspace } from './bpm.model';
import { pageText } from '../shared/page-text';
import { BpmStore } from './bpm.store';

/** Une fenêtre de lecture indépendante du magasin courant et des écritures métier. */
@Injectable()
export class BpmPeriodReading {
  private readonly http = inject(HttpClient);
  private readonly store = inject(BpmStore);
  private readonly params = toSignal(inject(ActivatedRoute).queryParamMap);
  private readonly result = signal<{ date: string; workspace: BpmWorkspace } | null>(null);
  readonly date = computed(() => this.params()?.get('lecture') ?? '');
  readonly loading = signal(false);
  readonly error = signal('');
  private ticket = 0;
  constructor() {
    effect(() => {
      const date = this.date();
      const workspace = this.store.workspace();
      const ticket = ++this.ticket;
      untracked(() => {
        this.result.set(null);
        this.error.set('');
        this.loading.set(!!date && !!workspace);
        if (!date || !workspace) return;
        void firstValueFrom(this.http.get<BpmWorkspace>('/api/bpm/workspace', { params: { lecture: date } }))
          .then(value => { if (ticket === this.ticket) this.result.set({date, workspace: value}); })
          .catch(() => { if (ticket === this.ticket) this.error.set(pageText('content.pages.bpm.bpm-period-nav.component.error')); })
          .finally(() => { if (ticket === this.ticket) this.loading.set(false); });
      });
    });
  }
  project(source: BpmProject | null): BpmProject | null {
    const result = this.result();
    const read = result?.date === this.date() ? result.workspace.projects.find(p => p.id === source?.id) : null;
    return source && read ? {...source, snapshot: read.snapshot} : source;
  }
}
