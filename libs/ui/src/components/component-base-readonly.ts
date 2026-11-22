/**
 * Lightweight base for read-only form components.
 *
 * Provides engine binding, assertion storage, category colors, progressive
 * enhancement of native inputs, and style injection, but no reprocessing,
 * suggestion fetching, or interactive editing methods. Read-only components
 * like StatusBanner extend this instead of the full ComponentBase, keeping
 * their dependency surface minimal.
 */

import { FieldComponentBase } from './field-component-base';
import {
    type ContextAdapter,
    type ContextSchemeEngineAdapter,
    type Assertion,
    type ConceptColor,
    type SchemePublicView,
    type CategoryView,
    type ValidationError,
    type ProcessingContext,
    type SchemeMetaView,
    type AssertionRef,
    type Change,
    type Fix,
    type ProcessResult,
    type RecognitionResult,
    type RenderAssessment,
    type ValidateResult,
    type Warning,
} from '@ezclassify/types';
import {
    withStatedAssertions,
    withoutTakenFromWhole,
} from '../assertion-identity';
import type {
    ProcessOptions,
    SuggestOptions,
    ValidateOptions,
} from '../adapter-options';
import { COMPONENT_CSS } from './component-utils';
import { revealClearOfPinned } from './composer/composer-placement';
import { injectDefaultStyles } from '../styles';
import { adoptStylesOnce } from '../styles/adopt';
import type { FavoritesConfig } from './favorites-panel';
import type { EzClassifyState } from '../store/ezclassify-store';
import {
    NO_RULE_ERRORS,
    placeUnderField,
    readFailureReport,
    ruleErrorsFrom,
    type RuleErrorReport,
} from './rule-errors';
import {
    acceptedValue,
    judgedAsHeld,
    unreadFragments,
    unreadRuns,
    type UnreadRun,
} from '../loaded-value';
import {
    renderViewRefusalMessages,
    renderViewRefused,
} from '../render-refusal';
import { getMountHost } from '../mount-host-registry';
import { schemeChangeWords, type ChangeWords } from './status-mark';
import type { MarkingUndo } from './marking-undo';
import { assertWritesScopes, viewOutputOf } from '../format-resolver';
import { categoriesByScope, listedScopesOf, scopeSetOf } from '../scopes';
import type { ConceptWriting, WritingField } from '../written-concept';
import {
    unwrittenFactLookup,
    writtenFactTest,
    type ShownForm,
    type UnwrittenFact,
    type WrittenFactTest,
} from '../written-facts';

/**
 * Scheme operations a component marks with: a Context's scheme view.
 *
 * The view is bound to one Context and its primary scheme, so no operation
 * takes a scheme selector. Nothing in this package knows or asks whether the
 * view runs in process or over HTTP.
 */
export type ComponentSchemeEngine = ContextSchemeEngineAdapter;

/**
 * What a component is mounted with: a Context, which also brings its guides and
 * access policy, or a Context's scheme view alone.
 */
export type ComponentEngineSource = ComponentSchemeEngine | ContextAdapter;

/** Narrow a component source to the composed Context surface. */
export function isComponentContextAdapter(
    source: ComponentEngineSource,
): source is ContextAdapter {
    return 'scheme' in source && typeof source.audit === 'function';
}

/** Component instance data shape. */
export interface ComponentInstance {
    /**
     * Reflect a canonical store result without discarding text that has no
     * assertion identity.
     */
    applyStoreState?(state: EzClassifyState): void;
    /** See {@link ReadOnlyComponentBase.refreshFacetRefusal}. */
    refreshFacetRefusal?(): void;
    /**
     * Use the undo of the store marking the field is bound to (see
     * marking-undo.ts). The runtime calls it once the field is wired.
     *
     * @internal
     */
    shareUndo?(undo: MarkingUndo): void;
    /**
     * The parts this field's whole marking covers changed. A field that judges
     * its whole against its parts (see `ComponentOptions.resolveParts`) reads
     * its current value again; others do nothing.
     */
    refreshParts?(): void;
    /**
     * The whole this field is a part of changed. The field reads its value
     * again against it, so what it shows about the whole (a warning that the
     * two could not be compared, say) follows the whole instead of staying as
     * it was. A field whose last read failed outright reads its value now, the
     * way a whole field does when its parts change (see `refreshParts`).
     */
    refreshWhole?(): void;
    /**
     * The marking an uncommitted draft reads to, or null when there is no draft
     * or it does not read completely. The runtime keeps it in the field's
     * marking host if the field is torn down mid-edit; typed text the engine
     * has not accepted is never kept.
     */
    pendingDraft?(): string | null;
    /**
     * The output a field that owns its marking writes it in, for a field that
     * writes its own marking text (MarkedInput). The store writes the marking's
     * `rendered` in the same output, so views read what the field shows.
     */
    writtenOutput?(): string;
    /**
     * Render the UI into the container, marking with the Context (or the
     * Context's scheme view) it is given. There is no other way to find one.
     */
    init(
        container: HTMLDivElement,
        engineOrContext?: ComponentEngineSource | null,
        options?: ComponentOptions,
    ): void | Promise<void>;
    /** Get the current assertions */
    getAssertions(): Assertion[];
    /** Set assertions (replaces current state) */
    setAssertions(assertions: Assertion[]): void | Promise<void>;
    /** Set the value from a marking string (reads it again and re-renders) */
    setValue(value: string): void;
    /** Clean up DOM and event listeners */
    destroy(): void;
    /** Get the rendered marking string */
    getRendered(): string;
    /**
     * Whether the engine read the value this field holds in full, so its facts
     * state all of it, with who stated each. A field holding text the engine
     * could not read says no: only its text keeps that text.
     *
     * @internal
     */
    readsWhole?(): boolean;
    /**
     * Whether this component authors a whole marking of its own that its parts
     * are checked against. Defaults to true. A container that only aggregates
     * the parts it owns (a marked-textarea whose parts name it as their parent)
     * sets this to false: the rollup still publishes its aggregate state, but
     * never offers it a whole-marking correction, since there is no authored
     * whole to correct and writing one into the container would replace its
     * body.
     */
    readonly authorsWhole?: boolean;
    /**
     * Whether this field judges its whole against the parts that name it (the
     * runtime gave it `resolveParts`). Such a field reports what the whole is
     * missing and offers the fixes itself, so the runtime adds no coverage
     * notice or correction action of its own beside it.
     */
    readonly coversParts?: boolean;
    /**
     * Update validation error display (called by forms layer when context
     * changes).
     */
    updateValidationErrors?(
        errors: ValidationError[],
        proposedFixes?: readonly Fix[],
        warnings?: readonly Warning[],
    ): void;
    /**
     * Apply allowable concept options pushed from the store's facet
     * subscription. Facet pickers (SingleSelect, CategorySelector,
     * CategoryChecklist) implement this to re-filter their visible concept list
     * without making a new suggest call themselves. Other components leave this
     * undefined.
     *
     * `null`: engine has no suggest; the component should show all concepts.
     * `[]`: engine ran; all concepts in this category are gated; show only
     * selected. Non-empty array, the engine-approved addable set for this
     * category.
     */
    applyAllowableOptions?(
        options: import('@ezclassify/types').Suggestion[] | null,
    ): void;
}

