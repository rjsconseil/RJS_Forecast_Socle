import { Component, DestroyRef, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RecetteContext } from '../../core/api.service';
import { BpmDrafts } from './drafts';

@Component({ template: '' })
class Form {
  label = signal('');
  amount = '';
  requestKey = 'initial';
  draft = inject(BpmDrafts).fields(
    'test:revision-1',
    this,
    ['label', 'amount', 'requestKey'],
    inject(DestroyRef),
  );
}

describe('brouillons des formulaires BPM', () => {
  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({});
    TestBed.inject(RecetteContext).userId.set('user-A');
  });
  it('reprend les saisies et la clé de demande après un aller-retour de page', () => {
    const first = TestBed.createComponent(Form);
    first.componentInstance.label.set('Cuisine');
    first.componentInstance.amount = '120,50';
    first.componentInstance.requestKey = 'demande-stable';
    first.destroy();
    const next = TestBed.createComponent(Form);
    expect(next.componentInstance.draft.restored).toBe(true);
    expect(next.componentInstance.label()).toBe('Cuisine');
    expect(next.componentInstance.amount).toBe('120,50');
    expect(next.componentInstance.requestKey).toBe('demande-stable');
  });
  it('efface le brouillon enregistré ou annulé et ne le recrée pas à la destruction', () => {
    const first = TestBed.createComponent(Form);
    first.componentInstance.label.set('Ne pas reprendre');
    first.componentInstance.draft.save();
    first.componentInstance.draft.clear();
    first.destroy();
    expect(TestBed.createComponent(Form).componentInstance.draft.restored).toBe(false);
  });
  it('ne présente jamais les saisies d’un autre utilisateur', () => {
    const first = TestBed.createComponent(Form);
    first.componentInstance.label.set('Privé A');
    first.componentInstance.draft.save();
    TestBed.inject(RecetteContext).userId.set('user-B');
    first.componentInstance.label.set('Changement tardif');
    first.destroy();
    expect(TestBed.createComponent(Form).componentInstance.label()).toBe('');
    TestBed.inject(RecetteContext).userId.set('user-A');
    expect(TestBed.createComponent(Form).componentInstance.label()).toBe('Privé A');
  });
  it('détache un formulaire conservé sans réécrire son ancien contexte à la destruction', () => {
    const first = TestBed.createComponent(Form);
    first.componentInstance.label.set('Premier projet');
    first.componentInstance.draft.detach();
    first.componentInstance.label.set('Autre projet');
    first.destroy();
    expect(TestBed.createComponent(Form).componentInstance.label()).toBe('Premier projet');
  });
});
