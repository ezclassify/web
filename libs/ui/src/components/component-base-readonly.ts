/**
 * Lightweight base for read-only form components.
 *
 * Provides engine binding, assertion storage, category colors, progressive
 * enhancement of native inputs, and style injection, but no reprocessing,
 * suggestion fetching, or interactive editing methods. Read-only components
 * like AssertionCard and StatusBanner extend this instead of the full
 * ComponentBase, keeping their dependency surface minimal.
 */

import {
    type ContextAdapter,
    type RemoteContextSchemeEngineAdapter,
    type SchemeEngineAdapter,
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
import { findContext } from '../context-binding';
import type { FavoritesConfig } from './favorites-panel';
import type { EzClassifyState } from '../store/ezclassify-store';
import {
    NO_RULE_ERRORS,
    RuleErrorList,
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
import { getMountHost } from '../mount-host-registry';

/**
 * Engine binding accepted by every UI component.
 *
 * A {@link ContextAdapter} funnels scheme, guide, and access through one handle;
 * a bare {@link SchemeEngineAdapter} is the marking surface alone. Components
 * take either, and take it from whoever mounts them: the host injects a
 * concrete adapter, and nothing in this package knows or asks whether that
 * adapter runs in process or over HTTP.
 */
/** Scheme operations available to a component from either supported host mode. */
export type ComponentSchemeEngine =
    SchemeEngineAdapter | RemoteContextSchemeEngineAdapter;

export type ComponentEngineSource = ComponentSchemeEngine | ContextAdapter;

/**
 * The scheme an engine has marked as its default, when it has one.
 *
 * Only an adapter that manages a scheme registry has a default. A Context-bound
 * adapter has exactly one scheme, named by `getScheme()`, so it answers
 * `undefined` here and callers fall back to that.
 */
export function defaultSchemeOf(
    engine: ComponentSchemeEngine,
): { id: string } | null | undefined {
    return 'getDefaultScheme' in engine
        ? engine.getDefaultScheme?.()
        : undefined;
}

/**
 * Whether a scheme surface accepts an explicit scheme selector.
 *
 * Context-bound remote adapters deliberately omit composition lifecycle. That
 * omission is the capability boundary; `listSchemes` is only introspection and
 * must not be used as a proxy for addressed operations.
 */
export function isAddressableSchemeEngine(
    engine: ComponentSchemeEngine,
): engine is SchemeEngineAdapter {
    return 'loadScheme' in engine && typeof engine.loadScheme === 'function';
}

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
     * Render the UI into the container. Accepts a Context adapter or scheme
     * adapter. When the Context is omitted, the component looks for a
     * `[data-ezclassify-context]` ancestor on `container`.
     */
    init(
        container: HTMLDivElement,
        engineOrContext?: ComponentEngineSource | null,
        options?: ComponentOptions,
    ): void | Promise<void>;
    /** Get the current assertions */
    getAssertions(): Assertion[];
    /** Set assertions (replaces current state) */
    setAssertions(assertions: Assertion[]): void;
    /** Set the value from a marking string (reads it again and re-renders) */
    setValue(value: string): void;
    /** Clean up DOM and event listeners */
    destroy(): void;
    /** Get the rendered marking string */
    getRendered(): string;
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
    scope?: string;
    /**
     * Which loaded scheme id this component targets. Resolution order:
     * `data-ezclassify-scheme` attribute on container → this option → engine's
     * default-scheme slot → throw.
     */
    schemeId?: string;
    onChange?: (assertions: Assertion[], rendered: string) => void;
    /**
     * Id of the parent field that holds the complete marking this component is
     * one category facet of. When set, the component is treated as a facet of a
     * larger marking and does NOT render its own validation surface, the host
     * renders validation once against the parent marking. Wired from the
     * `data-ezclassify-facet-of` attribute on the host element.
     */
    facetOf?: string;
    /** Show the rendered string preview bar (default: false) */
    showPreview?: boolean;
    /**
     * False disables concept/detail hover tooltips. Wired from the
     * `data-ezclassify-no-tooltips` host/ancestor attribute. Guidance surfaces
     * only; validation display and core interaction are not configurable.
     * Default: enabled.
     */
    tooltips?: boolean;
    /**
     * False disables keyboard-hint chrome (hint footers and floating hint
     * chips). Wired from `data-ezclassify-no-hints`. The touch "Add marking"
     * affordance is core interaction, not a hint, and is never disabled.
     * Default: enabled.
     */
    hints?: boolean;
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
     * Groups with more items than this start collapsed in the dropdown (default
     * 50)
     */
    collapseThreshold?: number;
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
     * Host-fed favorites surface: a ★ button on the field chrome, next to the
     * status mark. Renders when this is supplied, OR when left unset but the
     * loaded scheme declares `labelPresets` for the field's scope: in that case
     * the panel still opens, read-only, showing just the scheme's own presets.
     * The component stores nothing; the host owns persistence and observes
     * applied favorites through the field's ordinary native/ezclassify events,
     * the same as any other user edit. See `favorites-panel.ts`.
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
export abstract class ReadOnlyComponentBase implements ComponentInstance {
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
    /**
     * Resolved scheme id for this component instance. Threaded into every
     * engine call.
     */
    protected schemeId!: string;
    protected container!: HTMLDivElement;
    protected options: ComponentOptions = {};
    protected assertions: Assertion[] = [];
    protected _lastRendered = '';
    protected formatId!: string;
    protected categoryColorMap = new Map<string, string>();
    protected categoryTextColorMap = new Map<string, string>();
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
    private ruleErrorList: RuleErrorList | null = null;
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
    /** See {@link setEditorOpen}. */
    private editorOpen = false;

    /**
     * Whether a validation error surface is currently visible below the
     * component. Field chrome that hangs off the bottom edge (the star drawer)
     * consults this to vacate the edge: a hint bar must never sit on top of an
     * error the user needs to read.
     */
    protected hasVisibleValidationErrors(): boolean {
        return (
            this.ruleErrorList !== null && !this.ruleErrorList.element.hidden
        );
    }
    /** The original <input> element being progressively enhanced (if any) */
    protected enhancedInput: HTMLInputElement | null = null;

    /** Whether calls from this component may include an explicit scheme id. */
    protected get schemeAddressing(): boolean {
        return this.context === null && isAddressableSchemeEngine(this.engine);
    }

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
        this.engine = resolveSchemeEngine(
            container,
            engineOrContext,
            componentLabel,
        );
        this.assertEngineCapabilities(componentLabel);
        this.context = resolveContextSource(container, engineOrContext);
        this.container = container;
        this.options = options ?? {};
        this.schemeId = resolveProfile(
            container,
            this.engine,
            options,
            this.schemeAddressing,
        );
        const addressScheme =
            this.context === null && isAddressableSchemeEngine(this.engine);
        this.scheme = addressScheme
            ? this.engine.getScheme(this.schemeId)
            : this.engine.getScheme();
        const schemeMeta = addressScheme
            ? this.engine.getSchemeMeta(this.schemeId)
            : this.engine.getSchemeMeta();
        this.schemeMeta = schemeMeta;
        this.formatId =
            options?.formatId ??
            (options?.holdsPart
                ? schemeMeta.defaultPartRenderFormat
                : undefined) ??
            this.resolveDefaultFormatId(schemeMeta);
        this.colorFrom = schemeMeta.colorFrom;
        this._resolveContext = options?.resolveContext;
        this._resolveParts = options?.resolveParts;

        // Inject default design tokens (no-op if already present)
        injectDefaultStyles(options?.root);

        // Mark container for scoped CSS variable inheritance
        container.setAttribute('data-ezclassify', '');

        // Apply color scheme preference.
        // "auto" (default): no attribute, inherits from the host via cascade.
        //   Dark variants kick in only when an ancestor sets .dark /
        //   [data-theme="dark"] / [data-bs-theme="dark"]. The library never
        //   reaches around the host to query the OS prefers-color-scheme.
        // "light"/"dark": forces a specific scheme via data-color-scheme attribute.
        const scheme = this.options.colorScheme ?? 'auto';
        if (scheme !== 'auto') {
            container.setAttribute('data-color-scheme', scheme);
        }

        // Apply opt-in input styling
        if (this.options.styleInputs) {
            container.classList.add('ez-styled-inputs');
        }

        // Build category→color lookup (custom categoryColors override defaults)
        const customColors = this.options.categoryColors;
        this.scheme.categories.forEach((f, i) => {
            if (customColors && customColors[f.id]) {
                this.categoryColorMap.set(f.id, customColors[f.id]);
            } else {
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

        // Apply theme CSS variables on the container
        if (this.options.theme && typeof this.options.theme === 'object') {
            for (const [prop, value] of Object.entries(this.options.theme)) {
                container.style.setProperty(prop, value);
            }
        }

        // Apply z-index overrides
        if (this.options.zIndex != null) {
            container.style.setProperty(
                '--ez-z-dropdown',
                String(this.options.zIndex),
            );
        }

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
        this.enhancedInput = host
            ? host.matches(inputSelector)
                ? (host as HTMLInputElement)
                : container.querySelector<HTMLInputElement>(inputSelector)
            : (container.querySelector<HTMLInputElement>(inputSelector) ??
              container.parentElement?.querySelector<HTMLInputElement>(
                  inputSelector,
              ) ??
              null);

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
                if (initialRead !== this.valueReadSeq) break;
                if (fromNative && this.enhancedInput!.value !== initialValue) {
                    initialValue = this.enhancedInput!.value;
                    continue;
                }
                this.assertions = initResult.assertions;
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

    getAssertions(): Assertion[] {
        return [...this.assertions];
    }

    setAssertions(assertions: Assertion[]): void {
        this.assertions = [...assertions];
        this.noteReading({});
        // Read-only: re-render via engine without reprocessing (no inference/constraints)
        const result = this.callRender(this.assertions, {
            format: this.formatId,
        });
        if ('rendered' in result) {
            this._lastRendered = result.rendered;
            this.onAssertionsChanged();
        } else {
            result.then(({ rendered }) => {
                this._lastRendered = rendered;
                this.onAssertionsChanged();
            });
        }
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
     */
    protected noteReading(
        reading: {
            recognition?: Pick<RecognitionResult, 'status' | 'unmatched'>;
            assessment?: { omitted: AssertionRef[] };
        },
        source?: string,
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
            if (seq !== this.valueReadSeq) return;
            // Nothing was read, so the marking the field holds stays as it
            // was and nothing is published; the field says why instead.
            this.failedRead = value;
            this.showReadFailure(error);
            return;
        }
        if (seq !== this.valueReadSeq) return;
        this.failedRead = null;
        this.assertions = result.assertions;
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
     * Engine.process shim. Threads `this.schemeId` when the adapter exposes
     * multi-profile introspection (`listSchemes`); falls back to the 2-arg form
     * so adapters predating multi-scheme support keep working without
     * modification.
     */
    protected callProcess(
        input: string | Assertion[],
        options?: ProcessOptions,
    ) {
        // Values taken from a whole are never sent back: the engine takes
        // them again from the whole this call supplies.
        const stated = withStatedAssertions(options);
        const withParts = partsOption(
            this._resolveParts,
            this.options.scope
                ? { ...stated, surface: this.options.scope }
                : stated,
        );
        const read =
            typeof input === 'string' ? input : withoutTakenFromWhole(input);
        if (this.schemeAddressing && isAddressableSchemeEngine(this.engine)) {
            return this.engine.process(read, this.schemeId, withParts);
        }
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
        if (this.schemeAddressing && isAddressableSchemeEngine(this.engine)) {
            return this.engine.validate(input, this.schemeId, withParts);
        }
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

    /** Engine.render shim: see callProcess for the rationale. */
    protected callRender(
        assertions: Assertion[],
        options?: { format?: string },
    ) {
        const format = options?.format;
        if (this.schemeAddressing && isAddressableSchemeEngine(this.engine)) {
            return this.engine.render(assertions, format, this.schemeId);
        }
        return this.engine.render(assertions, format);
    }

    /** Engine.suggest shim: see callProcess for the rationale. */
    protected callSuggest(
        input: string | Assertion[],
        options?: SuggestOptions,
    ) {
        const read =
            typeof input === 'string' ? input : withoutTakenFromWhole(input);
        if (this.schemeAddressing && isAddressableSchemeEngine(this.engine)) {
            return this.engine.suggest(read, this.schemeId, options);
        }
        return this.engine.suggest(read, options);
    }

    /** Engine.applyPreset shim: see callProcess for the rationale. */
    protected callApplyPreset(presetId: string, outputFormat?: string) {
        const options = outputFormat ? { outputFormat } : undefined;
        if (this.schemeAddressing && isAddressableSchemeEngine(this.engine)) {
            return this.engine.applyPreset(presetId, this.schemeId, options);
        }
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
        // marking. The host renders validation once at the parent field; a
        // facet view never carries a validation surface.
        this.showRuleErrors(
            this.options.facetOf
                ? NO_RULE_ERRORS
                : ruleErrorsFrom(errors, proposedFixes, warnings),
        );
    }

    /**
     * Show why the field's value could not be read, in place of its errors. The
     * message is the one the read raised, as plain text.
     */
    protected showReadFailure(error: unknown): void {
        this.showRuleErrors(
            this.options.facetOf ? NO_RULE_ERRORS : readFailureReport(error),
        );
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
        if (report.messages.length === 0 && report.warnings.length === 0) {
            this.ruleErrorList?.update(NO_RULE_ERRORS, null);
        } else {
            if (!this.ruleErrorList) {
                this.ruleErrorList = new RuleErrorList(
                    this.container.ownerDocument,
                    (pointerType) => this.focusAfterFix(pointerType),
                );
                this.ruleErrorList.setSuppressed(this.editorOpen);
            }
            this.placeRuleErrors();
            this.ruleErrorList.update(report, this.ruleFixHandler());
        }
        this.onRuleErrorsChanged();
    }

    /**
     * The field's editor opened or closed. While it is open its list carries
     * the field's report, so the list under the field steps aside and the field
     * shows one list.
     */
    protected setEditorOpen(open: boolean): void {
        if (this.editorOpen === open) return;
        this.editorOpen = open;
        this.ruleErrorList?.setSuppressed(open);
        this.onRuleErrorsChanged();
    }

    /**
     * The error list was just shown, changed or hidden. Field chrome that
     * shares the field's bottom edge with the list moves off it here.
     */
    protected onRuleErrorsChanged(): void {}

    /** Keep the error list directly after the field the user sees. */
    private placeRuleErrors(): void {
        if (!this.ruleErrorList) return;
        placeUnderField(
            this.ruleErrorList.element,
            getMountHost(this.container) ?? null,
            this.container.closest('[data-ezclassify-mount]') ?? this.container,
        );
    }

    /**
     * Take the rule-error list out of the document. It sits beside the field,
     * outside the mount container, so every component's destroy() calls this.
     */
    protected removeRuleErrors(): void {
        this.ruleErrorList?.remove();
        this.ruleErrorList = null;
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

    /** Change the color scheme at runtime. */
    setColorScheme(scheme: 'auto' | 'light' | 'dark'): void {
        if (scheme === 'auto') {
            this.container.removeAttribute('data-color-scheme');
        } else {
            this.container.setAttribute('data-color-scheme', scheme);
        }
    }

    abstract destroy(): void;
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
     * category in scope
     */
    protected resolveCategory(
        explicitId?: string,
        scope?: string,
    ): CategoryView | undefined {
        if (explicitId) {
            return this.scheme.categories.find((f) => f.id === explicitId);
        }
        let categories = this.scheme.categories;
        if (scope) {
            categories = categories.filter(
                (f) =>
                    !f.scopes ||
                    f.scopes.length === 0 ||
                    f.scopes.includes(scope),
            );
        }
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
 * Resolve which loaded scheme a component instance targets.
 *
 * Resolution order:
 *
 * 1. `data-ezclassify-scheme` attribute on the container (or its closest ancestor)
 * 2. `options.schemeId`
 * 3. The engine's default-scheme slot (`getDefaultScheme()?.id`)
 *
 * Throws with a useful message when no scheme is loaded, or when the engine has
 * multiple schemes loaded with no default set and no attribute/option
 * provided.
 *
 * When optional multi-scheme introspection is absent, the required `getScheme`
 * method names the adapter's bound scheme.
 */
export function resolveProfile(
    container: HTMLElement,
    engine: ComponentSchemeEngine,
    options?: { schemeId?: string },
    schemeAddressing = isAddressableSchemeEngine(engine),
): string {
    const attr =
        container.getAttribute('data-ezclassify-scheme') ??
        container
            .closest('[data-ezclassify-scheme]')
            ?.getAttribute('data-ezclassify-scheme');
    const requested = attr ?? options?.schemeId;
    if (typeof engine.getScheme !== 'function') {
        throw new Error('Scheme adapter must implement getScheme().');
    }
    if (!schemeAddressing) {
        const primary = engine.getScheme();
        if (requested && requested !== primary.id) {
            throw new Error(
                `Context-bound scheme operations target '${primary.id}'; '${requested}' cannot be selected from this adapter.`,
            );
        }
        return primary.id;
    }
    if (requested) return requested;

    const def = defaultSchemeOf(engine);
    if (def) return def.id;

    // The contract permits a bound adapter without listing methods.
    if (!('listSchemes' in engine) || !engine.listSchemes) {
        return engine.getScheme().id;
    }

    const loaded = engine.listSchemes();
    if (loaded.length === 0) {
        throw new Error(
            'Engine has no schemes loaded. Call engine.loadScheme(data) before mounting components.',
        );
    }
    if (loaded.length === 1) {
        return loaded[0].id;
    }
    throw new Error(
        `Engine has multiple schemes loaded (${loaded.map((p) => p.id).join(', ')}) with no default set; ` +
            `specify data-ezclassify-scheme attribute, options.schemeId, or call engine.setDefaultScheme(id).`,
    );
}

/**
 * Discover the engine adapter that backs a component instance.
 *
 * Resolution order:
 *
 * 1. Direct argument: a composed context contributes `ctx.scheme`, a bare scheme
 *    adapter is itself the answer.
 * 2. No argument: walk up `container` to find a `[data-ezclassify-context]`
 *    provider and pull `ctx.scheme` from the registered context.
 *
 * Throws when neither produces an engine.
 */
export function resolveSchemeEngine(
    container: HTMLElement,
    source: ComponentEngineSource | null | undefined,
    componentLabel: string,
): ComponentSchemeEngine {
    if (source) {
        return isComponentContextAdapter(source) ? source.scheme : source;
    }
    const ctx = findContext(container);
    if (ctx) {
        return ctx.scheme;
    }
    throw new Error(
        `[@ezclassify/ui] ${componentLabel}: no engine available. Pass an engine or context to init(), or wrap the container in an [data-ezclassify-context] provider.`,
    );
}

/**
 * Return the composed context the component was mounted with: directly via the
 * source argument or via an ancestor `[data-ezclassify-context]` provider.
 * Returns `null` when the source was a bare scheme adapter and no provider
 * exists; subclasses that need `ctx.guide` / `ctx.access` should handle that
 * case (typically: empty state).
 *
 * A directly injected bare scheme adapter is only paired with a discovered
 * context composed around that same adapter. Any other registered context would
 * give the component a guide and access surface belonging to a different
 * composition than the engine it renders from, and the mismatch would show as
 * wrong content rather than as an error.
 */
export function resolveContextSource(
    container: HTMLElement,
    source: ComponentEngineSource | null | undefined,
): ContextAdapter | null {
    if (source && isComponentContextAdapter(source)) return source;
    const discovered = findContext(container);
    if (!discovered) return null;
    if (source && discovered.scheme !== source) return null;
    return discovered;
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
