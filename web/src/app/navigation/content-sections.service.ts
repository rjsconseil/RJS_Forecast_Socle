import { orderItems } from './navigation-model';
import { planOrder } from '../plan/plan-order';
import { Injectable, signal } from '@angular/core';
import { ContentSection, contentSectionsOf } from './content-section-catalog';
/** Dernière structure rendue de chaque sous-page, partagée par tous les bandeaux. */
@Injectable({ providedIn: 'root' })
export class ContentSections {
  of(path: string) {
    const model = path.replace(/\/prj_[^/]+(?=\/|$)/, '/:id');
    return orderItems(
      this.pages()[path] ?? contentSectionsOf(path),
      (section) => model + '#' + section.id,
      planOrder()[model],
    );
  }
  readonly pages = signal<Record<string, ContentSection[]>>({});
  publish(path: string, sections: ContentSection[]) {
    if (JSON.stringify(this.pages()[path]) === JSON.stringify(sections)) return;
    this.pages.update((p) => ({ ...p, [path]: sections }));
  }
}
