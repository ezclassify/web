/**
 * StatusBanner Component
 *
 * A full-width colored banner for displaying marking status. Three modes:
 *
 * Full-marking mode (default, no options): Shows the complete rendered marking
 * from the bound source or aggregate, in the marking's authority color. This is
 * the classic top-of-document banner.
 *
 * Single-concept mode (`categoryId` provided): Shows the name of the bound
 * assertion's concept in that category. Use it when a surface narrows to one
 * facet, such as a level chip.
 *
 * Boundary mode (any of `affix`, `boundary`, or `showCurrentData: true`): Shows
 * a structured banner with an optional static boundary line ("Boundary: TIER
 * 3") and an optional dynamic current-data line ("Current: TIER 2"). Either or
 * both may be shown independently.
 *
 * Over-boundary detection: when both a boundary and current data are present,
 * the engine's checkCoverage() call determines whether the boundary covers the
 * current data. A boundary says who the surface is open to, so the data is over
 * it both when it needs more than the boundary carries (a higher level) and
 * when the boundary carries more than the data allows (a release list broader
 * than the data's). Over the boundary, the banner switches to `role=alert` and
 * applies high-visibility styling.
 *
 * Display nouns: every word this component prints comes from the scheme's
 * vocabulary through `resolveVocabulary` and `roleNoun`, with a product noun
 * where the scheme declares none. A deployment that calls its boundary an
 * accreditation and its over-boundary state a spillage says so in the scheme or
 * in the host's options; a domain-neutral component never compiles one domain's
 * words in as its defaults.
 *
 * Affix support: Setting `affix: 'top'` or `affix: 'bottom'` (via
 * `data-ezclassify-banner-affix`) makes the banner `position: fixed`. The page
 * is responsible for adding matching body padding (e.g. `body { padding-top:
 * 2.5rem }` for a top-affixed compact banner) so the fixed banner does not
 * overlap content.
 *
 * Color palette: Banner colors come from CATEGORY_BACKGROUND_COLORS /
 * CATEGORY_BACKGROUND_TEXT_COLORS: fixed hex values injected as inline
 * --ez-banner-bg / --ez-banner-text custom properties. This is intentional: the
 * level-color convention (yellow for State Assessment Staff, red for Secret,
 * etc.) is part of the marking's semantic meaning and must not shift with the
 * host's light/dark preference. Colors are the same in light and dark mode by
 * design. Consumers who need a different palette pass `colorMap` (concept-id →
 * {background, text}).
 *
 * Over-boundary styling uses --ez-banner-over-boundary-bg /
 * --ez-banner-over-boundary-text (defaulting to #7f1d1d / #fef2f2, ~5.6:1
 * contrast) so air-gap deployments with custom branding can override the
 * indicator without forking the component.
 */

import {
    isAddressableSchemeEngine,
    ReadOnlyComponentBase,
    type ComponentOptions,
    type ComponentEngineSource,
} from './component-base-readonly';
import {
    resolveVocabulary,
    roleNoun,
    type SchemeMetaView,
    type ValidationError,
} from '@ezclassify/types';
import { resolveMarkingColor } from '../color-resolver';
import { EMPTY_VALUE } from '../text-utils';
import { t } from '../i18n';
import statusBannerCss from './status-banner.css?inline';

const STATUS_BANNER_CSS: string = statusBannerCss;

/**
 * The banner's own display nouns, in product vocabulary. A scheme renames any
 * of them through its `vocabulary` map under these keys, exactly as it renames
 * the whole and part roles.
 */
const BANNER_TERMS: Record<string, { singular: string; plural: string }> = {
    boundary: { singular: 'Boundary', plural: 'Boundaries' },
    current: { singular: 'Current', plural: 'Current' },
    overBoundary: { singular: 'Over boundary', plural: 'Over boundary' },
};

/** Background and text color pair used to style the banner for a given concept. */
export interface StatusBannerColors {
    background: string;
    text: string;
}

