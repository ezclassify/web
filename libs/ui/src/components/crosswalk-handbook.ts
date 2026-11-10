/**
 * CrosswalkHandbook Component
 *
 * A reference panel for one crosswalk a Context holds: what it translates from
 * and to, its guidance and citation, and every reviewed decision it applies,
 * the cross-field selections first and then the per-assertion mappings, each
 * with its disposition and reason.
 *
 * Declared with `data-ezclassify-controller="crosswalk-handbook"`. A Context
 * that holds one crosswalk needs nothing else; one that holds several names the
 * crosswalk with `data-ezclassify-crosswalk-handbook-crosswalk-id`:
 *
 * ```html
 * <div data-ezclassify-controller="crosswalk-handbook"></div>
 * <div
 *     data-ezclassify-controller="crosswalk-handbook"
 *     data-ezclassify-crosswalk-handbook-crosswalk-id="cvss-31-to-40"></div>
 * ```
 *
 * Everything shown comes from `describeCrosswalks()`, the effective set after
 * any crosswalk layer the Context stacks, which is the set `translate` applies.
 * The handbook decides nothing about a marking.
 */

import type {
    Assertion,
    AssertionReference,
    ContextAdapter,
    ContextCrosswalkCandidate,
    ContextCrosswalkDescriptor,
    ContextCrosswalkSelection,
    ContextSchemeDescriptor,
    CrosswalkDisposition,
    CrosswalkMapping,
    CrosswalkTarget,
} from '@ezclassify/types';
import type {
    ComponentEngineSource,
    ComponentInstance,
    ComponentOptions,
} from './component-base-readonly';
import { resolveContextSource } from './component-base-readonly';
import { createAnnouncer, announce } from './component-utils';
import { adoptStyles, type AdoptedStyles } from '../styles/adopt';
import crosswalkHandbookCss from './crosswalk-handbook.css?inline';

const ROOT_CLASS = 'ez-crosswalk-handbook';

/** The declarative option that names the crosswalk. */
const CROSSWALK_ID_ATTRIBUTE =
    'data-ezclassify-crosswalk-handbook-crosswalk-id';

/** Dispositions in the order the summary counts them. */
const DISPOSITIONS: readonly CrosswalkDisposition[] = [
    'carry',
    'review',
    'omit',
    'forbid',
];

/** Options specific to the CrosswalkHandbook component. */
export interface CrosswalkHandbookOptions extends ComponentOptions {
    /**
     * The crosswalk to show, by the id `translate` takes. Needed only when the
     * Context holds several; declaratively
     * `data-ezclassify-crosswalk-handbook-crosswalk-id`.
     */
    crosswalkId?: string;
}

/**
 * Pick the crosswalk a handbook shows.
 *
 * @param crosswalks - What the Context's `describeCrosswalks()` returned
 * @param named - The crosswalk id the host named, if any
 * @returns The crosswalk to show
 * @throws Error when the name matches none, or when nothing is named and the
 *   Context holds no crosswalk or several
 */
export function selectCrosswalk(
    crosswalks: readonly ContextCrosswalkDescriptor[],
    named: string | undefined,
): ContextCrosswalkDescriptor {
    const held = crosswalks.map((c) => c.id).join(', ') || 'none';
    if (named) {
        const found = crosswalks.find((c) => c.id === named);
        if (found) return found;
        throw new Error(
            `[CrosswalkHandbook] crosswalk "${named}" is not one the Context holds (it holds: ${held}).`,
        );
    }
    if (crosswalks.length === 1) return crosswalks[0];
    if (crosswalks.length === 0) {
        throw new Error(
            '[CrosswalkHandbook] the Context holds no crosswalk to show.',
        );
    }
    throw new Error(
        `[CrosswalkHandbook] the Context holds several crosswalks (${held}); name one with ${CROSSWALK_ID_ATTRIBUTE}.`,
    );
}

