import {
  EXPORT_COLUMNS,
  ExportRow,
  buildExportFilename,
  buildExportInfoMatrix,
  formatUtcTimestamp,
} from './expense-export.types';

function row(over: Partial<ExportRow> = {}): ExportRow {
  return {
    id: 'e-1',
    expenseDate: '2026-07-01',
    createdAt: '2026-07-01T13:45:00.000Z',
    title: 'Groceries',
    description: 'weekly shop',
    amountTotal: 1234.5,
    myShare: 617.25,
    currency: 'USD',
    category: 'Food & Drinks',
    expenseType: 'GROUP_SHARE',
    groupName: 'House',
    paidByDisplayName: 'Bob',
    splitType: 'equal',
    isSettled: false,
    status: 'posted',
    ...over,
  };
}

describe('EXPORT_COLUMNS', () => {
  it('has the expected headers in order', () => {
    expect(EXPORT_COLUMNS.map((c) => c.header)).toEqual([
      'Date',
      'Description',
      'Amount',
      'Type',
      'Currency',
      'Category',
      'Expense Type',
      'Group Name',
      'Paid By',
      'Split Type',
      'Your Share',
      'Status',
      'Notes',
      'Created At',
    ]);
  });

  it('renders the transaction Type column as Expense/Refund', () => {
    expect(valueOf('Type', row({ transactionType: 'refund' }))).toBe('Refund');
    expect(valueOf('Type', row({ transactionType: 'expense' }))).toBe(
      'Expense',
    );
    // Legacy rows without the field read as a normal expense.
    expect(valueOf('Type', row())).toBe('Expense');
  });

  const valueOf = (header: string, r: ExportRow) =>
    EXPORT_COLUMNS.find((c) => c.header === header)!.value(r);

  it('maps title→Description and description→Notes', () => {
    const r = row();
    expect(valueOf('Description', r)).toBe('Groceries');
    expect(valueOf('Notes', r)).toBe('weekly shop');
  });

  it('renders Expense Type as human labels', () => {
    expect(valueOf('Expense Type', row({ expenseType: 'PERSONAL' }))).toBe(
      'Personal',
    );
    expect(valueOf('Expense Type', row({ expenseType: 'GROUP_SHARE' }))).toBe(
      'Group',
    );
  });

  it('shows settlement status for group shares and N/A for personal', () => {
    expect(valueOf('Status', row({ isSettled: true }))).toBe('Settled');
    expect(valueOf('Status', row({ isSettled: false }))).toBe('Pending');
    expect(valueOf('Status', row({ expenseType: 'PERSONAL' }))).toBe('N/A');
  });

  it('keeps monetary columns numeric', () => {
    const r = row();
    expect(valueOf('Amount', r)).toBe(1234.5);
    expect(valueOf('Your Share', r)).toBe(617.25);
  });

  it('formats dates to YYYY-MM-DD and Created At to YYYY-MM-DD HH:mm', () => {
    expect(valueOf('Date', row())).toBe('2026-07-01');
    expect(valueOf('Created At', row())).toMatch(/^2026-07-01 \d{2}:\d{2}$/);
  });
});

describe('buildExportFilename', () => {
  it('builds the suggested filename from the range', () => {
    expect(
      buildExportFilename({ from: '2026-01-01', to: '2026-03-31' }, 'xlsx'),
    ).toBe('samma-expenses-2026-01-01_to_2026-03-31.xlsx');
  });
});

describe('formatUtcTimestamp', () => {
  it('formats as YYYY-MM-DD HH:mm UTC', () => {
    expect(formatUtcTimestamp(new Date('2026-07-28T14:35:09Z'))).toBe(
      '2026-07-28 14:35 UTC',
    );
  });
});

describe('buildExportInfoMatrix', () => {
  const flatten = (rows: (string | number)[][]) =>
    new Map(rows.filter((r) => r.length >= 2).map((r) => [String(r[0]), r[1]]));

  it('defaults Type to All and Status to All when unset', () => {
    const info = flatten(
      buildExportInfoMatrix({
        filter: { from: '2026-01-01', to: '2026-07-28' },
        total: 0,
        exportedOn: new Date('2026-07-28T00:00:00Z'),
      }),
    );
    expect(info.get('Type')).toBe('All');
    expect(info.get('Status')).toBe('All');
    expect(info.get('Total Transactions')).toBe(0);
  });

  it('includes Category and Currency only when set', () => {
    const without = flatten(
      buildExportInfoMatrix({
        filter: { from: '2026-01-01', to: '2026-07-28', type: 'group' },
        total: 5,
        exportedOn: new Date('2026-07-28T00:00:00Z'),
      }),
    );
    expect(without.has('Category')).toBe(false);
    expect(without.has('Currency')).toBe(false);

    const withBoth = flatten(
      buildExportInfoMatrix({
        filter: {
          from: '2026-01-01',
          to: '2026-07-28',
          type: 'group',
          category: 'Travel',
          currency: 'USD',
        },
        total: 5,
        exportedOn: new Date('2026-07-28T00:00:00Z'),
      }),
    );
    expect(withBoth.get('Category')).toBe('Travel');
    expect(withBoth.get('Currency')).toBe('USD');
    expect(withBoth.get('Type')).toBe('Group');
  });
});