/** Options accepted by component operations. */
export interface ComponentOptions {
    formatId?: string;
    /**
     * The marking this field shows is a part of another marking. Set by the
     * runtime when the field's host, or the marking it is bound to, names a
     * whole in `data-ezclassify-part-of`. A field that names no `formatId` then
     * writes the scheme's part default, the format the store writes that part
     * in, instead of its own kind's default.
     */
    holdsPart?: boolean;
    categoryId?: string;
    /**
     * The one scope the field authors, as its surface: set only when
     * {@link scopes} names exactly one.
     */
    scope?: string;
    /**
     * The scope ids `data-ezclassify-scope` lists, in the order written. A
     * picker offers the categories of every listed scope, in the scheme's
     * declaration order. A text field writes them as one string when its format
     * writes them all, and refuses them at init when it does not. A field that
     * lists several is judged as the whole marking.
     */
    scopes?: readonly string[];
    onChange?: (assertions: Assertion[], rendered: string) => void;
    /**
     * Id of the parent field that holds the complete marking this component is
     * one category facet of. When set, the component is treated as a facet of a
     * larger marking and does NOT render its own validation surface, the host
     * renders validation once against the parent marking. Wired from the
     * `data-ezclassify-facet-of` attribute on the host element.
     */
    facetOf?: string;
    /** The store's current judgment on the whole this facet edits. @internal */
    resolveFacetJudgment?: () => EzClassifyState;
    /**
     * For a facet of a marking no field shows (a hidden host with only facets):
     * why that marking could not be written, when it could not. Nothing else on
     * the page can say so. Empty for a marking a field shows, which says so
     * itself, and for every facet but the first of its marking.
     */
    resolveFacetRefusal?: () => readonly string[];
    /** Show the rendered string preview bar (default: false) */
    showPreview?: boolean;
    /**
     * False disables concept/detail hover tooltips. Wired from the
     * `data-ezclassify-no-tooltips` host/ancestor attribute. Guidance surfaces
     * only; validation display and core interaction are not configurable.
     * Default: enabled.
     */
    tooltips?: boolean;
    /** For step-based UIs: which step to start on (0-based, default 0) */
    startStep?: number;
    /**
     * Initial marking string to parse into the component. If not set, the
     * component looks for a sibling/child <input> with a value.
     */
    initialValue?: string;
    /**
     * If false, skip injecting the `<style>` element. Call
     * `getComponentStyles()` to obtain the CSS string and inject it yourself.
     * Default: true.
     */
    injectStyles?: boolean;
    /**
     * Theme: a string name (reserved for future preset themes) or a
     * Record<string, string> of CSS variable overrides (e.g. {
     * '--ez-color-primary': '#ff0000' }). Applied on the container.
     */
    theme?: string | Record<string, string>;
    /**
     * Color scheme preference for the component.
     *
     * - "auto" (default): inherits theme from the host page via cascade. The
     *   component goes dark when an ancestor sets `[data-theme="dark"]`,
     *   `[data-bs-theme="dark"]`, or `.dark`; otherwise it stays light. The
     *   library never queries the OS `prefers-color-scheme` directly, that
     *   mapping is the host's responsibility (e.g. the website maps OS
     *   preference to `data-theme` at the document root).
     * - "light": forces light palette regardless of host theme.
     * - "dark": forces dark palette regardless of host theme.
     */
    colorScheme?: 'auto' | 'light' | 'dark';
    /**
     * When true, applies opinionated styling to native input elements (font,
     * color, background, border, padding, border-radius). Use this for
     * standalone deployments with no existing design system. When false
     * (default), native inputs inherit styling from the host page.
     */
    styleInputs?: boolean;
    /**
     * Base z-index for dropdown overlays. When set, overrides the
     * --ez-z-dropdown CSS variable.
     */
    zIndex?: number;
    /**
     * Custom category colors keyed by category ID. Overrides the default
     * palette.
     */
    categoryColors?: Record<string, string>;
    /**
     * Which category represents implementation status (consumed by the
     * framework/GRC components deferred from the 1.0 surface). If not provided,
     * auto-detects the category with `single: true`.
     */
    statusCategoryId?: string;
    /**
     * Map concept IDs to card colors for SingleSelect component. When provided,
     * cards matching a concept ID receive custom background, text, and optional
     * border colors.
     */
    colorMap?: Record<
        string,
        { background: string; text: string; border?: string }
    >;
    /** Placeholder text for the main input element rendered by the component. */
    placeholder?: string;
    /**
     * SingleSelect presentation. The default is the conventional dropdown;
     * cards are an explicit opt-in comparison surface.
     */
    mode?: 'dropdown' | 'cards';
    /**
     * Concept view property to use for labels in tooltips/rules (e.g.
     * 'bannerAbbreviation'). Falls back to concept name if the view is not
     * available.
     */
    tooltipConceptProperty?: string;
    /**
     * Root container for scoping DOM side-effects (tooltips, styles). When
     * provided, tooltips and injected styles are scoped to this element instead
     * of document.body/document.head, enabling clean coexistence with
     * framework-managed DOM trees.
     */
    root?: HTMLElement;
    /**
     * When false, tag-input chips are not category-colored: text and underline
     * use the field's own color. Declarative:
     * data-ezclassify-tags-color-coding. Defaults to true.
     */
    colorCoding?: boolean;
    /**
     * Returns the current ProcessingContext at call time. Set by forms layer
     * for part-of fields.
     */
    resolveContext?: () => ProcessingContext | undefined;
    /**
     * Returns, at call time, the current markings of the parts this field's
     * whole marking has to cover. Set by the runtime for a field bound to a
     * whole that other fields name with `data-ezclassify-part-of`. Each process
     * call then carries them as `parts`, so the engine judges the whole against
     * them and every fix it proposes lands no lower than the parts need. Blank
     * markings are left out; none at all sends no `parts`.
     */
    resolveParts?: () => readonly string[];
    /**
     * Returns, at call time, what the rest of the marking this facet belongs to
     * holds: the assertions of every category but the facet's own. Set by the
     * runtime for a `data-ezclassify-facet-of` field with a category. The
     * facet's composer judges its draft together with them, so what it shows is
     * true of the marking the draft would store into, not of the facet's
     * category on its own.
     */
    resolveFacetSiblings?: () => readonly Assertion[];
    /**
     * Host-fed Favorites in the branding button's tabbed tools. The tab is
     * available when this provider or scoped scheme presets are present.
     * Favorites use the complete associated store marking; persistence stays
     * with the host. Store subscriptions update every bound control through its
     * ordinary native and EzClassify events. See `favorites-panel.ts`.
     */
    favorites?: FavoritesConfig;
}

