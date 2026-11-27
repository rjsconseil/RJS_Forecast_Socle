import { describe,it,expect,afterEach } from 'vitest';
import { ContentSections } from './content-sections.service';
import { contentSectionsOf, CONTENT_SECTION_CATALOG } from './content-section-catalog';
import { planOrder } from '../plan/plan-order';
describe('navigation des sections de contenu',()=>{
 afterEach(()=>planOrder.set({}));
 it('propose les sections avant la première visite, sans paramètre de commande',()=>{
  for(const sections of Object.values(CONTENT_SECTION_CATALOG)){expect(new Set(sections.map(s=>s.id)).size).toBe(sections.length);expect(sections.every(s=>!!s.label && !/[?#]/.test(s.id))).toBe(true);}
  expect(contentSectionsOf('/bpm-astra/objectif')).toEqual([{id:'contenu-principal',label:'Vue d’ensemble du contenu'}]);
 });
 it('isole les structures rendues et applique leur ordre configuré',()=>{
  const service=new ContentSections();
  service.publish('/test',[{id:'a',label:'A'},{id:'b',label:'B'}]);
  planOrder.set({'/test':['/test#b','/test#a']});
  expect(service.of('/test').map(s=>s.id)).toEqual(['b','a']);
  expect(service.of('/autre')).toEqual([{id:'contenu-principal',label:'Vue d’ensemble du contenu'}]);
 });
});
it('utilise les ordres des modèles pour les sections des fiches réelles',()=>{
 const service=new ContentSections();
 service.publish('/bpm-astra/projets/prj_42',[{id:'a',label:'A'},{id:'b',label:'B'}]);
 planOrder.set({'/bpm-astra/projets/:id':['/bpm-astra/projets/:id#b','/bpm-astra/projets/:id#a']});
 expect(service.of('/bpm-astra/projets/prj_42').map(s=>s.id)).toEqual(['b','a']);
 planOrder.set({});
});
