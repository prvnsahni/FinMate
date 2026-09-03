import { TestBed } from '@angular/core/testing';
import { Store } from '@ngxs/store';
import { CustomTagSuggestionService } from './custom-tag-suggestion.service';
import { CustomTagService } from '../../../core/services/custom-tag.service';
import { CustomTagCorrectionMemoryService } from '../../../core/services/custom-tag-correction-memory.service';

describe('CustomTagSuggestionService (TAG-BATCH-C4)', () => {
  let service: CustomTagSuggestionService;
  let customTags: {
    getPersonalCustomTags: jest.Mock;
    getGroupCustomTags: jest.Mock;
  };
  let store: { selectSnapshot: jest.Mock };

  beforeEach(() => {
    customTags = {
      getPersonalCustomTags: jest.fn().mockResolvedValue([]),
      getGroupCustomTags: jest.fn().mockResolvedValue([]),
    };
    store = { selectSnapshot: jest.fn().mockReturnValue({ userId: 'user-A' }) };

    TestBed.configureTestingModule({
      providers: [
        CustomTagSuggestionService,
        CustomTagCorrectionMemoryService,
        { provide: CustomTagService, useValue: customTags },
        { provide: Store, useValue: store },
      ],
    });
    service = TestBed.inject(CustomTagSuggestionService);
  });

  it('currentScope reads the userId from auth state (null when signed out)', () => {
    expect(service.currentScope()).toEqual({
      userId: 'user-A',
      groupId: undefined,
    });
    store.selectSnapshot.mockReturnValue(null);
    expect(service.currentScope()).toBeNull();
  });

  it('loads PERSONAL authorized tags, dropping any whose name did not decrypt', async () => {
    customTags.getPersonalCustomTags.mockResolvedValue([
      { id: 'p1', scopeType: 'personal', name: 'My Grocery' },
      { id: 'p2', scopeType: 'personal', name: null }, // undecryptable → dropped
    ]);
    const tags = await service.loadAuthorizedTags({ userId: 'user-A' });
    expect(tags).toEqual([{ id: 'p1', name: 'My Grocery', scope: 'personal' }]);
    expect(customTags.getGroupCustomTags).not.toHaveBeenCalled();
  });

  it('loads GROUP authorized tags ONLY for the requested group (no cross-group)', async () => {
    customTags.getGroupCustomTags.mockResolvedValue([
      { id: 'g1', scopeType: 'group', name: 'Team Lunch' },
    ]);
    const tags = await service.loadAuthorizedTags({
      userId: 'user-A',
      groupId: 'group-1',
    });
    expect(customTags.getGroupCustomTags).toHaveBeenCalledWith('group-1');
    expect(customTags.getGroupCustomTags).toHaveBeenCalledTimes(1);
    expect(tags).toEqual([
      { id: 'g1', name: 'Team Lunch', scope: 'group', groupId: 'group-1' },
    ]);
  });

  it('suggest() blends the pure engine with device-local correction memory', () => {
    const scope = { userId: 'user-A' };
    const authorized = [
      { id: 'a', name: 'Milk', scope: 'personal' as const },
      { id: 'b', name: 'My Grocery', scope: 'personal' as const },
    ];
    // With no memory: exact name wins.
    expect(service.suggest('milk', authorized, scope)[0].tagId).toBe('a');
    // After a correction, the remembered tag outranks the name match.
    service.recordCorrection(scope, 'milk', 'b');
    expect(service.suggest('milk', authorized, scope)[0]).toMatchObject({
      tagId: 'b',
      reason: 'Matched a previous correction',
    });
  });

  it('correction memory recorded for user A never influences user B', () => {
    const authorized = [
      { id: 'a', name: 'Milk', scope: 'personal' as const },
      { id: 'b', name: 'My Grocery', scope: 'personal' as const },
    ];
    service.recordCorrection({ userId: 'user-A' }, 'milk', 'b');
    // User B on the same device: no remembered correction → name match wins.
    const forB = service.suggest('milk', authorized, { userId: 'user-B' });
    expect(forB[0].tagId).toBe('a');
    expect(
      forB.find((s) => s.reason === 'Matched a previous correction'),
    ).toBeUndefined();
  });

  it('makes no backend call just to produce suggestions (suggest is pure)', () => {
    const scope = { userId: 'user-A' };
    service.suggest(
      'milk',
      [{ id: 'a', name: 'Milk', scope: 'personal' }],
      scope,
    );
    expect(customTags.getPersonalCustomTags).not.toHaveBeenCalled();
    expect(customTags.getGroupCustomTags).not.toHaveBeenCalled();
  });
});