/** `category/concept`, with `=value` for a value-bearing concept. */
function assertionLabel(reference: AssertionReference): string {
    const base = `${reference.categoryId}/${reference.conceptId}`;
    return reference.value === undefined ? base : `${base}=${reference.value}`;
}

/** Targets joined the way a reader says them: one, or one of several. */
function targetsLabel(targets: readonly CrosswalkTarget[]): string {
    return targets
        .map((t) =>
            t.copyValue
                ? `${assertionLabel(t)} (value copied)`
                : assertionLabel(t),
        )
        .join(' or ');
}

/** When a candidate of a cross-field selection is chosen. */
function candidateTrigger(candidate: ContextCrosswalkCandidate): string {
    const when = candidate.when;
    const clauses: string[] = [];
    if (when?.all?.length)
        clauses.push(`all of ${when.all.map(assertionLabel).join(', ')}`);
    if (when?.any?.length)
        clauses.push(`any of ${when.any.map(assertionLabel).join(', ')}`);
    if (when?.none?.length)
        clauses.push(`none of ${when.none.map(assertionLabel).join(', ')}`);
    if (clauses.length > 0) return `When ${clauses.join('; ')}`;
    if (candidate.score?.length)
        return `Scores ${candidate.score.map(assertionLabel).join(', ')}`;
    return 'Fallback';
}

/** A scheme as a reader knows it: `id@version`, or its selector. */
function schemeLabel(
    selector: string,
    schemes: readonly ContextSchemeDescriptor[],
): string {
    const scheme = schemes.find((s) => s.selector === selector);
    return scheme ? `${scheme.id}@${scheme.version}` : selector;
}

/** Only an http(s) citation becomes a link; anything else stays text. */
function citationHref(citation: string): string | null {
    try {
        const url = new URL(citation);
        return url.protocol === 'https:' || url.protocol === 'http:'
            ? url.href
            : null;
    } catch {
        return null;
    }
}