/** Options accepted by StatusBanner. */
export interface StatusBannerOptions extends ComponentOptions {
    /**
     * Providing a category switches the banner to single-concept mode: the
     * banner shows the bound assertion's concept in this category instead of
     * the full rendered marking. In boundary mode, also used for color
     * resolution.
     */
    categoryId?: string;
    /**
     * Concept-id → banner colors. When present, overrides the default category
     * palette.
     */
    colorMap?: Record<string, StatusBannerColors>;
    /** Subtitle shown under the concept name (single-concept mode only). */
    subtitle?: string | ((conceptId: string, conceptName: string) => string);
    /** Size variant. Default: 'prominent' */
    size?: 'compact' | 'prominent';
    /**
     * Fix the banner to the top or bottom of the viewport via `position:
     * fixed`. Parsed from `data-ezclassify-banner-affix`. The host page must
     * add matching body padding to prevent overlap.
     */
    affix?: 'top' | 'bottom';
    /**
     * Static boundary string the current data is measured against, e.g. "TIER
     * 3". Parsed from `data-ezclassify-banner-boundary`. Enables boundary
     * mode.
     */
    boundary?: string;
    /**
     * Label for the boundary line. Overrides the scheme's `boundary` term and
     * the product default.
     */
    boundaryLabel?: string;
    /**
     * Show the dynamic current-data line derived from the live store value.
     * Defaults to true when a boundary or affix is set; false otherwise.
     */
    showCurrentData?: boolean;
    /**
     * Label for the current-data line. Overrides the scheme's `current` term
     * and the product default.
     */
    currentLabel?: string;
}

/** Full-width colored banner displaying aggregate marking status. Read-only. */
export class StatusBanner extends ReadOnlyComponentBase {
    private bannerEl!: HTMLDivElement;
    private categoryId!: string;
    private bannerOptions!: StatusBannerOptions;
    /**
     * True when running in boundary/affix mode (as opposed to single-concept
     * mode).
     */
    private _boundaryMode = false;
    /** Set to true by destroy() so async coverage callbacks silently no-op. */
    private _sbDestroyed = false;
    /** Current over-boundary state: updated asynchronously by checkCoverage(). */
    private _overBoundary = false;
    /**
     * Sequence guard: prevents stale async coverage results from overwriting
     * newer state.
     */
    private _overBoundarySeq = 0;
    /** Whether the value on display is incomplete (see setIncomplete). */
    private _incomplete = false;

    /** Banner is a whole-document context: use the scheme's whole-role default. */
    protected override resolveDefaultFormatId(meta: SchemeMetaView): string {
        return meta.defaultWholeRenderFormat ?? meta.defaultRenderFormat ?? '';
    }

    override async init(
        container: HTMLDivElement,
        engineOrContext?: ComponentEngineSource | null,
        options?: StatusBannerOptions,
    ): Promise<void> {
        this.bannerOptions = options ?? {};
        await super.init(container, engineOrContext, options);
    }

    protected setup(): void {
        const opts = this.bannerOptions;

        // Determine whether we're in the structured boundary/affix mode.
        this._boundaryMode =
            opts.affix !== undefined ||
            opts.boundary !== undefined ||
            opts.showCurrentData === true;

        // Resolve color-source category: explicit > first single-select > first category.
        const resolved = this.resolveCategory(opts.categoryId);
        this.categoryId = resolved?.id ?? this.scheme.categories[0]?.id ?? '';

        // Apply affix positioning to the container element.
        if (opts.affix === 'top') {
            this.container.classList.add('ez-banner-affix-top');
        } else if (opts.affix === 'bottom') {
            this.container.classList.add('ez-banner-affix-bottom');
        }

        this.injectComponentStyles(STATUS_BANNER_CSS);

        this.bannerEl = document.createElement('div');
        // No tabIndex: a non-interactive display element is not a keyboard tab stop.
        // Screen readers receive the live region announcements via aria-live.
        this.bannerEl.setAttribute('role', 'status');
        this.bannerEl.setAttribute('aria-live', 'polite');
        this.container.appendChild(this.bannerEl);

        this.render();
    }

