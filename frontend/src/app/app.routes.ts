import { Route } from '@angular/router';
import { AuthLayoutComponent } from './shared/layouts/auth-layout.component';
import { MainLayoutComponent } from './shared/layouts/main-layout.component';
import { authGuard } from './core/auth/auth.guard';
import { guestGuard } from './core/auth/guest.guard';

export const appRoutes: Route[] = [
  {
    path: '',
    component: MainLayoutComponent,
    canActivate: [authGuard],
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      {
        path: 'dashboard',
        loadChildren: () =>
          import('./features/dashboard/dashboard.routes').then(
            (m) => m.dashboardRoutes,
          ),
      },
      {
        path: 'groups',
        loadChildren: () =>
          import('./features/groups/groups.routes').then((m) => m.groupsRoutes),
      },
      {
        path: 'people',
        loadChildren: () =>
          import('./features/people/people.routes').then((m) => m.peopleRoutes),
      },
      {
        path: 'goals',
        loadChildren: () =>
          import('./features/goals/goals.routes').then((m) => m.goalsRoutes),
      },
      // People supersedes the old Friends page; keep the path as a redirect
      // for backwards compatibility (bookmarks, existing links).
      { path: 'friends', redirectTo: 'people', pathMatch: 'full' },
    ],
  },
  {
    path: 'auth',
    component: AuthLayoutComponent,
    canActivate: [guestGuard],
    loadChildren: () =>
      import('./features/auth/auth.routes').then((m) => m.authRoutes),
  },
  { path: '**', redirectTo: '' },
];
