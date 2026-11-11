/**
 * TranslatedView: a view that shows the marking it reads translated through a
 * crosswalk the Context declares.
 *
 * Declared with `data-ezclassify-translate` on a view, next to the attribute
 * that says what it reads (`data-ezclassify-source="<id>"` or
 * `data-ezclassify-aggregate`). The value names the crosswalk:
 *
 * ```html
 * <div
 *     data-ezclassify-source="memo1"
 *     data-ezclassify-translate="tier-to-label"></div>
 * <div data-ezclassify-aggregate data-ezclassify-translate></div>
 * ```
 *
 * Left bare, the Context must hold exactly one crosswalk from the view's scheme
 * (its primary scheme unless `data-ezclassify-scheme` selects another). No
 * crosswalk, or several, is a host error that leaves the view unenhanced.
 *
 * The view hands the facts it reads to `ctx.translate({ crosswalkId, marking
 * })` and shows the engine's answer as given: the target marking, and every
 * source fact the crosswalk did not carry with the disposition and reason the
 * engine reports. A fact that only lost a selection to another candidate is
 * listed apart from the facts the crosswalk omits: nothing decided against it.
 * It decides nothing about the marking itself. A translation the crosswalk
 * forbids, a source that does not read, or a call that fails shows no target
 * marking at all. A view never contributes to a roll-up.
 */

import type {
    Assertion,
    AssertionReference,
    ContextAdapter,
    CrosswalkOutcome,
    CrosswalkSelectionOutcome,
    CrosswalkTranslationResult,
    ValidationError,
} from '@ezclassify/types';
import type {
    ComponentEngineSource,
    ComponentInstance,
    ComponentOptions,
} from './component-base-readonly';
import { resolveContextSource } from './component-base-readonly';
import { EMPTY_VALUE } from '../text-utils';
import { t } from '../i18n';
import { adoptStyles, type AdoptedStyles } from '../styles/adopt';
import translatedViewCss from './translated-view.css?inline';

/** The host attribute that declares a translated view. */
export const TRANSLATE_ATTRIBUTE = 'data-ezclassify-translate';

/**
 * A translated view whose markup cannot be served: the field stays unenhanced
 * and the message says what to change.
 */
export class TranslateHostError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'TranslateHostError';
    }
}

/** Whether `el` declares a translated view. */
export function isTranslatedView(el: Element): boolean {
    return el.hasAttribute(TRANSLATE_ATTRIBUTE);
}

/**
 * The crosswalk a translated view applies.
 *
 * @param context - The Context the view is bound to
 * @param named - The value of `data-ezclassify-translate`; empty when bare
 * @param schemeSelector - The view's Context-local scheme selector, if it set
 *   one; otherwise the Context's primary scheme
 * @returns The crosswalk id to pass to `translate`
 * @throws TranslateHostError when a bare view has no single crosswalk
 */
export async function resolveCrosswalkId(
    context: ContextAdapter,
    named: string,
    schemeSelector?: string,
): Promise<string> {
    if (named) return named;
    const selector = schemeSelector || (await primarySelector(context));
    const crosswalks = await context.describeCrosswalks();
    const from = crosswalks.filter((c) => c.source === selector);
    if (from.length === 1) return from[0].id;
    if (from.length === 0) {
        throw new TranslateHostError(
            `${TRANSLATE_ATTRIBUTE}: the Context holds no crosswalk from scheme "${selector}".`,
        );
    }
    throw new TranslateHostError(
        `${TRANSLATE_ATTRIBUTE}: the Context holds several crosswalks from scheme "${selector}" (${from
            .map((c) => c.id)
            .join(', ')}); name one.`,
    );
}

async function primarySelector(context: ContextAdapter): Promise<string> {
    const schemes = await context.describeSchemes();
    const primary = schemes.find((s) => s.roles.includes('primary'));
    if (!primary) {
        throw new TranslateHostError(
            `${TRANSLATE_ATTRIBUTE}: the Context reports no primary scheme.`,
        );
    }
    return primary.selector;
}

