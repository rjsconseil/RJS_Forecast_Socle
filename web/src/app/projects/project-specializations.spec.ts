import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { Api } from '../core/api.service';
import { ProjectsBoard } from './projects-board';
import { TasksBoard } from '../tasks/tasks-board';

function route(key: string, query: Record<string, string> = {}) {
  const data = { workspace: { key, title: 'Parcours spécialisé', lead: 'Une action ciblée.', parent: '/projects' } };
  return { data: of(data), queryParamMap: of(convertToParamMap(query)), snapshot: { data, queryParamMap: convertToParamMap(query), queryParams: query } };
}
const project = (id: string, dueDate: string | null) => ({
  project: { id, title: id, priority: 'medium', dueDate, startDate: null, description: '' },
  view: { column: 'todo', status: 'todo', statusLabel: 'À faire', doneCount: 0, completionPercent: 0, time: { taskCount: 0, spentHoursTotal: 0, plannedHoursKnown: 0 } },
});

describe('vues spécialisées des projets et tâches du noyau', () => {
  it('remplace le tableau des projets par un échéancier trié en conservant le périmètre de recherche', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([]),
      { provide: ActivatedRoute, useValue: route('project-planning') },
      { provide: Api, useValue: { projects: vi.fn(async () => [project('Sans date', null), project('Plus tard', '2027-02-01'), project('Urgent', '2026-11-08')]) } },
    ] });
    const fixture = TestBed.createComponent(ProjectsBoard);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const rows = [...fixture.nativeElement.querySelectorAll('tbody tr')] as HTMLElement[];
    expect(rows.map((r) => r.querySelector('a')?.textContent)).toEqual(['Urgent', 'Plus tard', 'Sans date']);
    expect(fixture.nativeElement.querySelector('.board')).toBeNull();
    expect(rows[2].textContent).toContain('À planifier');
    expect(rows[0].querySelector('a.btn')?.getAttribute('href')).toBe('/projects/Urgent/edit');
  });

  it('garde le parcours sans projet ciblé malgré un ancien filtre de projet dans l’URL', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([]),
      { provide: ActivatedRoute, useValue: route('core-unassigned', { project: 'p1' }) },
      { provide: Api, useValue: {} },
    ] });
    TestBed.overrideComponent(TasksBoard, { set: { template: '' } });
    const fixture = TestBed.createComponent(TasksBoard);
    const page = fixture.componentInstance as any;
    page.tasks.set([
      { task: { id: 'libre', title: 'Préparer', description: '', projectId: null, status: 'todo' } },
      { task: { id: 'projet', title: 'Planifier', description: '', projectId: 'p1', status: 'todo' } },
    ]);
    expect(page.filter()).toBe('unassigned');
    expect(page.visible().map((t: any) => t.task.id)).toEqual(['libre']);
    expect(page.selectedProjectId()).toBeNull();
    expect(page.remaining()).toBe(1);
    expect(page.toolbarScope()).toContain('1 / 1 tâche(s)');
  });
});
