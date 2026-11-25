import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { ROADMAP_ENTRIES, RoadmapEntry, RoadmapStatus } from './roadmap.data';

interface RoadmapGroup {
  status: RoadmapStatus;
  label: string;
  entries: RoadmapEntry[];
}

@Component({
  selector: 'app-roadmap-page',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="space-y-6">
      <header
        class="rounded-2xl border border-border/20 bg-finmate-card dark:bg-finmate-card/50 p-4 md:p-6"
      >
        <h1 class="text-2xl md:text-3xl font-extrabold text-primary">
          Roadmap
        </h1>
        <p class="mt-2 text-sm md:text-base text-muted">
          Snapshot of delivered, active, and planned product work.
        </p>
      </header>

      @for (group of groups; track group.status) {
        <section
          class="rounded-2xl border border-border/20 bg-finmate-card dark:bg-finmate-card/50 p-4 md:p-6"
        >
          <div class="flex items-center justify-between gap-3">
            <h2 class="text-lg md:text-xl font-bold text-secondary">
              {{ group.label }}
            </h2>
            <span
              class="inline-flex items-center rounded-full bg-surface px-3 py-1 text-xs md:text-sm font-semibold text-muted border border-border/20"
            >
              {{ group.entries.length }}
            </span>
          </div>

          @if (group.entries.length === 0) {
            <p class="mt-4 text-sm text-muted">No items in this section yet.</p>
          } @else {
            <div class="mt-4 grid grid-cols-1 gap-3 md:gap-4">
              @for (entry of group.entries; track entry.id) {
                <article
                  class="rounded-xl border border-border/20 bg-surface/60 p-4"
                >
                  <div class="flex flex-wrap items-start justify-between gap-2">
                    <h3
                      class="text-base md:text-lg font-semibold text-secondary"
                    >
                      {{ entry.title }}
                    </h3>
                    <span
                      class="text-xs font-medium text-muted rounded-full border border-border/20 px-2.5 py-1"
                    >
                      {{ entry.category }}
                    </span>
                  </div>

                  <p
                    class="mt-2 text-sm md:text-base leading-relaxed text-muted"
                  >
                    {{ entry.description }}
                  </p>

                  @if (entry.version || entry.targetPeriod) {
                    <div class="mt-3 flex flex-wrap gap-2 text-xs md:text-sm">
                      @if (entry.version) {
                        <span
                          class="rounded-md bg-surface px-2 py-1 text-muted border border-border/20"
                        >
                          Version: {{ entry.version }}
                        </span>
                      }
                      @if (entry.targetPeriod) {
                        <span
                          class="rounded-md bg-surface px-2 py-1 text-muted border border-border/20"
                        >
                          Target: {{ entry.targetPeriod }}
                        </span>
                      }
                    </div>
                  }
                </article>
              }
            </div>
          }
        </section>
      }
    </section>
  `,
})
export class RoadmapPageComponent {
  private readonly statusOrder: RoadmapStatus[] = [
    'done',
    'in-progress',
    'planned',
  ];

  private readonly statusLabels: Record<RoadmapStatus, string> = {
    done: 'Done',
    'in-progress': 'In Progress',
    planned: 'Planned',
  };

  readonly groups: RoadmapGroup[] = this.statusOrder.map((status) => ({
    status,
    label: this.statusLabels[status],
    entries: ROADMAP_ENTRIES.filter((entry) => entry.status === status),
  }));
}
