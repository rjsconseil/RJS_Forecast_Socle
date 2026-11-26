// Écritures de la fiche projet : relecture après chaque écriture, et les deux refus que la fiche sait reprendre
// (part de tâche insuffisante, dépassement de l'enveloppe à autoriser par le budget de vie).
import { signal } from '@angular/core';
import { toApiError } from '../../core/api.service';
import { OverrunRefusal, ProjectOverrun } from '../data/bpm-projects.models';
import { FUNDING_RESULTS, ProjectFunding } from '../ui/project-funding';

/** Action refusée faute de budget, en attente de la décision du budget de vie. */
export const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * Écriture de la page. `fund` : rejouée après un refus de financement, elle demande au middleware Budget d'accorder
 * dans la même écriture la part et le dépassement nécessaires (règlement financé, part avec dépassement autorisé).
 */
export type Write<T> = (fund?: boolean) => Promise<T>;

/** Règlement refusé faute de part suffisante (projet en mode strict) : la part est accordée avec le règlement. */
export interface ShareFlow {
  gap: {
    budgetId: string;
    taskId: string;
    taskTitle: string;
    shareCents: number | null;
    neededCents: number;
    availableCents: number;
    grantOverrunCents: number;
  };
  message: string;
  label: string;
  retry: Write<unknown>;
}

export interface OverrunFlow {
  refusal: OverrunRefusal;
  message: string;
  label: string;
  retry: Write<unknown>;
  request: ProjectOverrun | null;
}

export interface ProjectWriteHost {
  /** Relit la fiche. */
  load(): Promise<unknown>;
  /** Amène un contrôle de la fiche à l'écran et lui donne le focus. */
  reveal(id: string): void;
  funding: ProjectFunding;
}

export class ProjectWriteFlow {
  readonly busy = signal(false);
  readonly notice = signal<{ text: string; error: boolean } | null>(null);
  readonly flow = signal<OverrunFlow | null>(null);
  readonly shareFlow = signal<ShareFlow | null>(null);

  constructor(private host: ProjectWriteHost) {}

  private load() { return this.host.load(); }
  private revealControl(id: string) { this.host.reveal(id); }
  private get funding() { return this.host.funding; }

  /**
   * Écriture avec relecture. Un refus « autorisation de dépassement requise » ouvre la demande au budget de vie ;
   * une fois le dépassement autorisé, la même écriture est rejouée.
   */
  async run<T>(action: Write<T>, success: string | ((result: T) => string), label = '') {
    if (this.busy()) return false;
    this.busy.set(true);
    this.notice.set(null);
    try {
      const result = await action();
      this.flow.set(null);
      this.shareFlow.set(null);
      await this.load();
      this.notice.set({
        text: typeof success === 'function' ? success(result) : success,
        error: false,
      });
      return true;
    } catch (err) {
      const e = toApiError(err);
      const gap = e.body.details as unknown as (ShareFlow['gap'] & { reason?: string }) | undefined;
      if (e.body.code === 'FORBIDDEN_BY_RULE' && gap?.reason === 'task-share' && label) {
        this.shareFlow.set({ gap, message: e.message, label, retry: action });
        this.revealControl('project-share-flow');
        return false;
      }
      if (e.body.code === 'OVERRUN_AUTHORIZATION_REQUIRED') {
        this.flow.set({
          refusal: e.body.details as unknown as OverrunRefusal,
          message: e.message,
          label,
          retry: action,
          request: null,
        });
        this.revealControl('project-overrun-flow');
        return false;
      }
      await this.load();
      this.notice.set({
        text: e.isConflict
          ? 'Conflit : la donnée a changé ailleurs. La fiche a été relue ; recommencez si besoin.'
          : e.message,
        error: true,
      });
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  /** Rejoue l'écriture refusée en la finançant : la part (et son dépassement éventuel) est accordée dans la même écriture. */
  grantShareFlow() {
    const sf = this.shareFlow();
    if (!sf) return;
    this.shareFlow.set(null);
    const granted = FUNDING_RESULTS.granted(
      sf.gap.taskTitle,
      sf.gap.neededCents,
      sf.gap.grantOverrunCents,
    );
    return this.run(
      () => sf.retry(true),
      `${granted} ${capitalize(sf.label)} est enregistré.`,
      sf.label,
    );
  }

  /** Geste nominal : vous pilotez aussi le projet de vie, l'écriture refusée est rejouée avec son dépassement autorisé. */
  authorizeFlow() {
    const f = this.flow();
    if (!f) return;
    return this.run(
      () => f.retry(true),
      `${FUNDING_RESULTS.approved} ${capitalize(f.label || 'l’écriture')} est enregistrée.`,
      f.label,
    );
  }

  /** Variante : déposer la demande sans décider ; elle attend dans les décisions du projet de vie. */
  async requestAuthorization() {
    const f = this.flow();
    if (!f) return;
    this.busy.set(true);
    try {
      const r = await this.funding.request(f.refusal.budgetId, {
        taskId: f.refusal.taskId,
        reason: f.refusal.reason,
        overrunCents: f.refusal.overrunCents,
      });
      this.flow.set({ ...f, request: r.overrun });
    } catch (err) {
      this.notice.set({ text: toApiError(err).message, error: true });
    } finally {
      this.busy.set(false);
    }
  }

  /** Décision du budget de vie sur la demande ouverte par une écriture refusée ; autoriser rejoue l'écriture. */
  async decideFlow(decision: 'approve' | 'refuse') {
    const f = this.flow();
    if (!f?.request) return;
    this.busy.set(true);
    let decided: { message: string };
    try {
      decided = await this.funding.decide(f.request, decision);
    } catch (err) {
      this.busy.set(false);
      this.notice.set({ text: toApiError(err).message, error: true });
      return;
    }
    this.busy.set(false);
    if (decision === 'refuse') {
      this.flow.set(null);
      await this.load();
      this.notice.set({ text: `${decided.message} Rien n’a été enregistré.`, error: false });
      return;
    }
    await this.run(
      () => f.retry(),
      `${decided.message} ${capitalize(f.label || 'l’écriture')} est enregistrée.`,
      f.label,
    );
  }

}
