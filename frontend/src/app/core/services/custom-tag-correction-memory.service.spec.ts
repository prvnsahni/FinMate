import { TestBed } from '@angular/core/testing';
import { CustomTagCorrectionMemoryService } from './custom-tag-correction-memory.service';

describe('CustomTagCorrectionMemoryService (TAG-BATCH-C4)', () => {
  let service: CustomTagCorrectionMemoryService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(CustomTagCorrectionMemoryService);
  });

  const A = { userId: 'user-A' };
  const B = { userId: 'user-B' };
  const AG1 = { userId: 'user-A', groupId: 'g-1' };
  const AG2 = { userId: 'user-A', groupId: 'g-2' };

  it('recalls a recorded label→custom-tag association (device-local)', () => {
    service.record(A, 'Amul Taaza Milk', 'ct-grocery');
    expect(service.recall(A, 'Amul Taaza Milk')).toEqual(['ct-grocery']);
    // Normalization: casing/punctuation do not matter.
    expect(service.recall(A, 'amul  taaza   milk')).toEqual(['ct-grocery']);
  });

  it('does not record a blank label', () => {
    service.record(A, '   ', 'ct-x');
    expect(service.recall(A, '   ')).toEqual([]);
  });

  it('isolates correction memory BETWEEN USERS (no cross-user learning)', () => {
    service.record(A, 'Milk', 'ct-a');
    expect(service.recall(B, 'Milk')).toEqual([]);
  });

  it('isolates correction memory BETWEEN GROUPS (no cross-group learning)', () => {
    service.record(AG1, 'Team Lunch', 'ct-g1');
    expect(service.recall(AG2, 'Team Lunch')).toEqual([]);
  });

  it("isolates a group's memory from the same user's personal memory", () => {
    service.record(AG1, 'Lunch', 'ct-group');
    expect(service.recall(A, 'Lunch')).toEqual([]);
  });

  it('stores only opaque ids (no decrypted names) and accumulates multiple ids', () => {
    service.record(A, 'Milk', 'ct-1');
    service.record(A, 'Milk', 'ct-2');
    expect(service.recall(A, 'Milk').sort()).toEqual(['ct-1', 'ct-2']);
  });

  it('clear() wipes all memory (e.g. on logout)', () => {
    service.record(A, 'Milk', 'ct-1');
    service.clear();
    expect(service.recall(A, 'Milk')).toEqual([]);
  });

  it('never touches persistent browser storage', () => {
    const localSpy = jest.spyOn(Storage.prototype, 'setItem');
    service.record(A, 'Milk', 'ct-1');
    service.recall(A, 'Milk');
    expect(localSpy).not.toHaveBeenCalled();
    localSpy.mockRestore();
  });
});
