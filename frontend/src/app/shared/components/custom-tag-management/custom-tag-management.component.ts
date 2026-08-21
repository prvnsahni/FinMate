import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import {
  CustomTagService,
  ManagedCustomTag,
} from '../../../core/services/custom-tag.service';

/** Non-sensitive placeholder shown when a tag name cannot be decrypted locally. */
const ENCRYPTED_FALLBACK = 'Encrypted tag';
const MAX_NAME_LENGTH = 100;

/**
 * TAG-BATCH-C5a — reusable CUSTOM-tag management widget, parameterized by scope
 * (personal, or group + `groupId`). It manages ONLY user/group custom tags — never
 * the code-curated canonical taxonomy. Names are E2EE: created/renamed names are
 * encrypted CLIENT-SIDE by `CustomTagService` before any request, the server only
 * ever holds `encryptedName`, and a name that cannot be decrypted shows a safe
 * "Encrypted tag" placeholder (never fabricated, never logged). Deprecation is the
 * terminal action here (no restore/hard-delete in this batch); historical
 * `expense_tags` assignments are preserved server-side.
 */
@Component({
  selector: 'app-custom-tag-management',
  imports: [FormsModule],
  templateUrl: './custom-tag-management.component.html',
})
export class CustomTagManagementComponent {
  private readonly service = inject(CustomTagService);
  private readonly destroyRef = inject(DestroyRef);

  /** 'personal' → the user's own tags; 'group' → the group's tags (needs `groupId`). */
  readonly scope = input<'personal' | 'group'>('personal');
  readonly groupId = input<string | null>(null);

  readonly tags = signal<ManagedCustomTag[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);

  readonly newName = signal('');
  readonly creating = signal(false);

  readonly editingId = signal<string | null>(null);
  readonly editName = signal('');
  readonly savingId = signal<string | null>(null);
  readonly deprecatingId = signal<string | null>(null);

  readonly maxNameLength = MAX_NAME_LENGTH;
  readonly isGroup = computed(() => this.scope() === 'group');
  readonly canCreate = computed(() => {
    const name = this.newName().trim();
    return name.length > 0 && name.length <= MAX_NAME_LENGTH && !this.creating();
  });
  private token = 0;

  constructor() {
    // Reload whenever the scope/group changes (guards against a stale group id).
    effect(() => {
      this.scope();
      this.groupId();
      void this.load();
    });
  }

  /** Display name for a tag, with a safe non-sensitive fallback (never fabricated). */
  displayName(tag: ManagedCustomTag): string {
    return tag.name ?? ENCRYPTED_FALLBACK;
  }

  private async load(): Promise<void> {
    const scope = this.scope();
    const groupId = this.groupId();
    if (scope === 'group' && !groupId) {
      this.tags.set([]);
      return;
    }
    const mine = ++this.token;
    this.loading.set(true);
    this.error.set(null);
    try {
      const list =
        scope === 'group'
          ? await this.service.getManagedGroupTags(groupId as string)
          : await this.service.getManagedPersonalTags();
      if (mine !== this.token) return; // a newer load superseded this one
      this.tags.set(list.filter((t) => t.status === 'active'));
    } catch (e) {
      if (mine !== this.token) return;
      this.error.set(this.messageFor(e, 'load'));
    } finally {
      if (mine === this.token) this.loading.set(false);
    }
  }

  /** Public refresh (e.g. after a version conflict). */
  reload(): void {
    void this.load();
  }

  async create(): Promise<void> {
    const name = this.newName().trim();
    if (!name || name.length > MAX_NAME_LENGTH || this.creating()) return;
    this.creating.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      const tag =
        this.scope() === 'group'
          ? await this.service.createGroupTag(this.groupId() as string, name)
          : await this.service.createPersonalTag(name);
      this.tags.update((list) => [tag, ...list]);
      this.newName.set('');
    } catch (e) {
      this.error.set(this.messageFor(e, 'create'));
    } finally {
      this.creating.set(false);
    }
  }

  startEdit(tag: ManagedCustomTag): void {
    this.editingId.set(tag.id);
    this.editName.set(tag.name ?? '');
    this.error.set(null);
    this.notice.set(null);
  }

  cancelEdit(): void {
    this.editingId.set(null);
    this.editName.set('');
  }

  async saveEdit(tag: ManagedCustomTag): Promise<void> {
    const name = this.editName().trim();
    if (!name || name.length > MAX_NAME_LENGTH || this.savingId()) return;
    this.savingId.set(tag.id);
    this.error.set(null);
    try {
      const updated = await this.service.renameTag(tag, name);
      this.tags.update((list) =>
        list.map((t) => (t.id === updated.id ? updated : t)),
      );
      this.cancelEdit();
    } catch (e) {
      if (e instanceof HttpErrorResponse && e.status === 412) {
        // Optimistic-lock conflict — refresh to the latest and ask the user to retry.
        this.notice.set(
          'This tag was changed elsewhere. We refreshed it — please try your rename again.',
        );
        this.cancelEdit();
        this.reload();
      } else {
        this.error.set(this.messageFor(e, 'rename'));
      }
    } finally {
      this.savingId.set(null);
    }
  }

  /** Ask for confirmation before deprecating (two-step, no accidental data change). */
  requestDeprecate(tag: ManagedCustomTag): void {
    this.deprecatingId.set(tag.id);
    this.error.set(null);
    this.notice.set(null);
  }

  cancelDeprecate(): void {
    this.deprecatingId.set(null);
  }

  async confirmDeprecate(tag: ManagedCustomTag): Promise<void> {
    this.error.set(null);
    try {
      await this.service.deprecateTag(tag.id);
      // Non-destructive: the definition is marked deprecated and drops out of the
      // active list; historical expense assignments are preserved server-side.
      this.tags.update((list) => list.filter((t) => t.id !== tag.id));
      this.deprecatingId.set(null);
    } catch (e) {
      this.error.set(this.messageFor(e, 'deprecate'));
      this.deprecatingId.set(null);
    }
  }

  /** Map an error to a safe, name-free user message. Never surfaces the name/ciphertext. */
  private messageFor(e: unknown, action: 'load' | 'create' | 'rename' | 'deprecate'): string {
    if (e instanceof HttpErrorResponse) {
      if (e.status === 403) return "You don't have access to manage these tags.";
      if (e.status === 404) return 'That tag no longer exists.';
      if (e.status === 412) return 'This tag was changed elsewhere. Please refresh and try again.';
      if (e.status === 0) return 'Network error. Please check your connection and try again.';
    }
    if (e instanceof Error && (e.message === 'CUSTOM_TAG_NO_KEY' || e.message === 'CUSTOM_TAG_ENCRYPT_FAILED')) {
      return 'Could not secure the tag name on this device. Please try again.';
    }
    const verb = { load: 'load', create: 'create', rename: 'rename', deprecate: 'deprecate' }[action];
    return `Couldn't ${verb} the tag. Please try again.`;
  }
}