import {
    CATEGORY_BACKGROUND_COLORS,
    CATEGORY_BACKGROUND_TEXT_COLORS,
} from '../color-resolver';

/** Public category color palette (canonical values live in color-resolver). */
export const CATEGORY_COLORS = CATEGORY_BACKGROUND_COLORS;

/**
 * WCAG AA-compliant text colors paired with the palette (canonical values live
 * in color-resolver).
 */
export const CATEGORY_TEXT_COLORS = CATEGORY_BACKGROUND_TEXT_COLORS;

/**
 * Shared read-only foundation for form components that only display data (no
 * editing, inference, or suggestion logic).
 */
export abstract class ReadOnlyComponentBase
    extends FieldComponentBase
    implements ComponentInstance
{
    protected engine!: ComponentSchemeEngine;
    /**
     * The composed context, when the component was mounted with one. Subclasses
     * needing a sibling engine (guide / access) read it from here. `null` when
     * the source was a bare scheme adapter.
     */
    protected context: ContextAdapter | null = null;
    protected scheme!: SchemePublicView;
    /**
     * The scheme's metadata view, kept because it is the only place the
     * resolved render-format layout lives: category order, boundary text, and
     * the headings paired with the lists they head. Subclasses pass it to the
     * layout helpers rather than re-asking the adapter per render.
     */
    protected schemeMeta!: SchemeMetaView;
    /** Id of the scheme this component marks in: its Context's primary. */
    protected schemeId!: string;
    protected container!: HTMLDivElement;
    protected options: ComponentOptions = {};
    protected assertions: Assertion[] = [];
    protected _lastRendered = '';
    protected formatId!: string;
    protected categoryColorMap = new Map<string, string>();
    protected categoryTextColorMap = new Map<string, string>();
    private readonly categoryHueOffsets = new Map<string, number>();
    /**
     * Category ID that drives the marking's scheme-default display color.
     * Undefined in rule mode and when the scheme declares no authored colors.
     */
    protected colorFrom?: string;
    /**
     * Whole-marking display color as the adapter resolved it, from the last
     * read of the marking this component received. The runtime that owns the
     * scheme is the color authority: it applies whatever the scheme declares,
     * including the condition-list form of `render.color_from` that no public
     * scheme projection carries. Undefined until the first read answers, and
     * for schemes that declare no display color at all.
     */
    protected displayColor?: ConceptColor;
    private _resolveContext?: () => ProcessingContext | undefined;
    private _resolveParts?: () => readonly string[];
    /** Why the held marking cannot be submitted, independent of an open draft. */
    protected valueValidationMessage = '';
    /**
     * The value whose last read failed, or null after a read that answered. See
     * {@link ReadOnlyComponentBase.retryRead}.
     */
    protected failedRead: string | null = null;
    /**
     * Whether the held value is source text its last read did not resolve:
     * recognition left part of it unread, so the assertions do not stand for
     * all of it. A fully read value that breaks a rule, including a rule about
     * its relation to other fields, is resolved.
     */
    protected sourceUnresolved = false;
    /**
     * The text the engine could not read in the held value, one entry per
     * fragment, as its recognition of that value reports it.
     */
    protected unreadText: readonly string[] = [];
    /**
     * Where that text sits in the held value, by the offsets the engine's
     * recognition of the value gives, so the field can flag it there.
     */
    protected unreadSpans: readonly UnreadRun[] = [];
    /**
     * Facts of the held value that its rendering leaves out, from the render
     * assessment of the last reading: a scheme that suppresses a fact from
     * print still holds it.
     */
    protected unprinted: readonly AssertionRef[] = [];
    /**
     * The form the held value was last written in, and what writing it did,
     * from the last reading. See {@link writtenFact}.
     */
    private heldForm: ShownForm = {};
    /** See {@link setReportInField}. */
    private reportInField = false;

    /** The original <input> element being progressively enhanced (if any) */
    protected enhancedInput: HTMLInputElement | HTMLTextAreaElement | null =
        null;

    /**
     * Refuse an engine missing a capability this component needs, once, where
     * it binds. The base needs nothing beyond the adapter contract's reads.
     *
     * @param _componentLabel - Names the component in the error
     */
    protected assertEngineCapabilities(_componentLabel: string): void {}

    async init(
        container: HTMLDivElement,
        engineOrContext?: ComponentEngineSource | null,
        options?: ComponentOptions,
    ): Promise<void> {
        const componentLabel = this.constructor?.name ?? 'EzClassifyComponent';
        this.engine = resolveSchemeEngine(engineOrContext, componentLabel);
        this.assertEngineCapabilities(componentLabel);
        this.context = resolveContextSource(engineOrContext);
        this.container = container;
        this.options = options ?? {};
        this.schemeId = resolveProfile(this.engine);
        this.scheme = this.engine.getScheme();
        const schemeMeta = this.engine.getSchemeMeta();
        this.schemeMeta = schemeMeta;
        this.formatId =
            options?.formatId ??
            (options?.holdsPart
                ? schemeMeta.defaultPartRenderFormat
                : undefined) ??
            this.resolveDefaultFormatId(schemeMeta);
        // A text field writes the scopes it lists: in the format it names,
        // else the default output of the first of them, and several of them
        // only when that format writes every one of them in one string.
        // A lone `scope` is a list of one.
        const listed = listedScopesOf(options);
        if (this.writesScopesAsText() && listed.length > 0) {
            if (!options?.formatId)
                this.formatId = viewOutputOf(
                    schemeMeta,
                    listed,
                    !!options?.holdsPart,
                );
            assertWritesScopes(
                this.engine,
                this.scheme.categories,
                this.formatId,
                listed,
                componentLabel,
            );
        }
        this.colorFrom = schemeMeta.colorFrom;
        this._resolveContext = options?.resolveContext;
        this._resolveParts = options?.resolveParts;

        // Inject default design tokens (no-op if already present)
        injectDefaultStyles(options?.root);

        // Mark container for scoped CSS variable inheritance
        container.setAttribute('data-ezclassify', '');

        this.applyThemeTo(container);

        // Apply opt-in input styling
        if (this.options.styleInputs) {
            container.classList.add('ez-styled-inputs');
        }

        // Build category→color lookup (custom categoryColors override defaults)
        const customColors = this.options.categoryColors;
        this.categoryHueOffsets.clear();
        this.scheme.categories.forEach((f, i) => {
            if (customColors && customColors[f.id]) {
                this.categoryColorMap.set(f.id, customColors[f.id]);
            } else {
                // Space categories within 12° of the theme hue. Fractional
                // spacing keeps nearby indices apart without reshuffling them
                // when new categories are appended.
                const phase = ((0.5 + i * 0.61803398875) % 1) - 0.5;
                this.categoryHueOffsets.set(f.id, phase * 24);
                this.categoryColorMap.set(
                    f.id,
                    CATEGORY_COLORS[i % CATEGORY_COLORS.length],
                );
            }
            this.categoryTextColorMap.set(
                f.id,
                CATEGORY_TEXT_COLORS[i % CATEGORY_TEXT_COLORS.length],
            );
        });

        // Apply z-index overrides
        if (this.options.zIndex != null) {
            container.style.setProperty(
                '--ez-z-dropdown',
                String(this.options.zIndex),
            );
        }

        this.enhancedInput = this.nativeInputFor(container);

        // Determine initial value: explicit option > enhanced input > empty
        let initialValue = options?.initialValue ?? '';
        if (!initialValue && this.enhancedInput?.value) {
            initialValue = this.enhancedInput.value;
        }

        // Parse the initial value: skip the API call for empty strings. A read
        // that raises does not stop the field from mounting: it keeps the text
        // as given, shows the reason where its errors go, and reads again on
        // the next change that can make it answer (see retryRead).
        let initFailure: unknown = null;
        const initialRead = ++this.valueReadSeq;
        const fromNative =
            !options?.initialValue && this.enhancedInput !== null;
        while (initialValue) {
            try {
                const initResult = await this.readHeld(initialValue);
                if (this.abandoned) return;
                if (initialRead !== this.valueReadSeq) break;
                if (fromNative && this.enhancedInput!.value !== initialValue) {
                    initialValue = this.enhancedInput!.value;
                    continue;
                }
                this.assertions = this.heldFacts(initResult.assertions);
                this._lastRendered = acceptedValue(initialValue, initResult);
                this.noteReading(initResult, initialValue);
                this.recordAppliedFixes(initResult.appliedFixes ?? [], true);
                this.displayColor = initResult.displayColor;
                if (initResult.errors)
                    this.updateValidationErrors(
                        initResult.errors,
                        fixPathsOf(initResult),
                        initResult.warnings,
                    );
            } catch (error) {
                if (this.abandoned) return;
                if (initialRead !== this.valueReadSeq) break;
                if (fromNative && this.enhancedInput!.value !== initialValue) {
                    initialValue = this.enhancedInput!.value;
                    continue;
                }
                initFailure = error;
                this.failedRead = initialValue;
                this._lastRendered = initialValue;
            }
            break;
        }

        // A host can tear the field down while that read is in flight, as React's
        // StrictMode does on every mount. Building it now would leave a second
        // editor beside the one the next runtime makes.
        if (this.abandoned) return;
        this.setup();
        // Errors from the initial value arrived before setup() built the
        // field's own wrapper, so the list could only follow the mount then.
        if (initFailure !== null) this.showReadFailure(initFailure);
        this.placeRuleErrors();

        // Write the accepted value, retaining the exact source when it needs correction.
        if (this.enhancedInput) {
            this.enhancedInput.value = this._lastRendered;
        }
    }

    protected nativeInputFor(
        container: HTMLDivElement,
    ): HTMLInputElement | HTMLTextAreaElement | null {
        // Find the original input for progressive enhancement.
        // Only consider text/hidden inputs (not radios/checkboxes which belong to native fallback UI)
        const inputSelector =
            'input[type="text"], input[type="hidden"], input:not([type])';
        // A runtime-mounted controller binds exactly its registered host, or an
        // input inside its own container. The parent-wide search remains only
        // for a component mounted by hand with no registered host; under the
        // runtime it would bind the first input of a form whose fields share
        // one parent, and write this field's value into that other field.
        const host = getMountHost(container);
        return host
            ? host.matches(inputSelector)
                ? (host as HTMLInputElement)
                : host.matches(
                        'fieldset[data-ezclassify-controller="selector"], fieldset[data-ezclassify-controller="checklist"]',
                    )
                  ? host.querySelector<HTMLInputElement>('input[type="hidden"]')
                  : container.querySelector<HTMLInputElement>(inputSelector)
            : (container.querySelector<HTMLInputElement>(inputSelector) ??
                  container.parentElement?.querySelector<HTMLInputElement>(
                      inputSelector,
                  ) ??
                  null);
    }

    getAssertions(): Assertion[] {
        return [...this.assertions];
    }

    /**
     * The facts of a marking this field holds, whatever else the marking holds:
     * every fact, for a view. A picker holds those of its scope set (see
     * ComponentBase).
     *
     * @param assertions - The marking's facts, as the engine or a store gave
     *   them
     */
    protected heldFacts(assertions: readonly Assertion[]): Assertion[] {
        return [...assertions];
    }

    setAssertions(assertions: Assertion[]): void {
        this.assertions = [...assertions];
        this.noteReading({});
        // Read-only: re-render via engine without reprocessing (no inference/constraints)
        const result = this.callRender(this.assertions, {
            format: this.formatId,
        });
        // A refused write is the engine's marker, never the field's value. A
        // display has no way to say why, so it shows no marking rather than
        // the last one.
        const paint = (written: {
            rendered: string;
            assessment?: RenderAssessment;
        }) => {
            this._lastRendered = renderViewRefused(written)
                ? ''
                : written.rendered;
            this.onAssertionsChanged();
        };
        if ('rendered' in result) paint(result);
        else void result.then(paint);
    }

    /**
     * Keep what the engine's result says about the held value beyond its
     * assertions: the text it could not read, and the facts its rendering
     * leaves out. Call it once the held value is in place; the recognition is
     * of that value (see `judgedAsHeld`), so its spans are offsets into it.
     *
     * @param reading - The result, or `{}` for a value nobody read as text
     * @param source - The text read, for a text read. A text read without
     *   recognition proves nothing about that text, so it counts as unresolved;
     *   any other reading is resolved unless its recognition says otherwise.
     * @param form - The form the reading wrote the value in: the field's own
     *   output unless the reading came from elsewhere
     */
    protected noteReading(
        reading: {
            recognition?: Pick<RecognitionResult, 'status' | 'unmatched'>;
            assessment?: ShownForm['assessment'];
        },
        source?: string,
        form: Omit<ShownForm, 'assessment'> = { formatId: this.formatId },
    ): void {
        const status = reading.recognition?.status;
        this.sourceUnresolved =
            source !== undefined
                ? status !== 'complete'
                : status !== undefined && status !== 'complete';
        this.unreadText = unreadFragments(reading.recognition);
        this.unreadSpans = unreadRuns(
            reading.recognition,
            this._lastRendered.length,
        );
        this.unprinted = reading.assessment?.omitted ?? [];
        this.heldForm = { ...form, assessment: reading.assessment };
    }

    /**
     * Keep what writing the held value in `form` did, for a value whose reading
     * did not say (see {@link writtenFact}).
     */
    protected noteHeldForm(form: ShownForm): void {
        this.heldForm = form;
    }

    /**
     * The forms this field shows its marking in, each with what writing it did.
     * A field shows the one form its value is written in; one that writes its
     * marking in several forms names each.
     */
    protected shownForms(): ShownForm[] {
        return [this.heldForm];
    }

    /**
     * Whether the marking this field shows writes a fact, by the engine's
     * assessments of the forms it shows (see written-facts.ts). A fact the
     * marking holds but writes nowhere, such as a member collapsed into its
     * group's name, is not a value of the marking the author sees.
     */
    protected writtenFact(): WrittenFactTest {
        return writtenFactTest(
            this.shownForms(),
            this.scheme?.categories ?? [],
            this.schemeMeta ?? {},
        );
    }

    /**
     * Why the marking this field shows leaves out a fact it holds, by the same
     * assessments as {@link writtenFact}: the value it collapsed into, when it
     * collapsed. Undefined for a fact the marking writes.
     */
    protected unwrittenFact(): (
        ref: Pick<AssertionRef, 'categoryId' | 'conceptId'>,
    ) => UnwrittenFact | undefined {
        return unwrittenFactLookup(
            this.shownForms(),
            this.scheme?.categories ?? [],
            this.schemeMeta ?? {},
        );
    }

    /** Interactive subclasses retain fixes before rendering the processed value. */
    protected recordAppliedFixes(
        _fixes: readonly Change[],
        _reset = false,
    ): void {}

    private valueReadSeq = 0;

    /** A reflected marking supersedes a read started by this view. */
    protected invalidateValueRead(): void {
        ++this.valueReadSeq;
    }

    async setValue(value: string): Promise<void> {
        const seq = ++this.valueReadSeq;
        // Preserve explanations for an echo of the corrected value, but never
        // carry them into a replacement marking (preset, favorite, or host edit).
        const replacesValue = value !== this._lastRendered;
        if (!value) {
            this.failedRead = null;
            this.noteReading({});
            this.assertions = [];
            this._lastRendered = '';
            this.displayColor = undefined;
            this.recordAppliedFixes([], true);
            this.updateValidationErrors([]);
            this.onAssertionsChanged();
            return;
        }
        let result: ValidateResult | ProcessResult;
        try {
            result = await this.readHeld(value);
        } catch (error) {
            // A field torn down while its value was read has nothing to show.
            if (seq !== this.valueReadSeq || this.abandoned) return;
            // Nothing was read, so the marking the field holds stays as it
            // was and nothing is published; the field says why instead.
            this.failedRead = value;
            this.showReadFailure(error);
            return;
        }
        // Nor does it publish what the read found: its runtime, and the
        // Context it read through, may be gone already.
        if (seq !== this.valueReadSeq || this.abandoned) return;
        this.failedRead = null;
        this.assertions = this.heldFacts(result.assertions);
        this._lastRendered = acceptedValue(value, result);
        this.noteReading(result, value);
        this.displayColor = result.displayColor;
        this.recordAppliedFixes(result.appliedFixes ?? [], replacesValue);
        if (result.errors)
            this.updateValidationErrors(
                result.errors,
                fixPathsOf(result),
                result.warnings,
            );
        this.onAssertionsChanged();
    }

    /**
     * Read the value whose last read failed again. Does nothing after a read
     * that answered.
     */
    protected retryRead(): void {
        if (this.failedRead === null) return;
        void this.setValue(this.failedRead);
    }

    /** Whether the field's last read of its own value failed. */
    protected get readFailed(): boolean {
        return this.failedRead !== null;
    }

    /**
     * Engine.process with what every call from this field carries: its scope as
     * the surface, the parts a whole must cover, and only the facts the field
     * states (facts taken from a whole go back through the whole).
     */
    protected callProcess(
        input: string | Assertion[],
        options?: ProcessOptions,
        includeParts = true,
    ) {
        return this.processInput(
            input,
            this.options.scope
                ? { ...options, surface: this.options.scope }
                : options,
            includeParts,
        );
    }

    /** Prove a complete marking in the engine's automatic whole output. */
    protected callWholeProcess(assertions: readonly Assertion[]) {
        return this.processInput('', {
            assertions: [...assertions],
            context: this.getProcessingContext(),
        });
    }

    private processInput(
        input: string | Assertion[],
        options?: ProcessOptions,
        includeParts = true,
    ) {
        // Values taken from a whole are never sent back: the engine takes
        // them again from the whole this call supplies.
        const stated = withStatedAssertions(options);
        const withParts = includeParts
            ? partsOption(this._resolveParts, stated)
            : stated;
        const read =
            typeof input === 'string' ? input : withoutTakenFromWhole(input);
        return this.engine.process(read, withParts);
    }

    /**
     * Engine.validate shim, addressed and scoped like {@link callProcess}: the
     * reader's call, which settles the marking the same way and proves no fix
     * paths.
     */
    protected callValidate(input: string, options?: ValidateOptions) {
        const withParts = partsOption(
            this._resolveParts,
            this.options.scope
                ? { ...options, surface: this.options.scope }
                : options,
        );
        return this.engine.validate(input, withParts);
    }

    /**
     * Read the field's value from a string. A read-only component displays the
     * marking, so this is the reader's call: no fix paths, since it has no way
     * to apply one. An editable component overrides it with the author's call.
     */
    protected readValue(
        value: string,
    ): Promise<ValidateResult | ProcessResult> {
        return Promise.resolve(
            this.callValidate(value, {
                outputFormat: this.formatId,
                context: this.getProcessingContext(),
            }),
        );
    }

    /**
     * Read the field's value from a string and judge the value the engine
     * settles on (see `judgedAsHeld`): the errors and ways to fix the field
     * shows are about what it holds, not about the text it was given.
     */
    protected readHeld(value: string): Promise<ValidateResult | ProcessResult> {
        return Promise.resolve(
            judgedAsHeld<ValidateResult | ProcessResult>(
                value,
                this.readValue(value),
                (settled) => this.readValue(settled.rendered),
            ),
        );
    }

    /**
     * Whether this field judges its whole against the parts supplied by
     * `resolveParts`.
     */
    get coversParts(): boolean {
        return this._resolveParts !== undefined;
    }

    /** Whether the parts this field covers have any marking right now. */
    protected get partsMarked(): boolean {
        return (this._resolveParts?.() ?? []).some((part) => part.trim());
    }

    /** Engine.render in the given format. */
    protected callRender(
        assertions: Assertion[],
        options?: { format?: string },
    ) {
        return this.engine.render(assertions, options?.format);
    }

    /** Engine.suggest, with only the facts the field states. */
    protected callSuggest(
        input: string | Assertion[],
        options?: SuggestOptions,
    ) {
        const read =
            typeof input === 'string' ? input : withoutTakenFromWhole(input);
        return this.engine.suggest(read, options);
    }

    /** Engine.applyPreset, in the given output format. */
    protected callApplyPreset(presetId: string, outputFormat?: string) {
        const options = outputFormat ? { outputFormat } : undefined;
        return this.engine.applyPreset(presetId, options);
    }

    getRendered(): string {
        return this._lastRendered;
    }

    /**
     * Get the current processing context (resolved at call time for fresh whole
     * value).
     */
    protected getProcessingContext(): ProcessingContext | undefined {
        return this._resolveContext?.();
    }

    /**
     * Show the engine errors for the component's current value directly under
     * the field, then a button for every way to fix the marking the engine
     * proposed (see rule-errors.ts). Every engine error is reported.
     *
     * @param errors - `ProcessResult.errors` for the current value
     * @param proposedFixes - `ProcessResult.proposedFixes` from the same result
     */
    updateValidationErrors(
        errors: ValidationError[],
        proposedFixes: readonly Fix[] = [],
        warnings: readonly Warning[] = [],
    ): void {
        // Facet-of: this component renders one category slice of a larger
        // marking. Its report policy decides which judgments belong beside
        // that slice; the default leaves them with the parent field.
        this.showRuleErrors(
            this.options.facetOf
                ? this.facetReport(errors, proposedFixes, warnings)
                : ruleErrorsFrom(errors, proposedFixes, warnings),
        );
    }

    /**
     * Show why the field's value could not be read, in place of its errors. The
     * message is the one the read raised, as plain text.
     */
    protected showReadFailure(error: unknown): void {
        this.showRuleErrors(
            this.options.facetOf
                ? this.facetReport()
                : readFailureReport(error),
        );
    }

    /**
     * Show why the field's marking could not be written, after the engine's
     * errors for it. A refused write is the engine's opaque marker, so the
     * field keeps the value it holds and says why here (see
     * render-refusal.ts).
     *
     * @param write - The refused write
     * @param errors - The engine's errors from the same result
     * @param proposedFixes - The ways to fix from the same result
     * @param warnings - The warnings from the same result
     */
    protected showRenderRefusal(
        write: { assessment?: RenderAssessment },
        errors: readonly ValidationError[] = [],
        proposedFixes: readonly Fix[] = [],
        warnings: readonly Warning[] = [],
    ): void {
        if (this.options.facetOf) {
            this.showRuleErrors(
                this.facetReport(
                    errors.length > 0 ? errors : undefined,
                    proposedFixes,
                    warnings,
                ),
            );
            return;
        }
        const report = ruleErrorsFrom(errors, proposedFixes, warnings);
        this.showRuleErrors({
            ...report,
            messages: [
                ...report.messages,
                ...renderViewRefusalMessages(this.formatId, write),
            ],
        });
    }

    /**
     * The store committed the marking this facet is a slice of. Whether that
     * marking could be written is not in the facet's slice, so the facet asks
     * again.
     */
    refreshFacetRefusal(): void {
        if (this.options.facetOf) this.showRuleErrors(this.facetReport());
    }

    /** Report the whole's errors that the runtime associates with this facet. */
    protected facetReport(
        _errors?: readonly ValidationError[],
        _proposedFixes: readonly Fix[] = [],
        _warnings: readonly Warning[] = [],
    ): RuleErrorReport {
        const messages = this.options.resolveFacetRefusal?.() ?? [];
        const state = this.options.resolveFacetJudgment?.();
        const category = this.options.categoryId;
        if (!state || !category)
            return messages.length > 0
                ? { ...NO_RULE_ERRORS, messages: [...messages] }
                : NO_RULE_ERRORS;

        const localConcepts = new Set(
            this.scheme.concepts
                .filter((concept) => concept.categories.includes(category))
                .map(({ id }) => id),
        );
        const fixes = state.proposedFixes ?? [];
        const fixesTouchFacet = fixes.some((fix) =>
            [...fix.adds, ...fix.removes].some(
                (ref) => ref.categoryId === category,
            ),
        );
        const errors = state.errors.filter(
            (error) =>
                error.categoryId === category ||
                error.affectedConcepts?.some((id) => localConcepts.has(id)) ||
                // With one error, a runtime fix touching this category
                // identifies it as another place the author can resolve it.
                (state.errors.length === 1 && fixesTouchFacet),
        );
        const report = ruleErrorsFrom(errors, fixes);
        return {
            ...report,
            messages: [...new Set([...report.messages, ...messages])],
        };
    }

    private showRuleErrors(report: RuleErrorReport): void {
        this.valueValidationMessage = report.messages.join(' ');
        // A warning never makes the field invalid; it has its own marker.
        this.container.toggleAttribute(
            'data-ezclassify-invalid',
            report.messages.length > 0,
        );
        this.container.toggleAttribute(
            'data-ezclassify-warning',
            report.warnings.length > 0,
        );
        this.updateFieldReport(
            this.container.ownerDocument,
            report,
            () => this.placeRuleErrors(),
            (pointerType) => this.focusAfterFix(pointerType),
            this.ruleFixHandler(),
        );
        this.onRuleErrorsChanged();
    }

    /**
     * Whether the field carries its report itself: an open editor's own list,
     * or a compact control's error count at rest. While it does, the list under
     * the field steps aside, so the field shows the report once.
     */
    protected setReportInField(inField: boolean): void {
        if (this.reportInField === inField) return;
        this.reportInField = inField;
        this.suppressFieldReport(inField);
        this.onRuleErrorsChanged();
    }

    /**
     * The error list was just shown, changed or hidden. Field chrome that
     * shares the field's bottom edge with the list moves off it here.
     */
    protected onRuleErrorsChanged(): void {}

    private placeRuleErrors(): void {
        if (!this.ruleErrorList) return;
        placeUnderField(
            this.ruleErrorList.element,
            getMountHost(this.container) ?? null,
            this.container.closest('[data-ezclassify-mount]') ?? this.container,
        );
    }

    /**
     * Restore the field's place after a fix. Keyboard activation returns to the
     * editable control; pointer activation parks on its box without reopening
     * it. Components whose editor lives outside the mount override this.
     */
    protected focusAfterFix(pointerType?: string): void {
        const target = this.container.querySelector<HTMLElement>(
            'input, textarea, select, button',
        );
        if (target) returnToField(target, this.container, pointerType);
    }

    /**
     * What pressing a fix does. A read-only component cannot change its value,
     * so it shows the message without buttons; an editable one overrides this.
     */
    protected ruleFixHandler(): ((fix: Fix) => void) | null {
        return null;
    }

    /** Apply a component's theme to a surface that may sit beside its mount. */
    protected applyThemeTo(surface: HTMLElement): void {
        const scheme = this.options.colorScheme;
        if (scheme && scheme !== 'auto')
            surface.setAttribute('data-color-scheme', scheme);
        const theme = this.options.theme;
        if (theme && typeof theme === 'object') {
            for (const [name, value] of Object.entries(theme))
                surface.style.setProperty(name, value);
        }
    }

    /** Change the color scheme at runtime. */
    setColorScheme(scheme: 'auto' | 'light' | 'dark'): void {
        if (scheme === 'auto') {
            this.container.removeAttribute('data-color-scheme');
        } else {
            this.container.setAttribute('data-color-scheme', scheme);
        }
    }

    abstract destroy(): void;

    /**
     * Whether the component has been destroyed; a field with live state says
     * so.
     */
    protected get abandoned(): boolean {
        return false;
    }
    protected abstract setup(): void;
    protected abstract render(): void;

    /**
     * Adopt shared + component-specific CSS onto the root this component is
     * mounted in (no-op if injectStyles is false).
     *
     * These sheets are adopted for the lifetime of the root, the same way the
     * old `<style>` element applied document-wide wherever it was appended. One
     * sheet is built per distinct CSS text, so a hundred instances of a
     * component share one sheet.
     */
    protected injectComponentStyles(componentCss: string): void {
        if (this.options.injectStyles === false) return;
        adoptStylesOnce(COMPONENT_CSS + componentCss, this.container);
    }

    /** Create a preview bar element with proper ARIA attributes */
    protected createPreviewBar(): HTMLDivElement {
        const preview = document.createElement('div');
        preview.className = 'proto-preview';
        preview.setAttribute('role', 'status');
        preview.setAttribute('aria-label', 'Current marking preview');
        preview.setAttribute('aria-live', 'polite');
        if (this.options.showPreview) {
            this.container.appendChild(preview);
        }
        return preview;
    }

    /**
     * Resolve a category by explicit ID, or find the first single-select
     * category in scope. The categories of the listed scopes are searched scope
     * by scope in the scheme's declaration order; a category that declares no
     * scope belongs to the default scope. A lone `scope` is a list of one, so a
     * host gets the same category whether it names its scope as a list or not.
     *
     * @param explicitId - The category the host names, if any
     * @param scope - The one scope the host names, when it gives no list
     * @param scopes - The scopes the host lists
     * @returns The category, or undefined when none is in the named scopes
     */
    protected resolveCategory(
        explicitId?: string,
        scope?: string,
        scopes?: readonly string[],
    ): CategoryView | undefined {
        if (explicitId) {
            return this.scheme.categories.find((f) => f.id === explicitId);
        }
        const listed = scopes?.length ? scopes : scope ? [scope] : [];
        const categories =
            listed.length > 0
                ? categoriesByScope(
                      this.scheme.categories,
                      listed,
                      this.schemeMeta,
                  ).flatMap((group) => group.categories)
                : this.scheme.categories;
        const single = categories.find((f) => f.single);
        return single || categories[0];
    }

    /**
     * Get a short description for a concept (definition > description view >
     * name). Subclasses may accept an additional categoryId to scope lookups
     * when the concept appears in multiple categories.
     */
    protected getConceptDescription(
        conceptId: string,
        _categoryId?: string,
    ): string {
        const concept = this.scheme.concepts.find((c) => c.id === conceptId);
        if (!concept) return '';
        if (concept.definition) return concept.definition;
        if (concept.views['description']) return concept.views['description'];
        const defaultView = concept.views['default'] ?? '';
        if (concept.name && concept.name !== defaultView) return concept.name;
        return '';
    }

    /**
     * Return the default format ID when no explicit formatId option is provided
     * and the field does not hold a part (see
     * {@link ComponentOptions.holdsPart}). Subclasses override to pick the
     * scheme's part-role or whole-role default instead of the single overall
     * default.
     */
    protected resolveDefaultFormatId(meta: SchemeMetaView): string {
        return meta.defaultRenderFormat ?? '';
    }

    /**
     * Whether the component shows its marking as one string, as a text field or
     * a banner does. Such a component writes every scope it lists in that one
     * string, so it is refused when its format cannot (see
     * `assertWritesScopes`). A picker offers each listed scope's categories
     * instead and answers false.
     */
    protected writesScopesAsText(): boolean {
        return false;
    }

    protected onAssertionsChanged(): void {
        this.render();
        // When onChange is set, the caller handles writing to the correct native element.
        // Otherwise, sync directly to the enhanced input (standalone component usage).
        if (this.options.onChange) {
            this.options.onChange(this.getAssertions(), this._lastRendered);
        } else if (
            this.enhancedInput &&
            this.enhancedInput.value !== this._lastRendered
        ) {
            this.enhancedInput.value = this._lastRendered;
            this.enhancedInput.dispatchEvent(
                new Event('input', { bubbles: true }),
            );
        }
    }

    /**
     * Whether the written marking prints a token's value: false for a value the
     * render assessment says it leaves out.
     */
    protected printsToken(node: {
        categoryId: string;
        conceptId?: string;
    }): boolean {
        return !this.unprinted.some(
            (ref) =>
                ref.categoryId === node.categoryId &&
                ref.conceptId === node.conceptId,
        );
    }

    /**
     * What this field writes, for naming its concepts the way it writes them:
     * its format, its role and the scopes it writes.
     */
    protected writingField(): WritingField {
        return {
            formatId: this.formatId,
            part: !!this.options.holdsPart,
            scopes: scopeSetOf(listedScopesOf(this.options), this.schemeMeta),
        };
    }

    /** This field and its scheme, once the scheme has loaded. */
    protected conceptWriting(): ConceptWriting | undefined {
        if (!this.scheme || !this.schemeMeta) return undefined;
        return {
            scheme: this.scheme,
            meta: this.schemeMeta,
            field: this.writingField(),
        };
    }

    /**
     * How the status mark names values and categories: a value the way this
     * field writes its concept, a category by its label.
     */
    protected changeWords(): ChangeWords {
        return schemeChangeWords(() => this.conceptWriting());
    }

    protected categoryHueOffset(categoryId: string): number | undefined {
        return this.categoryHueOffsets.get(categoryId);
    }

    /** Get the color for a category */
    protected getCategoryColor(categoryId: string): string {
        return this.categoryColorMap.get(categoryId) ?? '#666';
    }

    /** Get the WCAG AA-compliant text color for a category */
    protected getCategoryTextColor(categoryId: string): string {
        return this.categoryTextColorMap.get(categoryId) ?? '#444';
    }
}

