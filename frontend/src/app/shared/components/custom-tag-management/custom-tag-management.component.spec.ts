import { TestBed, ComponentFixture } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { CustomTagManagementComponent } from './custom-tag-management.component';
import {
  CustomTagService,
  ManagedCustomTag,
} from '../../../core/services/custom-tag.service';

const tag = (over: Partial<ManagedCustomTag> = {}): ManagedCustomTag => ({
  id: 't-1',
  name: 'My Grocery',
  scopeType: 'personal',
  status: 'active',
  version: 1,
  groupId: null,
  groupKeyVersionId: null,
  ...over,
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('CustomTagManagementComponent (TAG-BATCH-C5a)', () => {
  let service: {
    getManagedPersonalTags: jest.Mock;
    getManagedGroupTags: jest.Mock;
    createPersonalTag: jest.Mock;
    createGroupTag: jest.Mock;
    renameTag: jest.Mock;
    deprecateTag: jest.Mock;
  };
  let fixture: ComponentFixture<CustomTagManagementComponent>;

  const make = (scope: 'personal' | 'group', groupId: string | null = null) => {
    fixture = TestBed.createComponent(CustomTagManagementComponent);
    fixture.componentRef.setInput('scope', scope);
    fixture.componentRef.setInput('groupId', groupId);
    fixture.detectChanges();
    return fixture.componentInstance;
  };

  beforeEach(() => {
    service = {
      getManagedPersonalTags: jest.fn().mockResolvedValue([]),
      getManagedGroupTags: jest.fn().mockResolvedValue([]),
      createPersonalTag: jest.fn(),
      createGroupTag: jest.fn(),
      renameTag: jest.fn(),
      deprecateTag: jest.fn().mockResolvedValue(undefined),
    };
    TestBed.configureTestingModule({
      imports: [CustomTagManagementComponent],
      providers: [{ provide: CustomTagService, useValue: service }],
    });
  });

  it('loads PERSONAL tags for personal scope', async () => {
    service.getManagedPersonalTags.mockResolvedValue([tag()]);
    const comp = make('personal');
    await flush();
    expect(service.getManagedPersonalTags).toHaveBeenCalled();
    expect(service.getManagedGroupTags).not.toHaveBeenCalled();
    expect(comp.tags().length).toBe(1);
  });

  it('loads GROUP tags scoped to the given groupId', async () => {
    service.getManagedGroupTags.mockResolvedValue([tag({ scopeType: 'group', groupId: 'g-1' })]);
    make('group', 'g-1');
    await flush();
    expect(service.getManagedGroupTags).toHaveBeenCalledWith('g-1');
    expect(service.getManagedPersonalTags).not.toHaveBeenCalled();
  });

  it('does not load group tags when groupId is missing (guards a stale scope)', async () => {
    make('group', null);
    await flush();
    expect(service.getManagedGroupTags).not.toHaveBeenCalled();
    expect(fixture.componentInstance.tags()).toEqual([]);
  });

  it('only shows ACTIVE tags (deprecated dropped from the management list)', async () => {
    service.getManagedPersonalTags.mockResolvedValue([
      tag({ id: 'a', status: 'active' }),
      tag({ id: 'b', status: 'deprecated' }),
    ]);
    const comp = make('personal');
    await flush();
    expect(comp.tags().map((t) => t.id)).toEqual(['a']);
  });

  it('shows a safe "Encrypted tag" fallback when the name could not be decrypted', async () => {
    service.getManagedPersonalTags.mockResolvedValue([tag({ name: null })]);
    const comp = make('personal');
    await flush();
    expect(comp.displayName(comp.tags()[0])).toBe('Encrypted tag');
  });

  it('create (personal) delegates to the service and prepends the new tag', async () => {
    const comp = make('personal');
    await flush();
    service.createPersonalTag.mockResolvedValue(tag({ id: 'new', name: 'Fresh' }));
    comp.newName.set('Fresh');
    await comp.create();
    expect(service.createPersonalTag).toHaveBeenCalledWith('Fresh');
    expect(comp.tags()[0].id).toBe('new');
    expect(comp.newName()).toBe(''); // input cleared
  });

  it('create (group) uses the group service with groupId', async () => {
    const comp = make('group', 'g-1');
    await flush();
    service.createGroupTag.mockResolvedValue(tag({ id: 'gnew', scopeType: 'group', groupId: 'g-1' }));
    comp.newName.set('Team');
    await comp.create();
    expect(service.createGroupTag).toHaveBeenCalledWith('g-1', 'Team');
  });

  it('rename delegates to the service and replaces the row', async () => {
    service.getManagedPersonalTags.mockResolvedValue([tag({ id: 't-1', version: 1 })]);
    const comp = make('personal');
    await flush();
    service.renameTag.mockResolvedValue(tag({ id: 't-1', name: 'Renamed', version: 2 }));
    comp.startEdit(comp.tags()[0]);
    comp.editName.set('Renamed');
    await comp.saveEdit(comp.tags()[0]);
    expect(service.renameTag).toHaveBeenCalledWith(expect.objectContaining({ id: 't-1' }), 'Renamed');
    expect(comp.tags()[0]).toMatchObject({ name: 'Renamed', version: 2 });
    expect(comp.editingId()).toBeNull();
  });

  it('surfaces a version conflict (412) and refreshes the list', async () => {
    service.getManagedPersonalTags.mockResolvedValue([tag({ id: 't-1', version: 1 })]);
    const comp = make('personal');
    await flush();
    service.renameTag.mockRejectedValue(
      new HttpErrorResponse({ status: 412, error: { errorCode: 'CON_VERSION_CONFLICT' } }),
    );
    comp.startEdit(comp.tags()[0]);
    comp.editName.set('X');
    await comp.saveEdit(comp.tags()[0]);
    expect(comp.notice()).toMatch(/changed elsewhere/i);
    // A refresh was triggered (second load call).
    expect(service.getManagedPersonalTags).toHaveBeenCalledTimes(2);
  });

  it('deprecate removes the tag from the active list (historical assignments untouched server-side)', async () => {
    service.getManagedPersonalTags.mockResolvedValue([tag({ id: 't-1' })]);
    const comp = make('personal');
    await flush();
    comp.requestDeprecate(comp.tags()[0]);
    await comp.confirmDeprecate(comp.tags()[0]);
    expect(service.deprecateTag).toHaveBeenCalledWith('t-1');
    expect(comp.tags().length).toBe(0);
  });

  it('shows a name-free error message on load failure (403)', async () => {
    service.getManagedGroupTags.mockRejectedValue(new HttpErrorResponse({ status: 403 }));
    const comp = make('group', 'g-1');
    await flush();
    expect(comp.error()).toMatch(/access/i);
    expect(comp.tags()).toEqual([]);
  });

  it('never persists tag names to browser storage', async () => {
    const setSpy = jest.spyOn(Storage.prototype, 'setItem');
    service.getManagedPersonalTags.mockResolvedValue([tag({ name: 'Secret' })]);
    const comp = make('personal');
    await flush();
    service.createPersonalTag.mockResolvedValue(tag({ id: 'n', name: 'AlsoSecret' }));
    comp.newName.set('AlsoSecret');
    await comp.create();
    for (const call of setSpy.mock.calls) {
      const s = JSON.stringify(call);
      expect(s).not.toContain('Secret');
      expect(s).not.toContain('AlsoSecret');
    }
    setSpy.mockRestore();
  });
});
