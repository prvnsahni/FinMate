import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import { ExpenseExportService } from './expense-export.service';
import { ExpenseDecryptionService } from '../../../core/services/expense-decryption.service';
import { ExportRow } from './export/expense-export.types';

function serverRow(over: Partial<ExportRow> = {}): ExportRow {
  return {
    id: 'e-1',
    expenseDate: '2026-07-01',
    createdAt: '2026-07-01T13:45:00.000Z',
    title: 'enc:Groceries',
    description: 'enc:weekly',
    encryptionScope: 'personal',
    groupId: null,
    groupKeyVersionId: null,
    wrappedContentKeys: [],
    amountTotal: 200,
    myShare: 200,
    currency: 'USD',
    category: 'Food & Drinks',
    expenseType: 'PERSONAL',
    groupName: null,
    paidByDisplayName: 'Alice',
    splitType: null,
    isSettled: false,
    status: 'posted',
    ...over,
  };
}

describe('ExpenseExportService', () => {
  let service: ExpenseExportService;
  let http: { get: jest.Mock };
  let decryptor: { decryptExpenses: jest.Mock };

  beforeEach(() => {
    http = { get: jest.fn() };
    decryptor = {
      decryptExpenses: jest.fn((rows: ExportRow[]) =>
        Promise.resolve(
          rows.map((r) => ({
            ...r,
            title: 'Groceries',
            description: 'weekly',
          })),
        ),
      ),
    };

    TestBed.configureTestingModule({
      providers: [
        ExpenseExportService,
        { provide: HttpClient, useValue: http },
        { provide: ExpenseDecryptionService, useValue: decryptor },
      ],
    });
    service = TestBed.inject(ExpenseExportService);
  });

  it('fetches rows and decrypts them', async () => {
    http.get.mockReturnValue(of({ rows: [serverRow()], count: 1 }));

    const rows = await service.fetchRows({
      from: '2026-07-01',
      to: '2026-07-31',
    });

    expect(http.get).toHaveBeenCalledWith(
      expect.stringContaining('/expenses/export'),
      expect.objectContaining({ params: expect.anything() }),
    );
    expect(decryptor.decryptExpenses).toHaveBeenCalledTimes(1);
    expect(rows[0].title).toBe('Groceries');
  });

  it('sends only the filters that are set', async () => {
    http.get.mockReturnValue(of({ rows: [] }));

    await service.fetchRows({
      from: '2026-07-01',
      to: '2026-07-31',
      type: 'group',
      category: 'Travel',
      status: 'settled',
      currency: 'USD',
    });

    const params = http.get.mock.calls[0][1].params;
    expect(params.get('from')).toBe('2026-07-01');
    expect(params.get('type')).toBe('group');
    expect(params.get('category')).toBe('Travel');
    expect(params.get('status')).toBe('settled');
    expect(params.get('currency')).toBe('USD');
  });

  it('omits type=all from the query and skips decrypt when empty', async () => {
    http.get.mockReturnValue(of({ rows: [] }));

    const rows = await service.fetchRows({
      from: '2026-07-01',
      to: '2026-07-31',
      type: 'all',
    });

    expect(http.get.mock.calls[0][1].params.get('type')).toBeNull();
    expect(decryptor.decryptExpenses).not.toHaveBeenCalled();
    expect(rows).toEqual([]);
  });

  it('tolerates a nested { data: { rows } } response shape', async () => {
    http.get.mockReturnValue(of({ data: { rows: [serverRow()] } }));

    const rows = await service.fetchRows({
      from: '2026-07-01',
      to: '2026-07-31',
    });

    expect(rows).toHaveLength(1);
  });

  it('builds a workbook and triggers a download, returning the filename', async () => {
    http.get.mockReturnValue(of({ rows: [serverRow()] }));
    const createUrl = jest.fn(() => 'blob:mock');
    const revokeUrl = jest.fn();
    (URL as unknown as { createObjectURL: unknown }).createObjectURL =
      createUrl;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL =
      revokeUrl;
    const clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    const filename = await service.exportExpenses(
      { from: '2026-01-01', to: '2026-03-31' },
      'xlsx',
    );

    expect(filename).toBe('samma-expenses-2026-01-01_to_2026-03-31.xlsx');
    expect(createUrl).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });
});