    /**
     * A banner goes on a finished product and states what it is; it does not
     * judge it. Rule errors belong on the form field where the marking is
     * edited, so the banner never shows them. What it still shows is a marking
     * it cannot render: the empty state in each mode.
     */
    override updateValidationErrors(_errors: ValidationError[]): void {}

    destroy(): void {
        this._sbDestroyed = true;
        this.container.classList.remove(
            'ez-banner-affix-top',
            'ez-banner-affix-bottom',
        );
        this.container.innerHTML = '';
    }

    protected render(): void {
        if (this._boundaryMode) {
            this.renderBoundaryMode();
        } else if (this.bannerOptions.categoryId) {
            this.renderSingleConcept();
        } else {
            this.renderFullMarking();
        }
        this.renderIncomplete();
    }

    /**
     * Say whether the value on display may be missing markings: a rollup the
     * store flagged `stale`, or a marking bound to text nobody has read. The
     * banner keeps showing the value it has and states in words, on screen and
     * in its accessible name, that it may be incomplete, so a partial value
     * never reads as a confident one.
     *
     * @param incomplete - Whether the value may be incomplete
     * @internal
     */
    setIncomplete(incomplete: boolean): void {
        if (incomplete === this._incomplete) return;
        this._incomplete = incomplete;
        if (this.bannerEl) this.render();
    }

    /** Append the incomplete statement to whatever the mode just rendered. */
    private renderIncomplete(): void {
        this.bannerEl.classList.toggle(
            'status-banner--incomplete',
            this._incomplete,
        );
        if (!this._incomplete) return;
        const message = t('rollup.incomplete');
        const note = document.createElement('div');
        note.className = 'status-banner-incomplete';
        const icon = document.createElement('span');
        icon.className = 'status-banner-incomplete__icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = '\u26a0';
        const text = document.createElement('span');
        text.textContent = message;
        note.append(icon, text);
        this.bannerEl.appendChild(note);
        const label = this.bannerEl.getAttribute('aria-label');
        this.bannerEl.setAttribute(
            'aria-label',
            label ? `${label}. ${message}` : message,
        );
    }

    // ── Default mode: the complete rendered marking ──────────────────────────

    private renderFullMarking(): void {
        const opts = this.bannerOptions;
        const size = opts.size ?? 'prominent';
        const rendered = this._lastRendered;

        this.bannerEl.setAttribute('role', 'status');
        this.bannerEl.setAttribute('aria-live', 'polite');
        this.bannerEl.innerHTML = '';

        if (!rendered) {
            this.bannerEl.className = `status-banner status-banner--${size} status-banner--empty`;
            this.bannerEl.style.removeProperty('--ez-banner-bg');
            this.bannerEl.style.removeProperty('--ez-banner-text');
            const label = document.createElement('div');
            label.className = 'status-banner-label';
            label.textContent = 'No marking';
            this.bannerEl.appendChild(label);
            this.appendSubtitle('No marking');
            this.bannerEl.setAttribute('aria-label', 'No marking');
            return;
        }

        const colors = this.displayColor ?? this.resolveDeclaredColors();
        this.bannerEl.className = colors
            ? `status-banner status-banner--${size} status-banner--colored`
            : `status-banner status-banner--${size}`;
        if (colors) {
            this.bannerEl.style.setProperty(
                '--ez-banner-bg',
                colors.background,
            );
            this.bannerEl.style.setProperty('--ez-banner-text', colors.text);
        } else {
            this.bannerEl.style.removeProperty('--ez-banner-bg');
            this.bannerEl.style.removeProperty('--ez-banner-text');
        }
        const label = document.createElement('div');
        label.className = 'status-banner-label';
        label.textContent = rendered;
        this.bannerEl.appendChild(label);

        this.appendSubtitle(rendered);
        this.bannerEl.setAttribute('aria-label', rendered);
    }

