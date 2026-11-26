import { APPLICATIONS } from '../platform/applications';
/** Section → Page → Sous-page → Section de contenu. Les ancres ne déclenchent aucune commande. */
export interface ContentSection { id:string; label:string }
export const CONTENT_SECTION_CATALOG: Record<string,ContentSection[]> = Object.assign({}, ...APPLICATIONS.map((application) => application.contentSections ?? {}));
export const contentSectionsOf = (path:string): ContentSection[] => CONTENT_SECTION_CATALOG[path] ?? CONTENT_SECTION_CATALOG[path.replace(/\/prj_[^/]+(?=\/|$)/,'/:id')] ?? [{id:'contenu-principal',label:'Vue d’ensemble du contenu'}];
