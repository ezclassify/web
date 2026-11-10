/**
 * EzMarkingLabelComponent: static marking pill with scheme-driven coloring.
 *
 * Displays a marking string as a styled pill, colored from the Context and
 * options named by `provideEzClassify()`. Inside an `ezClassify` root the
 * root's `[ezClassifyOptions]` color map wins over the provided one. A label in
 * a search-results list or a table cell needs no root above it.
 *
 * <ez-marking-label [marking]="hit.marking" />
 *
 * The component runs the marking through the Context's scheme, then takes the
 * first assertion whose conceptId has an entry in the colorMap. With no match,
 * no Context or no colorMap, the label renders without a background color.
 *
 * The colorMap can also be passed explicitly, to override the inherited map:
 * <ez-marking-label [marking]="hit.marking" [colorMap]="myMap" />
 */

import {
    Component,
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Input,
    OnChanges,
    SimpleChanges,
    inject,
} from '@angular/core';
import type { Assertion } from '@ezclassify/types';
import type { RenderColorMap } from '@ezclassify/ui';
import { EzClassifyDirective } from '../ezclassify.directive';
import { EZCLASSIFY_CONTEXT, EZCLASSIFY_OPTIONS } from '../provide-ezclassify';

/** A static marking pill colored from the provided Context. */
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
    private readonly context = inject(EZCLASSIFY_CONTEXT, { optional: true });
    private readonly providedOptions = inject(EZCLASSIFY_OPTIONS, {
        optional: true,
    });
    private readonly dir = inject(EzClassifyDirective, { optional: true });
    private readonly cdr = inject(ChangeDetectorRef);

    /** The raw marking string to display. */
    @Input() marking = '';
    /**
     * Color map keyed by conceptId. When provided, overrides the inherited
     * colorMap. Shape: `{ conceptId: { background, text, border? } }`.
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

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['marking'] || changes['colorMap']) {
            this.resolveColor();
        }
    }

    private resolveColor(): void {
        const engine = this.context?.scheme ?? null;
        // The explicit input, then the root's options (already merged over the
        // provided ones by the directive), then the provided options for a
        // label with no root above it.
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
