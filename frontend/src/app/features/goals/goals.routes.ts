import { Route } from '@angular/router';

export const goalsRoutes: Route[] = [
  {
    path: '',
    loadComponent: () =>
      import('./goals-page.component').then((m) => m.GoalsPageComponent),
  },
];