/**
 * Where the view stands. `empty` reads nothing; `pending` waits on the engine;
 * the rest are the engine's translation status, or `error` when the call
 * failed.
 */
export type TranslatedViewStatus =
    'empty' | 'pending' | CrosswalkTranslationResult['status'] | 'error';

/** Options a translated view takes beyond every component's. */
export interface TranslatedViewOptions extends ComponentOptions {
    /**
     * The view's Context-local scheme selector, as the runtime resolved it from
     * `data-ezclassify-scheme`. A bare view translates through the one
     * crosswalk from this scheme; omitted, from the Context's primary scheme.
     */
    schemeSelector?: string;
}

/** Read-only view of a marking translated through a crosswalk. */
export class TranslatedView implements ComponentInstance {
    /** A view authors no marking of its own. */
    readonly authorsWhole = false;

    private context!: ContextAdapter;
    private host!: HTMLElement;
    private crosswalkId = '';
    private options: TranslatedViewOptions = {};
    private source: Assertion[] = [];
    private rendered = '';
    private status: TranslatedViewStatus = 'empty';
    private incomplete = false;
    private readSeq = 0;
    private destroyed = false;
    private adoptedStyle: AdoptedStyles | null = null;

    private wrap!: HTMLDivElement;
    private markingEl!: HTMLSpanElement;
    private noteEl!: HTMLDivElement;
    private listEl!: HTMLUListElement;
    private notSelectedEl!: HTMLUListElement;
    private incompleteEl!: HTMLDivElement;

    async init(
        container: HTMLDivElement,
        engineOrContext?: ComponentEngineSource | null,
        options?: TranslatedViewOptions,
    ): Promise<void> {
        if (container.matches('input, textarea, select')) {
            throw new TranslateHostError(
                `${TRANSLATE_ATTRIBUTE} shows text; place it on an element that is not a form control.`,
            );
        }
        if (container.hasAttribute('data-ezclassify-controller')) {
            throw new TranslateHostError(
                `${TRANSLATE_ATTRIBUTE} is a view of its own; remove data-ezclassify-controller from its host.`,
            );
        }
        const context = resolveContextSource(engineOrContext);
        if (!context) {
            throw new TranslateHostError(
                `${TRANSLATE_ATTRIBUTE} needs a Context; the view resolves none.`,
            );
        }
        this.context = context;
        this.host = container;
        this.options = options ?? {};
        this.crosswalkId = await resolveCrosswalkId(
            context,
            (container.getAttribute(TRANSLATE_ATTRIBUTE) ?? '').trim(),
            this.options.schemeSelector,
        );

        container.setAttribute('data-ezclassify', '');
        if (!container.hasAttribute('aria-live')) {
            container.setAttribute('aria-live', 'polite');
        }
        this.injectStyles();
        this.build();
        this.showEmpty();

        if (this.options.initialValue) {
            await this.read(this.options.initialValue);
        }
    }

    /** Show `assertions` translated. Replaces whatever the view showed. */
    setAssertions(assertions: Assertion[]): void {
        if (this.destroyed) return;
        void this.read([...assertions]);
    }

    /** Show the marking text `value` translated. */
    async setValue(value: string): Promise<void> {
        if (this.destroyed) return;
        await this.read(value.trim());
    }

    /**
     * Whether the value this view reads may be missing markings (a stale
     * roll-up, a marking nobody has read). The view says so beside the
     * translation.
     */
    setIncomplete(value: boolean): void {
        this.incomplete = value;
        if (!this.incompleteEl) return;
        this.incompleteEl.textContent = value ? t('rollup.incomplete') : '';
        this.host.toggleAttribute('data-ezclassify-incomplete', value);
    }

    /** The source facts the view was last handed, in its own scheme. */
    getAssertions(): Assertion[] {
        return [...this.source];
    }

