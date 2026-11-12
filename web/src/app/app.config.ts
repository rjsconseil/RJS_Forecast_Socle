import { NAVIGATION_CATALOG } from './navigation/navigation.service';
import { SITE_NAVIGATION } from './plan/navigation-adapter';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';
import { userContextInterceptor } from './core/api.service';

export const appConfig: ApplicationConfig = {
  providers: [
    { provide: NAVIGATION_CATALOG, useValue: SITE_NAVIGATION },
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withInterceptors([userContextInterceptor])),
  ],
};