    /** Append the configured subtitle, if any, for full-marking rendering. */
    private appendSubtitle(rendered: string): void {
        const subtitle = this.bannerOptions.subtitle;
        if (!subtitle) return;
        const subtitleEl = document.createElement('div');
        subtitleEl.className = 'status-banner-subtitle';
        subtitleEl.textContent =
            typeof subtitle === 'function'
                ? subtitle(rendered, rendered)
                : subtitle;
        this.bannerEl.appendChild(subtitleEl);
    }

    // ── Boundary mode: boundary + current-data + over-boundary alert ─────────

    /**
     * Resolve the three lines this mode prints. Each string is built once and
     * used for both the visible element and the accessible name, so the two can
     * never drift apart.
     */
    private boundaryModeText(showCurrentData: boolean): {
        boundary: string;
        current: string;
        overBoundary: string;
    } {
        const opts = this.bannerOptions;
        const terms = resolveVocabulary(this.scheme?.vocabulary, BANNER_TERMS);
        const boundaryLabel = opts.boundaryLabel ?? terms.boundary.singular;
        const currentLabel = opts.currentLabel ?? terms.current.singular;
        return {
            boundary: opts.boundary ? `${boundaryLabel}: ${opts.boundary}` : '',
            current: showCurrentData
                ? `${currentLabel}: ${this._lastRendered || EMPTY_VALUE}`
                : '',
            overBoundary: terms.overBoundary.singular,
        };
    }

    private renderBoundaryMode(): void {
        const opts = this.bannerOptions;
        const size = opts.size ?? 'compact';
        const showCurrentData = opts.showCurrentData !== false; // default true in boundary mode
        const currentRendered = this._lastRendered;
        const text = this.boundaryModeText(showCurrentData);

        // Color from the highest-level concept in the current assertions.
        const colors = this.resolveColors();

        this.bannerEl.innerHTML = '';

        if (this._overBoundary) {
            this.bannerEl.setAttribute('role', 'alert');
            this.bannerEl.setAttribute('aria-live', 'assertive');
        } else {
            this.bannerEl.setAttribute('role', 'status');
            this.bannerEl.setAttribute('aria-live', 'polite');
        }

        this.bannerEl.className = [
            'status-banner',
            `status-banner--${size}`,
            colors ? 'status-banner--colored' : 'status-banner--empty',
            this._overBoundary ? 'status-banner--over-boundary' : '',
        ]
            .filter(Boolean)
            .join(' ');

        if (colors) {
            this.bannerEl.style.setProperty(
                '--ez-banner-bg',
                colors.background,
            );
            this.bannerEl.style.setProperty('--ez-banner-text', colors.text);
        } else {
            this.bannerEl.style.removeProperty('--ez-banner-bg');
            this.bannerEl.style.removeProperty('--ez-banner-text');
        }

        // Over-boundary alert prefix.
        if (this._overBoundary) {
            const warn = document.createElement('span');
            warn.className = 'status-banner-over-boundary-alert';
            warn.setAttribute('aria-hidden', 'true');
            warn.textContent = `⚠ ${text.overBoundary}`;
            this.bannerEl.appendChild(warn);
        }

        // Boundary line.
        if (text.boundary) {
            const boundaryEl = document.createElement('span');
            boundaryEl.className = 'status-banner-boundary';
            boundaryEl.textContent = text.boundary;
            this.bannerEl.appendChild(boundaryEl);
        }

        // Separator between the boundary and the current-data line. The
        // character itself is a style choice, so the CSS supplies it.
        if (text.boundary && showCurrentData) {
            const sep = document.createElement('span');
            sep.className = 'status-banner-sep';
            sep.setAttribute('aria-hidden', 'true');
            this.bannerEl.appendChild(sep);
        }

        // Current-data line.
        if (text.current) {
            const dataEl = document.createElement('span');
            dataEl.className = 'status-banner-current';
            dataEl.textContent = text.current;
            this.bannerEl.appendChild(dataEl);
        }

        // Accessible name: the same strings the visible elements carry.
        const ariaLabel = [
            this._overBoundary ? `${text.overBoundary}.` : '',
            text.boundary,
            text.current,
        ]
            .filter(Boolean)
            .join(', ');
        this.bannerEl.setAttribute(
            'aria-label',
            ariaLabel || this.wholeLabel(),
        );

        // Async coverage check: triggers a targeted DOM update when the result
        // arrives.
        const seq = ++this._overBoundarySeq;
        if (opts.boundary && currentRendered) {
            this.checkOverBoundary(currentRendered, opts.boundary, seq);
        } else if (this._overBoundary) {
            // No boundary or no current data: clear any stale alert state.
            this._overBoundary = false;
        }
    }

