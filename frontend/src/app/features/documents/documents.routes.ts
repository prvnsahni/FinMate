import { Route } from '@angular/router';
import { DocumentIntakePageComponent } from './document-intake-page.component';

/** DOC-4 document intake/review feature routes (lazy-loaded under the auth shell). */
export const documentsRoutes: Route[] = [
  { path: '', component: DocumentIntakePageComponent },
];