/** The searchable text of a mapping. */
function mappingText(mapping: CrosswalkMapping): string {
    return [
        mapping.id,
        assertionLabel(mapping.source),
        ...(mapping.targets ?? []).map(assertionLabel),
        mapping.disposition,
        mapping.reason,
        mapping.authority,
        mapping.guidance,
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
}

/** The searchable text of a cross-field selection. */
function selectionText(selection: ContextCrosswalkSelection): string {
    return [
        selection.id,
        selection.strategy,
        ...selection.candidates.flatMap((c) => [
            c.id,
            c.disposition,
            candidateTrigger(c),
            c.reason,
            c.authority,
            c.guidance,
            ...(c.mappings ?? []).map(mappingText),
        ]),
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
}

/** Browsable reference panel for one crosswalk of a Context. */
export class CrosswalkHandbook implements ComponentInstance {
    /** A reference panel authors no marking. */
    readonly authorsWhole = false;

    private container!: HTMLDivElement;
    private options: CrosswalkHandbookOptions = {};
    private crosswalk!: ContextCrosswalkDescriptor;
    private schemes: ContextSchemeDescriptor[] = [];
    private root: HTMLDivElement | null = null;
    private body!: HTMLDivElement;
    private searchInput!: HTMLInputElement;
    private announcer!: HTMLDivElement;
    private filterText = '';
    private adoptedStyle: AdoptedStyles | null = null;
    private destroyed = false;

    /**
     * Mount the handbook.
     *
     * @param container - Element to render into
     * @param engineOrContext - The Context that holds the crosswalk
     * @param options - This component's options
     * @throws Error when no Context is given, or the crosswalk cannot be picked
     *   (see {@link selectCrosswalk})
     */
    async init(
        container: HTMLDivElement,
        engineOrContext?: ComponentEngineSource | null,
        options?: CrosswalkHandbookOptions,
    ): Promise<void> {
        const context: ContextAdapter | null =
            resolveContextSource(engineOrContext);
        if (!context) {
            throw new Error(
                '[CrosswalkHandbook] needs a Context. Mount it through EzClassifyUI, or pass a Context to init().',
            );
        }
        this.container = container;
        this.options = options ?? {};
        const raw = this.options as Record<string, unknown>;
        const named =
            this.options.crosswalkId ??
            (typeof raw['crosswalk-id'] === 'string'
                ? raw['crosswalk-id']
                : undefined);

        const [crosswalks, schemes] = await Promise.all([
            context.describeCrosswalks(),
            // The scheme list only labels the direction; a Context that cannot
            // give it still shows its crosswalk, by selector.
            Promise.resolve()
                .then(() => context.describeSchemes())
                .catch(() => [] as ContextSchemeDescriptor[]),
        ]);
        if (this.destroyed) return;
        this.crosswalk = selectCrosswalk(
            crosswalks,
            named?.trim() || undefined,
        );
        this.schemes = schemes;

        if (this.options.injectStyles !== false) {
            this.adoptedStyle = adoptStyles(
                crosswalkHandbookCss,
                (this.options.root ??
                    container.ownerDocument?.head ??
                    document.head) as HTMLElement,
            );
        }
        this.build();
        this.render();
    }

    /** The crosswalk this handbook shows. */
    get crosswalkId(): string {
        return this.crosswalk?.id ?? '';
    }

    getAssertions(): Assertion[] {
        return [];
    }

    /** A reference panel shows no marking. */
    setAssertions(): void {}

    /** A reference panel shows no marking. */
    setValue(): void {}

    getRendered(): string {
        return '';
    }

    destroy(): void {
        this.destroyed = true;
        this.root?.remove();
        this.root = null;
        this.adoptedStyle?.release();
        this.adoptedStyle = null;
    }

    private build(): void {
        const crosswalk = this.crosswalk;
        const root = document.createElement('div');
        root.className = ROOT_CLASS;
        root.setAttribute('role', 'region');
        root.setAttribute(
            'aria-label',
            `Crosswalk handbook: ${crosswalk.name}`,
        );
        root.dataset.crosswalkId = crosswalk.id;
        root.appendChild(this.renderOverview());

        const searchWrap = document.createElement('div');
        searchWrap.className = `${ROOT_CLASS}__search`;
        this.searchInput = document.createElement('input');
        this.searchInput.type = 'search';
        this.searchInput.className = `${ROOT_CLASS}__search-input`;
        this.searchInput.placeholder = 'Search decisions…';
        this.searchInput.setAttribute(
            'aria-label',
            `Search ${crosswalk.name} decisions`,
        );
        this.searchInput.addEventListener('input', () => {
            this.filterText = this.searchInput.value.trim();
            const count = this.render();
            if (!this.filterText) return;
            announce(
                this.announcer,
                count === 0
                    ? `No decisions match "${this.filterText}"`
                    : `${count} decision${count === 1 ? '' : 's'} found`,
            );
        });
        searchWrap.appendChild(this.searchInput);
        root.appendChild(searchWrap);

        this.body = document.createElement('div');
        this.body.className = `${ROOT_CLASS}__body`;
        root.appendChild(this.body);

        this.announcer = createAnnouncer();
        root.appendChild(this.announcer);

        this.root = root;
        this.container.appendChild(root);
    }

    private renderOverview(): HTMLDivElement {
        const crosswalk = this.crosswalk;
        const el = document.createElement('div');
        el.className = `${ROOT_CLASS}__overview`;

        const name = document.createElement('div');
        name.className = `${ROOT_CLASS}__name`;
        name.textContent = crosswalk.name;
        el.appendChild(name);

        const meta = document.createElement('div');
        meta.className = `${ROOT_CLASS}__meta`;
        meta.textContent = `${crosswalk.id} · v${crosswalk.version}`;
        el.appendChild(meta);

        const direction = document.createElement('div');
        direction.className = `${ROOT_CLASS}__direction`;
        const from = document.createElement('code');
        from.textContent = schemeLabel(crosswalk.source, this.schemes);
        const to = document.createElement('code');
        to.textContent = schemeLabel(crosswalk.target, this.schemes);
        direction.append('Translates ', from, ' to ', to);
        el.appendChild(direction);

        const summary = document.createElement('div');
        summary.className = `${ROOT_CLASS}__summary`;
        const counts = DISPOSITIONS.map((d) => ({
            disposition: d,
            count: crosswalk.mappings.filter((m) => m.disposition === d).length,
        })).filter((c) => c.count > 0);
        const parts = counts.map((c) => `${c.count} ${c.disposition}`);
        const mappingCount = crosswalk.mappings.length;
        parts.unshift(
            `${mappingCount} mapping${mappingCount === 1 ? '' : 's'}`,
        );
        const selectionCount = crosswalk.selections.length;
        if (selectionCount > 0) {
            parts.push(
                `${selectionCount} cross-field selection${selectionCount === 1 ? '' : 's'}`,
            );
        }
        summary.textContent = parts.join(' · ');
        el.appendChild(summary);

        if (crosswalk.guidance) {
            el.appendChild(this.field('Guidance', crosswalk.guidance));
        }
        if (crosswalk.citation) {
            el.appendChild(this.citation(crosswalk.citation));
        }
        return el;
    }

    /**
     * Render the decisions that match the filter.
     *
     * @returns How many decisions are shown
     */
    private render(): number {
        this.body.replaceChildren();
        const filter = this.filterText.toLowerCase();
        const selections = this.crosswalk.selections.filter(
            (s) => !filter || selectionText(s).includes(filter),
        );
        const mappings = this.crosswalk.mappings.filter(
            (m) => !filter || mappingText(m).includes(filter),
        );

        if (selections.length > 0) {
            const section = this.section('Cross-field selections');
            const list = document.createElement('ul');
            list.className = `${ROOT_CLASS}__list`;
            for (const selection of selections) {
                list.appendChild(this.renderSelection(selection));
            }
            section.appendChild(list);
            this.body.appendChild(section);
        }
        if (mappings.length > 0) {
            const section = this.section('Mapping decisions');
            const list = document.createElement('ul');
            list.className = `${ROOT_CLASS}__list`;
            for (const mapping of mappings) {
                list.appendChild(this.renderMapping(mapping));
            }
            section.appendChild(list);
            this.body.appendChild(section);
        }

        const shown = selections.length + mappings.length;
        if (shown === 0) {
            const empty = document.createElement('div');
            empty.className = `${ROOT_CLASS}__empty`;
            empty.textContent = filter
                ? `No decisions match “${this.filterText}”`
                : 'This crosswalk declares no decisions.';
            this.body.appendChild(empty);
        }
        return shown;
    }

    private section(title: string): HTMLElement {
        const section = document.createElement('section');
        section.className = `${ROOT_CLASS}__section`;
        const heading = document.createElement('h4');
        heading.className = `${ROOT_CLASS}__section-title`;
        heading.textContent = title;
        section.appendChild(heading);
        return section;
    }

    private renderSelection(
        selection: ContextCrosswalkSelection,
    ): HTMLLIElement {
        const item = document.createElement('li');
        item.className = `${ROOT_CLASS}__entry ${ROOT_CLASS}__selection`;
        item.dataset.selectionId = selection.id;

        const header = document.createElement('div');
        header.className = `${ROOT_CLASS}__entry-header`;
        const id = document.createElement('code');
        id.textContent = selection.id;
        const strategy = document.createElement('span');
        strategy.className = `${ROOT_CLASS}__strategy`;
        strategy.textContent =
            selection.strategy === 'first-match'
                ? 'First match wins'
                : 'Most matches wins';
        header.append(id, strategy);
        item.appendChild(header);

        const candidates = document.createElement('ol');
        candidates.className = `${ROOT_CLASS}__candidates`;
        for (const candidate of selection.candidates) {
            const row = document.createElement('li');
            row.className = `${ROOT_CLASS}__candidate`;
            row.dataset.candidateId = candidate.id;
            row.dataset.disposition = candidate.disposition;

            const head = document.createElement('div');
            head.className = `${ROOT_CLASS}__entry-header`;
            const name = document.createElement('strong');
            name.textContent = candidate.id;
            head.append(name, this.badge(candidate.disposition));
            row.appendChild(head);

            const trigger = document.createElement('div');
            trigger.className = `${ROOT_CLASS}__trigger`;
            trigger.textContent = candidateTrigger(candidate);
            row.appendChild(trigger);

            if (candidate.targets?.length) {
                row.appendChild(
                    this.field('Emits', targetsLabel(candidate.targets)),
                );
            }
            row.appendChild(this.reason(candidate.reason));
            this.appendProvenance(row, candidate);
            if (candidate.mappings?.length) {
                const nested = document.createElement('ul');
                nested.className = `${ROOT_CLASS}__list ${ROOT_CLASS}__list--nested`;
                for (const mapping of candidate.mappings) {
                    nested.appendChild(this.renderMapping(mapping));
                }
                row.appendChild(nested);
            }
            candidates.appendChild(row);
        }
        item.appendChild(candidates);
        return item;
    }

    private renderMapping(mapping: CrosswalkMapping): HTMLLIElement {
        const item = document.createElement('li');
        item.className = `${ROOT_CLASS}__entry ${ROOT_CLASS}__mapping`;
        item.dataset.mappingId = mapping.id;
        item.dataset.disposition = mapping.disposition;

        const header = document.createElement('div');
        header.className = `${ROOT_CLASS}__entry-header`;
        const source = document.createElement('code');
        source.textContent = assertionLabel(mapping.source);
        header.append(source, this.badge(mapping.disposition));
        item.appendChild(header);

        if (mapping.targets?.length) {
            item.appendChild(
                this.field(
                    mapping.disposition === 'review'
                        ? 'Candidate targets'
                        : 'Target',
                    targetsLabel(mapping.targets),
                ),
            );
        }
        item.appendChild(this.reason(mapping.reason));
        this.appendProvenance(item, mapping);
        return item;
    }

    private appendProvenance(
        el: HTMLElement,
        decision: { authority?: string; guidance?: string; citation?: string },
    ): void {
        if (decision.authority)
            el.appendChild(this.field('Authority', decision.authority));
        if (decision.guidance)
            el.appendChild(this.field('Guidance', decision.guidance));
        if (decision.citation) el.appendChild(this.citation(decision.citation));
    }

    private badge(disposition: CrosswalkDisposition): HTMLSpanElement {
        const badge = document.createElement('span');
        badge.className = `${ROOT_CLASS}__disposition`;
        badge.dataset.disposition = disposition;
        badge.textContent = disposition;
        return badge;
    }

    private reason(text: string): HTMLParagraphElement {
        const p = document.createElement('p');
        p.className = `${ROOT_CLASS}__reason`;
        p.textContent = text;
        return p;
    }

    private field(label: string, text: string): HTMLParagraphElement {
        const p = document.createElement('p');
        p.className = `${ROOT_CLASS}__field`;
        const strong = document.createElement('strong');
        strong.textContent = `${label}: `;
        p.append(strong, text);
        return p;
    }

    private citation(citation: string): HTMLParagraphElement {
        const p = document.createElement('p');
        p.className = `${ROOT_CLASS}__field`;
        const strong = document.createElement('strong');
        strong.textContent = 'Citation: ';
        p.appendChild(strong);
        const href = citationHref(citation);
        if (href) {
            const link = document.createElement('a');
            link.href = href;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = citation;
            p.appendChild(link);
        } else {
            p.append(citation);
        }
        return p;
    }
}
