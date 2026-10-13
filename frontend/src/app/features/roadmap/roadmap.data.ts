export type RoadmapStatus = 'done' | 'in-progress' | 'planned';

export interface RoadmapEntry {
  id: string;
  title: string;
  description: string;
  status: RoadmapStatus;
  category: string;
  version?: string;
  targetPeriod?: string;
}

export const ROADMAP_ENTRIES: RoadmapEntry[] = [
  {
    id: 'rm-001',
    title: 'People Directory + Profiles',
    description:
      'Centralized people listing with profile detail pages and improved relationship visibility.',
    status: 'done',
    category: 'Social',
    version: 'v1.2',
  },
  {
    id: 'rm-002',
    title: 'Document Intake (Itemized Review)',
    description:
      'Upload flow for extraction and review before creating an expense from receipt-like documents.',
    status: 'in-progress',
    category: 'Expenses',
    targetPeriod: 'Q4 2026',
  },
  {
    id: 'rm-003',
    title: 'Goal Projection Enhancements',
    description:
      'Refine projection details and improve confidence messaging for long-term goals.',
    status: 'planned',
    category: 'Goals',
    targetPeriod: 'Q1 2027',
  },
  {
    id: 'rm-004',
    title: 'Group Ledger Sharing Improvements',
    description:
      'Smoother shared ledger viewing and better deep-link entry points for recipients.',
    status: 'planned',
    category: 'Groups',
  },
  {
    id: 'rm-005',
    title: 'Dashboard Export UX Refresh',
    description:
      'Polish export actions and clarity around exported data scope and date filters.',
    status: 'done',
    category: 'Dashboard',
    version: 'v1.3',
  },
];
