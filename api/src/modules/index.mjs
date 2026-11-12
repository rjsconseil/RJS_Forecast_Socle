// Modules intégrés au socle, dans l'ordre des niveaux. Un module ne dépend que de niveaux
// inférieurs ou transverses ; les niveaux supérieurs enrichissent les inférieurs par extensions.
import navigationModule from './navigation/index.mjs';
import usersModule from './users/index.mjs';
import administrationModule from './administration/index.mjs';
import objectManagementModule from './object-management/index.mjs';
import calendarModule from './calendar/index.mjs';
import coreModule from './core/index.mjs';
import budgetModule from './budget/index.mjs';
import patrimoineModule from './patrimoine/index.mjs';
import bpmModule from './bpm/index.mjs';

export const SOCLE_MODULES = [navigationModule, usersModule, administrationModule, objectManagementModule, calendarModule, coreModule, budgetModule, patrimoineModule, bpmModule];
