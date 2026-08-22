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
    restoreTag: jest.Mock;
  };
  let fixture: ComponentFixture<CustomTagManagementComponent>;

  const make = (
    scope: 'personal' | 'group',
    groupId: string | null = null,
    canManage = true,
  ) => {
    fixture = TestBed.createComponent(CustomTagManagementComponent);
    fixture.componentRef.setInput('scope', scope);
    fixture.componentRef.setInput('groupId', groupId);
    fixture.componentRef.setInput('canManage', canManage);
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
      restoreTag: jest.fn(),
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
    expect(service.getManagedGroupTags).toHaveBeenCalledWith('g-1', 'active');
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

  // ── TAG-BATCH-C5b — deprecated view + restore ───────────────────────────────

  it('switching to the Deprecated view loads deprecated tags (status filter)', async () => {
    const comp = make('personal');
    await flush();
    service.getManagedPersonalTags.mockResolvedValue([tag({ id: 'd', status: 'deprecated' })]);
    comp.setView('deprecated');
    fixture.detectChanges();
    await flush();
    expect(service.getManagedPersonalTags).toHaveBeenLastCalledWith('deprecated');
    expect(comp.isDeprecatedView()).toBe(true);
    expect(comp.tags().map((t) => t.id)).toEqual(['d']);
  });

  it('the Deprecated view loads group tags with groupId + deprecated status', async () => {
    const comp = make('group', 'g-1');
    await flush();
    service.getManagedGroupTags.mockResolvedValue([]);
    comp.setView('deprecated');
    fixture.detectChanges();
    await flush();
    expect(service.getManagedGroupTags).toHaveBeenLastCalledWith('g-1', 'deprecated');
  });

  it('restore delegates to the service and drops the tag from the deprecated list', async () => {
    service.getManagedPersonalTags.mockResolvedValue([tag({ id: 'd', status: 'deprecated', version: 2 })]);
    const comp = make('personal');
    comp.setView('deprecated');
    fixture.detectChanges();
    await flush();
    service.restoreTag.mockResolvedValue(tag({ id: 'd', status: 'active', version: 3 }));
    await comp.restore(comp.tags()[0]);
    expect(service.restoreTag).toHaveBeenCalledWith(expect.objectContaining({ id: 'd', version: 2 }));
    expect(comp.tags().length).toBe(0);
    expect(comp.notice()).toMatch(/restored/i);
  });

  it('a restore version conflict (412) shows a notice and refreshes', async () => {
    service.getManagedPersonalTags.mockResolvedValue([tag({ id: 'd', status: 'deprecated', version: 2 })]);
    const comp = make('personal');
    comp.setView('deprecated');
    fixture.detectChanges();
    await flush();
    const callsBefore = service.getManagedPersonalTags.mock.calls.length;
    service.restoreTag.mockRejectedValue(
      new HttpErrorResponse({ status: 412, error: { errorCode: 'CON_VERSION_CONFLICT' } }),
    );
    await comp.restore(comp.tags()[0]);
    expect(comp.notice()).toMatch(/changed elsewhere/i);
    expect(service.getManagedPersonalTags.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  // ── TAG-BATCH-C5c — canManage gates management actions (usage unaffected) ────

  it('a non-managing member sees the list read-only (create/rename/remove hidden)', async () => {
    service.getManagedGroupTags.mockResolvedValue([tag({ id: 'g', scopeType: 'group', groupId: 'g-1' })]);
    make('group', 'g-1', /* canManage */ false);
    await flush();
    fixture.detectChanges();
    const html = (fixture.nativeElement as HTMLElement);
    // The tag is still visible…
    expect(html.querySelector('[data-testid="tag-list"]')).toBeTruthy();
    // …but no management affordances are rendered.
    expect(html.querySelector('[data-testid="create-tag"]')).toBeNull();
    expect(html.querySelector('[data-testid="start-rename"]')).toBeNull();
    expect(html.querySelector('[data-testid="start-deprecate"]')).toBeNull();
    expect(html.querySelector('[data-testid="view-deprecated"]')).toBeNull();
    expect(html.querySelector('[data-testid="readonly-note"]')).toBeTruthy();
  });

  it('guards mutating actions even if invoked directly when canManage is false', async () => {
    const comp = make('group', 'g-1', false);
    await flush();
    comp.newName.set('X');
    await comp.create();
    expect(service.createGroupTag).not.toHaveBeenCalled();
    comp.startEdit(tag({ id: 'g' }));
    expect(comp.editingId()).toBeNull(); // startEdit is a no-op
    await comp.restore(tag({ id: 'g', status: 'deprecated' }));
    expect(service.restoreTag).not.toHaveBeenCalled();
    comp.setView('deprecated');
    expect(comp.isDeprecatedView()).toBe(false); // cannot enter the restore view
  });

  it('a manager (canManage true) keeps full management affordances', async () => {
    service.getManagedGroupTags.mockResolvedValue([tag({ id: 'g', scopeType: 'group', groupId: 'g-1' })]);
    make('group', 'g-1', true);
    await flush();
    fixture.detectChanges();
    const html = fixture.nativeElement as HTMLElement;
    expect(html.querySelector('[data-testid="create-tag"]')).toBeTruthy();
    expect(html.querySelector('[data-testid="start-rename"]')).toBeTruthy();
    expect(html.querySelector('[data-testid="view-deprecated"]')).toBeTruthy();
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