    /**
     * The name this region wears when it has nothing else to announce: the
     * scheme's own word for the whole-marking role, or the product noun.
     */
    private wholeLabel(): string {
        const noun = roleNoun(this.scheme?.vocabulary, 'whole');
        return `${noun.charAt(0).toUpperCase()}${noun.slice(1)} marking`;
    }

    /**
     * Fire an async coverage check; re-render only when the result differs from
     * current state.
     */
    private checkOverBoundary(
        current: string,
        boundary: string,
        seq: number,
    ): void {
        // An engine refuses to certify coverage against inputs it could not
        // read, and a page mid-edit passes through exactly that state. A
        // synchronous engine raises where an asynchronous one rejects, so both
        // land here as "no answer this round": the banner keeps the state it
        // has and re-asks on the next change. Guessing a covered or an
        // over-boundary state from a failed check would put a claim about
        // somebody else's marking on the screen with nothing behind it.
        let coverageResult: ReturnType<typeof this.callCheckCoverage>;
        try {
            coverageResult = this.callCheckCoverage([current], boundary);
        } catch {
            return;
        }
        const handle = (report: { covered: boolean }) => {
            if (this._sbDestroyed || seq !== this._overBoundarySeq) return;
            const over = !report.covered;
            if (over !== this._overBoundary) {
                this._overBoundary = over;
                this.renderBoundaryMode();
                this.renderIncomplete();
            }
        };
        if (
            coverageResult &&
            typeof (coverageResult as Promise<unknown>).then === 'function'
        ) {
            (coverageResult as Promise<{ covered: boolean }>)
                .then(handle)
                .catch(() => {});
        } else {
            handle(coverageResult as { covered: boolean });
        }
    }

    // ── Single-concept mode: top-level concept label ────────────────────────────

    private renderSingleConcept(): void {
        const opts = this.bannerOptions;
        const size = opts.size ?? 'prominent';
        const assertion = this.assertions.find(
            (a) => a.categoryId === this.categoryId,
        );
        const concept = assertion
            ? this.scheme.concepts.find((c) => c.id === assertion.conceptId)
            : null;

        this.bannerEl.setAttribute('role', 'status');
        this.bannerEl.setAttribute('aria-live', 'polite');

        if (!assertion || !concept) {
            this.bannerEl.className = `status-banner status-banner--${size} status-banner--empty`;
            this.bannerEl.style.removeProperty('--ez-banner-bg');
            this.bannerEl.style.removeProperty('--ez-banner-text');
            this.bannerEl.innerHTML = '';
            const label = document.createElement('div');
            label.className = 'status-banner-label';
            label.textContent = 'No selection';
            this.bannerEl.appendChild(label);
            this.bannerEl.setAttribute('aria-label', 'No selection');
            return;
        }

        const conceptId = assertion.conceptId;
        const conceptName = concept.views['default'] ?? concept.name;
        // The consuming application owns presentation, so its per-concept
        // override precedes the scheme's own display color.
        const colors =
            this.bannerOptions.colorMap?.[conceptId] ??
            this.resolveSchemeColor();

        this.bannerEl.className = `status-banner status-banner--${size} status-banner--colored`;
        this.bannerEl.innerHTML = '';

        if (colors) {
            this.bannerEl.style.setProperty(
                '--ez-banner-bg',
                colors.background,
            );
            this.bannerEl.style.setProperty('--ez-banner-text', colors.text);
        } else {
            this.bannerEl.style.setProperty(
                '--ez-banner-bg',
                this.getCategoryColor(this.categoryId),
            );
            this.bannerEl.style.setProperty(
                '--ez-banner-text',
                this.getCategoryTextColor(this.categoryId),
            );
        }

        const labelEl = document.createElement('div');
        labelEl.className = 'status-banner-label';
        labelEl.textContent = conceptName;
        this.bannerEl.appendChild(labelEl);

        const subtitle = opts.subtitle;
        if (subtitle) {
            const subtitleEl = document.createElement('div');
            subtitleEl.className = 'status-banner-subtitle';
            subtitleEl.textContent =
                typeof subtitle === 'function'
                    ? subtitle(conceptId, conceptName)
                    : subtitle;
            this.bannerEl.appendChild(subtitleEl);
        }

        this.bannerEl.setAttribute('aria-label', conceptName);
    }