    /** The translated marking the view shows; empty when it shows none. */
    getRendered(): string {
        return this.rendered;
    }

    /** Where the view stands; see {@link TranslatedViewStatus}. */
    getStatus(): TranslatedViewStatus {
        return this.status;
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.readSeq++;
        this.host?.querySelector(':scope > .ez-translated-view')?.remove();
        this.host?.removeAttribute('data-ezclassify');
        this.host?.removeAttribute('data-ezclassify-incomplete');
        this.adoptedStyle?.release();
        this.adoptedStyle = null;
    }

    private async read(marking: string | Assertion[]): Promise<void> {
        const seq = ++this.readSeq;
        this.source = typeof marking === 'string' ? [] : marking;
        if (marking.length === 0) {
            this.showEmpty();
            return;
        }
        this.setStatus('pending');
        try {
            const envelope = await this.context.translate({
                crosswalkId: this.crosswalkId,
                marking,
            });
            if (seq !== this.readSeq || this.destroyed) return;
            if (typeof marking === 'string') {
                this.source = envelope.result.source.assertions;
            }
            this.showResult(envelope.result);
        } catch (error) {
            if (seq !== this.readSeq || this.destroyed) return;
            const message =
                error instanceof Error ? error.message : String(error);
            this.rendered = '';
            this.markingEl.textContent = '';
            this.markingEl.removeAttribute('aria-invalid');
            this.noteEl.textContent = `${t('translate.failed')} ${message}`;
            this.clearLists();
            this.setStatus('error');
        }
    }

    /** The empty view: nothing read, nothing to translate. */
    private showEmpty(): void {
        this.rendered = '';
        this.markingEl.textContent = EMPTY_VALUE;
        this.markingEl.removeAttribute('aria-invalid');
        this.noteEl.textContent = '';
        this.clearLists();
        this.setStatus('empty');
    }

    private showResult(result: CrosswalkTranslationResult): void {
        const labels = this.sourceLabels(result);
        this.clearLists();
        this.markingEl.removeAttribute('aria-invalid');

        if (result.status === 'forbidden') {
            this.rendered = '';
            this.markingEl.textContent = '';
            this.noteEl.textContent = t('translate.forbidden');
            for (const match of result.forbiddenBy) {
                const sources =
                    match.kind === 'mapping' ? [match.source] : match.sources;
                this.addItem(
                    sources.map(labels).join(', '),
                    'forbid',
                    match.reason,
                    match.guidance,
                );
            }
            this.setStatus('forbidden');
            return;
        }

        if (result.status === 'invalid-source') {
            this.rendered = '';
            this.markingEl.textContent = '';
            this.noteEl.textContent = t('translate.invalidSource');
            this.addErrors(result.source.errors);
            this.setStatus('invalid-source');
            return;
        }

        this.rendered = result.target.rendered;
        this.markingEl.textContent = this.rendered || EMPTY_VALUE;
        if (!result.target.valid) {
            this.markingEl.setAttribute('aria-invalid', 'true');
            this.noteEl.textContent = t('translate.targetInvalid');
            this.addErrors(result.target.errors);
        } else {
            this.noteEl.textContent = '';
        }
        const dropped = result.outcomes.filter(
            (
                o,
            ): o is CrosswalkOutcome & {
                disposition: Exclude<CrosswalkOutcome['disposition'], 'carry'>;
            } => o.disposition !== 'carry',
        );
        for (const outcome of dropped) {
            this.addItem(
                labels(outcome.source),
                outcome.disposition,
                outcome.reason,
                outcome.guidance,
            );
        }
        const droppedSelections = result.selections.filter(
            (
                s,
            ): s is CrosswalkSelectionOutcome & {
                disposition: Exclude<
                    CrosswalkSelectionOutcome['disposition'],
                    'carry'
                >;
            } => s.disposition !== 'carry',
        );
        for (const selection of droppedSelections) {
            this.addItem(
                '',
                selection.disposition,
                selection.reason,
                selection.guidance,
            );
        }
        this.listEl.setAttribute('aria-label', t('translate.notCarried'));
        this.notSelectedEl.setAttribute(
            'aria-label',
            t('translate.notSelected'),
        );
        this.setStatus(result.status);
    }

