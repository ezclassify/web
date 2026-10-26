/**
 * EzMarkingLabelComponent: static marking pill with scheme-driven coloring.
 *
 * Displays a marking string as a styled pill. Color comes from the nearest
 * [ezClassify] host, or from the application's own provision when there is no
 * host above the label; no manual assertion inspection needed at the call
 * site.
 *
 * Usage anywhere under `provideEzClassify()`, or inside an [ezClassify] scope:
 * <ez-marking-label [marking]="hit.marking" />
 *
 * The component resolves the color by running the marking through the scope's
 * engine, then finding the first assertion whose conceptId has an entry in the
 * colorMap. If no match is found (or no engine/colorMap is present), the label
 * renders without a background color.
 *
 * The colorMap can also be passed explicitly: useful outside an [ezClassify]
 * scope or when you need to override the inherited map: <ez-marking-label
 * [marking]="hit.marking" [colorMap]="myMap" />
 */

import {
    Component,
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Input,
    OnChanges,
    SimpleChanges,
    effect,
    inject,
    untracked,
} from '@angular/core';
import type { Assertion } from '@ezclassify/types';
import type { RenderColorMap } from '@ezclassify/ui';
import { EzClassifyDirective } from '../ezclassify.directive';
import {
    EZCLASSIFY_ENGINE,
    EZCLASSIFY_OPTIONS,
    resolveSchemeAdapter,
    type EzClassifySchemeEngine,
} from '../provide-ezclassify';

/**
 * A static marking pill that picks up scheme-driven color from the nearest
 * [ezClassify] root.
 */
@Component({
    selector: 'ez-marking-label',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `<span
        class="ez-marking-label"
        [class.ez-marking-label--colored]="hasColor"
        [style.--ez-marking-bg]="bg || null"
        [style.--ez-marking-text]="fg || null"
        [style.--ez-marking-border]="border || null"
        >{{ marking }}</span
    >`,
    styles: [
        `
            :host {
                display: inline;
            }
            .ez-marking-label {
                display: inline-block;
                padding: 0.1em 0.5em;
                border-radius: 3px;
                font-family: monospace;
                font-size: 0.875em;
            }
            .ez-marking-label--colored {
                background: var(--ez-marking-bg);
                color: var(--ez-marking-text);
                border: 1px solid var(--ez-marking-border, var(--ez-marking-bg));
            }
        `,
    ],
})
export class EzMarkingLabelComponent implements OnChanges {
    /**
     * The app-level engine, used when no `[ezClassify]` host sits above this
     * label. A label is often rendered in a search-results list or a table cell
     * outside any host, which is why the token is injected at all; a host that
     * bound its own engine still wins for its descendants.
     */
    private readonly providedEngine = inject(EZCLASSIFY_ENGINE, {
        optional: true,
    });
    private readonly providedOptions = inject(EZCLASSIFY_OPTIONS, {
        optional: true,
    });
    private readonly dir = inject(EzClassifyDirective, { optional: true });
    private readonly cdr = inject(ChangeDetectorRef);

    /** The raw marking string to display. */
    @Input() marking = '';
    /**
     * Color map keyed by conceptId. When provided, overrides the colorMap from
     * the nearest [ezClassify] root. Shape: `{ conceptId: { background, text,
     * border? } }`.
     */
    @Input() colorMap?: RenderColorMap;

    /** @internal: public only for template binding */
    bg = '';
    /** @internal: public only for template binding */
    fg = '';
    /** @internal: public only for template binding */
    border = '';
    /** @internal: public only for template binding */
    hasColor = false;

    /**
     * The engine the last color resolution ran against. `undefined` means no
     * resolution has happened yet, which is distinct from having resolved
     * against no engine at all.
     */
    private resolvedAgainst: EzClassifySchemeEngine | null | undefined =
        undefined;

    constructor() {
        // The inputs are what ngOnChanges covers. The engine is not an input:
        // a host's `[ezClassify]` may be bound to an engine fetched over the
        // wire, and until that lands there is nothing to run the marking
        // through. Without this the label would color itself once, against no
        // engine, and never look again. Same re-arming the facet injectable
        // does, off the same directive's signals.
        effect(() => {
            this.dir?.engineSignal();
            untracked(() => {
                if (this.resolveEngine() === this.resolvedAgainst) return;
                this.resolveColor();
                this.cdr.markForCheck();
            });
        });
    }

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['marking'] || changes['colorMap']) {
            this.resolveColor();
        }
    }

    /**
     * The engine this label runs its marking through: the nearest
     * `[ezClassify]` host's, otherwise the app-level one.
     *
     * Host first, deliberately. `[ezClassify]` shadows the app engine for a
     * host and its descendants, and a label is a descendant like any other. The
     * directive does not provide {@link EZCLASSIFY_ENGINE} in its own node
     * injector, so reading the token here reaches past the host to the app;
     * asking the directive is what respects the override. `getEngine()` already
     * falls back to the app-level engine when the host bound none, so the token
     * only answers for a label with no host above it at all.
     */
    private resolveEngine(): EzClassifySchemeEngine | null {
        const fromHost = this.dir?.getEngine();
        if (fromHost) return fromHost;
        return this.providedEngine
            ? resolveSchemeAdapter(this.providedEngine)
            : null;
    }

    private resolveColor(): void {
        const engine = this.resolveEngine();
        this.resolvedAgainst = engine;
        // Same precedence, for the same reason: the explicit input, then the
        // host's options (already merged over the app-level ones by the
        // directive), then the app-level options for a label with no host.
        const map =
            this.colorMap ??
            this.dir?.getOptions().colorMap ??
            this.providedOptions?.colorMap ??
            {};

        if (!this.marking || !engine || Object.keys(map).length === 0) {
            this.clearColor();
            return;
        }

        // A label displays the marking, so it asks the reader's call.
        const raw = engine.validate(this.marking);
        if (raw && typeof raw === 'object' && 'then' in raw) {
            (raw as Promise<{ assertions?: Assertion[] }>).then((r) => {
                this.applyColor(r.assertions ?? [], map);
                this.cdr.markForCheck();
            });
        } else {
            this.applyColor(
                (raw as { assertions?: Assertion[] }).assertions ?? [],
                map,
            );
        }
    }

    private applyColor(assertions: Assertion[], map: RenderColorMap): void {
        // Find the first assertion whose conceptId has a color entry. The loop
        // respects assertion order so category-priority is whatever the engine chose.
        const hit = assertions.find((a) => map[a.conceptId]);
        if (!hit) {
            this.clearColor();
            return;
        }
        const colors = map[hit.conceptId];
        this.bg = colors.background;
        this.fg = colors.text;
        this.border = colors.border ?? colors.background;
        this.hasColor = true;
    }

    private clearColor(): void {
        this.bg = '';
        this.fg = '';
        this.border = '';
        this.hasColor = false;
    }
}