    // ── Helpers ─────────────────────────────────────────────────────────────────

    /**
     * Resolve the scheme's own display color for the current assertion set.
     *
     * The adapter's answer wins: it applied whatever the scheme declares,
     * including the condition-list form of `render.color_from`, and its result
     * arrives on every `ProcessResult`. The local fallback covers the
     * driving-category form for the paths that set assertions without a fresh
     * process call; it maps every assertion to its concept's color so the
     * driving assertion is found wherever it sits. Undefined for a scheme that
     * declares no display color.
     */
    private resolveSchemeColor() {
        return (
            this.displayColor ??
            resolveMarkingColor(
                { colorFrom: this.colorFrom },
                this.assertions.map((a) => ({
                    conceptId: a.conceptId,
                    categoryId: a.categoryId,
                    color: this.scheme.concepts.find(
                        (c) => c.id === a.conceptId,
                    )?.color,
                })),
                this.scheme,
            )
        );
    }

    /**
     * Resolve background/text colors for the current assertions. Prefers a host
     * concept override, then the scheme's own display color, then the generic
     * category palette. Returns null when there are no assertions.
     */
    private resolveColors(): StatusBannerColors | null {
        if (!this.assertions.length) return null;

        // Find the first assertion in a single-select category (the "level" concept).
        const singleCats = new Set(
            this.scheme.categories.filter((c) => c.single).map((c) => c.id),
        );
        const tierAssertion =
            this.assertions.find((a) => singleCats.has(a.categoryId)) ??
            this.assertions[0];

        const mapped = this.bannerOptions.colorMap?.[tierAssertion.conceptId];
        if (mapped) return mapped;

        const schemeDefault = this.resolveSchemeColor();
        if (schemeDefault) return schemeDefault;

        return {
            background: this.getCategoryColor(tierAssertion.categoryId),
            text: this.getCategoryTextColor(tierAssertion.categoryId),
        };
    }

    /**
     * Resolve only colors someone actually declared: a host colorMap override
     * or the scheme's own display color. No generic palette fallback: the
     * full-marking banner states what the document IS, and a scheme that
     * deliberately declares no banner colors (UK GSC and CA GoC both document
     * this) must render neutral rather than wear an invented color.
     */
    private resolveDeclaredColors(): StatusBannerColors | null {
        if (!this.assertions.length) return null;
        const singleCats = new Set(
            this.scheme.categories.filter((c) => c.single).map((c) => c.id),
        );
        const tierAssertion =
            this.assertions.find((a) => singleCats.has(a.categoryId)) ??
            this.assertions[0];
        const mapped = this.bannerOptions.colorMap?.[tierAssertion.conceptId];
        if (mapped) return mapped;
        return this.resolveSchemeColor() ?? null;
    }

    /** Shim for engine.checkCoverage: threads schemeId on multi-scheme adapters. */
    private callCheckCoverage(children: string[], parent: string) {
        const opts = { outputFormat: this.formatId };
        if (this.schemeAddressing && isAddressableSchemeEngine(this.engine)) {
            return this.engine.checkCoverage(
                children,
                parent,
                this.schemeId,
                opts,
            );
        }
        return this.engine.checkCoverage(children, parent, opts);
    }
}