    /**
     * Name a source fact by the concept's name when the view's scheme (the one
     * `data-ezclassify-scheme` selects, or the Context's primary) is the
     * crosswalk's source scheme, and by its id otherwise.
     */
    private sourceLabels(
        result: CrosswalkTranslationResult,
    ): (ref: AssertionReference) => string {
        let concepts: ReadonlyMap<string, string> = new Map();
        try {
            const selector = this.options.schemeSelector;
            const scheme = (
                selector
                    ? this.context.schemes.get(selector)
                    : this.context.scheme
            ).getScheme();
            if (scheme.id === result.sourceScheme.id) {
                concepts = new Map(scheme.concepts.map((c) => [c.id, c.name]));
            }
        } catch {
            // A Context that cannot describe its scheme still shows ids.
        }
        return (ref) => {
            const name = concepts.get(ref.conceptId) ?? ref.conceptId;
            return ref.value ? `${name} (${ref.value})` : name;
        };
    }

    private addItem(
        label: string,
        disposition: Exclude<CrosswalkOutcome['disposition'], 'carry'>,
        reason: string,
        guidance?: string,
    ): void {
        const item = document.createElement('li');
        item.dataset.disposition = disposition;
        if (label) {
            const name = document.createElement('span');
            name.className = 'ez-translated-view__source';
            name.textContent = label;
            item.append(name, ' ');
        }
        const word = document.createElement('span');
        word.className = 'ez-translated-view__disposition';
        word.textContent = t(`translate.disposition.${disposition}`);
        item.append(word);
        const detail = [reason, guidance].filter(Boolean).join(' ');
        if (detail) item.append(`: ${detail}`);
        (disposition === 'not-selected'
            ? this.notSelectedEl
            : this.listEl
        ).append(item);
    }

    private clearLists(): void {
        this.listEl.replaceChildren();
        this.notSelectedEl.replaceChildren();
    }

    private addErrors(errors: readonly ValidationError[]): void {
        for (const error of errors) {
            const item = document.createElement('li');
            item.dataset.error = error.constraintId;
            item.textContent = error.message;
            this.listEl.append(item);
        }
    }

    private setStatus(status: TranslatedViewStatus): void {
        this.status = status;
        this.wrap.dataset.status = status;
        this.host.toggleAttribute('aria-busy', status === 'pending');
    }

    private build(): void {
        this.wrap = document.createElement('div');
        this.wrap.className = 'ez-translated-view';
        this.markingEl = document.createElement('span');
        this.markingEl.className = 'ez-translated-view__marking';
        this.noteEl = document.createElement('div');
        this.noteEl.className = 'ez-translated-view__note';
        this.listEl = document.createElement('ul');
        this.listEl.className = 'ez-translated-view__list';
        this.notSelectedEl = document.createElement('ul');
        this.notSelectedEl.className =
            'ez-translated-view__list ez-translated-view__not-selected';
        this.incompleteEl = document.createElement('div');
        this.incompleteEl.className =
            'ez-translated-view__note ez-translated-view__incomplete';
        this.wrap.append(
            this.markingEl,
            this.incompleteEl,
            this.noteEl,
            this.listEl,
            this.notSelectedEl,
        );
        this.host.replaceChildren(this.wrap);
        this.setIncomplete(this.incomplete);
    }

    private injectStyles(): void {
        if (this.options.injectStyles === false) return;
        const root = (this.options.root ??
            this.host.ownerDocument?.head ??
            document.head) as HTMLElement;
        this.adoptedStyle = adoptStyles(translatedViewCss, root);
    }
}