/**
 * The id of the scheme a component marks in: its scheme view's, which is the
 * Context's primary scheme.
 *
 * Which Context and which of its schemes an element marks with is markup the
 * runtime reads (`data-ezclassify-context`, `data-ezclassify-scheme`; see
 * `context-binding.ts`) before it mounts the component. A component mounted
 * directly is handed its Context by the host and reads neither attribute.
 *
 * @param engine - The component's scheme view
 * @throws Error when the view cannot name its scheme
 */
export function resolveProfile(engine: ComponentSchemeEngine): string {
    if (typeof engine?.getScheme !== 'function') {
        throw new Error('A Context scheme view must implement getScheme().');
    }
    return engine.getScheme().id;
}

/**
 * The scheme view behind what a component was mounted with: a Context's
 * `scheme`, or the view itself.
 *
 * @param source - What the host or runtime mounted the component with
 * @param componentLabel - Names the component in the error
 * @throws Error when nothing was supplied
 */
export function resolveSchemeEngine(
    source: ComponentEngineSource | null | undefined,
    componentLabel: string,
): ComponentSchemeEngine {
    if (source) {
        return isComponentContextAdapter(source) ? source.scheme : source;
    }
    throw new Error(
        `[@ezclassify/ui] ${componentLabel}: no Context available. Mount it through EzClassifyUI, or pass a Context to init().`,
    );
}

