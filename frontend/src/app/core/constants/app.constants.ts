export const APP_NAME = 'Samma';

/**
 * Day of the *following* month, inclusive, until which the previous month's
 * group expenses stay editable. After this day the month is closed and its
 * expenses become fully read-only. Mirrors the backend MONTH_LOCK_DAY config
 * (see ExpenseEditPolicyService); keep the two in sync if the cutoff changes.
 */
export const MONTH_LOCK_DAY = 7;

// Password visibility toggle icons (single-path, matching app-icon usage).
export const EYE_ICON_PATH =
  'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z';
export const EYE_OFF_ICON_PATH =
  'M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18';
export const CURRENCY_OPTIONS = [
  { value: 'USD', label: 'USD ($)' },
  { value: 'INR', label: 'INR (₹)' },
  { value: 'EUR', label: 'EUR (€)' },
];

export const CATEGORY_OPTIONS = [
  {
    value: 'Food & Drinks',
    label: 'Food & Drinks',
    color: '#00f2fe',
    class: 'bg-success/10 text-success border border-success/20',
    iconPath:
      'M17 2v7h2V2h2v7a4 4 0 01-4 4v9h-2v-9a4 4 0 01-4-4V2h2v7h2V2h2z M6 2v8h2v12H6v-12H4V2h2z',
    icon: `<svg class="w-4 h-4 text-slate-500 dark:text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"></path></svg>`,
  },
  {
    value: 'Travel',
    label: 'Travel',
    color: '#a18cd1',
    class:
      'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20',
    iconPath: 'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z',
    icon: `<svg class="w-4 h-4 text-slate-500 dark:text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path></svg>`,
  },
  {
    value: 'Utilities',
    label: 'Utilities',
    color: '#f6d365',
    class: 'bg-accent/10 text-accent border border-accent/20',
    iconPath: 'M13 10V3L4 14h7v7l9-11h-7z',
    icon: `<svg class="w-4 h-4 text-slate-500 dark:text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>`,
  },
  {
    value: 'Entertainment',
    label: 'Entertainment',
    color: '#ff0844',
    class:
      'bg-pink-500/10 text-pink-600 dark:text-pink-400 border border-pink-500/20',
    iconPath: 'M21 12a9 9 0 11-18 0 9 9 0 0118 0z M10 8l7 4-7 4V8z',
    icon: `<svg class="w-4 h-4 text-slate-500 dark:text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z"></path></svg>`,
  },
  {
    value: 'Shopping',
    label: 'Shopping',
    color: '#10b981',
    class:
      'bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20',
    iconPath: 'M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z',
    icon: `<svg class="w-4 h-4 text-slate-500 dark:text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"></path></svg>`,
  },
  {
    value: 'Housing',
    label: 'Housing',
    color: '#10b981',
    class:
      'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20',
    iconPath:
      'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
    icon: `<svg class="w-4 h-4 text-slate-500 dark:text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"></path></svg>`,
  },
  {
    value: 'Others',
    label: 'Others',
    color: '#10b981',
    class: 'bg-secondary/10 text-secondary/75 border border-secondary/20',
    iconPath:
      'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
    icon: `<svg class="w-4 h-4 text-slate-500 dark:text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg>`,
  },
];