/**
 * The Context a component was mounted with, or `null` when it was given a
 * scheme view alone. Components that need `guide` or `access` show their empty
 * state then.
 *
 * @param source - What the host or runtime mounted the component with
 */
export function resolveContextSource(
    source: ComponentEngineSource | null | undefined,
): ContextAdapter | null {
    return source && isComponentContextAdapter(source) ? source : null;
}

/**
 * The fix paths a read offers: a process result's proven ones, and none from
 * the reader's call, which proves none.
 */
function fixPathsOf(result: ValidateResult | ProcessResult): readonly Fix[] {
    return 'proposedFixes' in result ? result.proposedFixes : [];
}

/**
 * `options` with the parts a whole must cover added as `parts`, or `options`
 * unchanged when there are none (no resolver, or every part blank).
 *
 * @param resolveParts - The field's part resolver, if it is a whole
 * @param options - The process or validate options the call would send anyway
 */
export function partsOption<T extends object>(
    resolveParts: (() => readonly string[]) | undefined,
    options: T | undefined,
): T | (T & { parts: string[] }) | undefined {
    const parts = (resolveParts?.() ?? []).filter((part) => part.trim());
    if (parts.length === 0) return options;
    return { ...(options ?? ({} as T)), parts };
}

/**
 * Put focus back on a field after a fix pressed under it, and keep the field in
 * view: the error list it answered shrinks away beneath it, which can move the
 * page. Focus goes without scrolling, then the field's own box is brought into
 * view only as far as needed, once the list has settled.
 *
 * @param input - The field's editable surface
 * @param box - The field's visible box
 * @param pointerType - Pointer repairs park focus on the box instead of
 *   reopening the editor; keyboard activation returns to the editable surface
 */
export function returnToField(
    input: HTMLElement,
    box: HTMLElement,
    pointerType?: string,
): void {
    if (
        (pointerType === 'mouse' ||
            pointerType === 'touch' ||
            pointerType === 'pen') &&
        input.ownerDocument.activeElement !== input
    ) {
        const borrowed = !box.hasAttribute('tabindex');
        if (borrowed) box.tabIndex = -1;
        box.focus({ preventScroll: true });
        if (borrowed) {
            if (box.ownerDocument.activeElement !== box)
                box.removeAttribute('tabindex');
            else
                box.addEventListener(
                    'blur',
                    () => box.removeAttribute('tabindex'),
                    { once: true },
                );
        }
    } else input.focus({ preventScroll: true });
    const view = box.ownerDocument.defaultView;
    const keep = () => revealClearOfPinned(box);
    if (view?.requestAnimationFrame) view.requestAnimationFrame(keep);
    else keep();
}
