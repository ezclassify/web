/**
 * MarkedFieldBase: the shared template-method foundation for the two
 * progressively-enhanced marking fields, {@link MarkedInput} (single-line
 * <input>, one leading part mark) and {@link MarkedTextArea}
 * (multi-line<textarea>, many inline marking segments).
 *
 * The two fields differ in exactly two dimensions: (a) the host element,
 * <input> vs <textarea>; (b) the marking cardinality; one leading mark vs a
 * list of segments.
 *
 * Everything else is identical: engine/scheme/format binding, theme variable
 * sync, the marking action footer, the inline-picker lifecycle (close/destroy,
 * close-on-Escape, close-on-outside-click), and the teardown sequence. That
 * shared logic lives here. The genuine differences are abstract hooks the
 * subclasses provide.
 *
 * This base introduces NO new public surface: subclasses keep their existing
 * exported names and option shapes. It exists only to remove duplication.
 */

import type {
    Assertion,
    Change,
    SchemePublicView,
    EmbeddedMarkingStyle,
} from '@ezclassify/types';
import type {
    ComponentInstance,
    ComponentOptions,
    ComponentEngineSource,
    ComponentSchemeEngine,
} from './component-base-readonly';
import { teardownAfterWrite } from './teardown-write';
import {
    resolveProfile,
    resolveSchemeEngine,
    resolveContextSource,
} from './component-base-readonly';
import { isMacPlatform } from './dom-helpers';
import { takenFromWhole } from '../assertion-identity';
import { renderViewRefused } from '../render-refusal';
import { t } from '../i18n';
import {
    markAttention,
    templateDelimiters,
    wrapPartMark,
} from './marked-text-area-logic';
import { adoptStylesOnce } from '../styles/adopt';
import { attachTooltip, COMPONENT_CSS } from './component-utils';
import { assertDescribesConcepts } from './concept-description';
import { conceptHint, conceptHintName } from './concept-hint';
import { buildTokenTree, locateTokenSpans } from '../token-tree/token-tree';
import {
    assertWritesScopes,
    defaultSurfaceOf,
    resolveOutput,
    viewOutputOf,
} from '../format-resolver';
import {
    inDeclarationOrder,
    listedScopesOf,
    scopeSetOf,
    writesCategoryOf,
} from '../scopes';
import {
    explainedChanges,
    schemeChangeWords,
    type ChangeWords,
} from './status-mark';
import {
    InlineMarkingEditor,
    type InlineMarkingEditorOptions,
} from './inline-marking-editor';
import { writtenFactTest, type ShownForm } from '../written-facts';
import type { ClearButton } from './clear-button';
import { isUndoChord, MarkingUndo } from './marking-undo';
import { announce, createAnnouncer } from './accessibility-helpers';
import {
    mountFieldChrome,
    observeFieldTheme,
    type FieldChrome,
} from './field-chrome';
import { FieldComponentBase } from './field-component-base';
import type { FavoritesPanelHost } from './favorites-panel';
import { markingTarget } from './marking-target';
import { hideTooltip } from './tooltip-manager';
import {
    bindMarkingLongPress,
    showMarkingActions,
    usesPhoneMarkingActions,
} from './marking-touch-actions';
import markingTouchCss from './marking-touch-actions.css?inline';

/**
 * CSS class-name set a concrete field uses. Keeps the shared scaffolding (wrap,
 * display, marking action, picker-active marker) host-specific so the existing
 * stylesheets keep matching byte-for-byte.
 */
export interface MarkedFieldClassNames {
    /** Wrapper div inserted around the host element. */
    wrap: string;
    /** Visible display layer that mirrors the host. */
    display: string;
    /** Footer row under the field containing the marking action. */
    footer: string;
    /** Set or add the marking. */
    touchAdd: string;
    /** Marker class toggled on the container while the picker is open. */
    pickerActive: string;
}

/**
 * Shared base for the two marking-field components. The host element type is a
 * type parameter (`HTMLInputElement` or `HTMLTextAreaElement`) so each subclass
 * keeps a strongly-typed `host`.
 */
export abstract class MarkedFieldBase<
    H extends HTMLInputElement | HTMLTextAreaElement,
>
    extends FieldComponentBase
    implements ComponentInstance
{
    protected engine!: ComponentSchemeEngine;
    /**
     * Read a saved marking (a favorite) in this field's scan format, the way
     * the field would hold it. Reading a stored marking is the reader's call:
     * nothing here corrects it.
     */
    protected async readForFavorites(marking: string): Promise<{
        assertions: Assertion[];
        rendered: string;
        appliedFixes: Change[];
    }> {
        const result = await Promise.resolve(
            this.engine.validate(marking, {
                outputFormat: this.scanFormat,
            }),
        );
        return {
            assertions: result.assertions,
            // A refused write is the engine's marker: the saved text stands.
            rendered: renderViewRefused(result) ? marking : result.rendered,
            appliedFixes: result.appliedFixes,
        };
    }
    protected markedFavoritesHost(
        actions: Pick<
            FavoritesPanelHost,
            | 'getCurrent'
            | 'canApply'
            | 'onApply'
            | 'focusField'
            | 'describeTarget'
            | 'targets'
            | 'endTargetSelection'
        >,
    ): FavoritesPanelHost {
        const { getCurrent, ...rest } = actions;
        return {
            root: this.container,
            schemeId: this.schemeId,
            scope: this.options.scope,
            formatId: this.scanFormat,
            scheme: this.scheme,
            config: this.options.favorites,
            read: (marking) => this.readForFavorites(marking),
            applyPreset: (presetId) =>
                this.callApplyPreset(presetId, this.scanFormat),
            ...markingTarget(this),
            ...rest,
            getCurrent: () => markingTarget(this)?.getCurrent() ?? getCurrent(),
        };
    }

    /** Expand a named scheme preset through the bound adapter. */
    protected callApplyPreset(presetId: string, outputFormat?: string) {
        const options = outputFormat ? { outputFormat } : undefined;
        return this.engine.applyPreset(presetId, options);
    }
    /**
     * The engine source the field was mounted with (direct argument or ancestor
     * provider): the composed context when the host injected one, the bare
     * scheme adapter otherwise. Held so a nested component can be mounted with
     * the same source rather than a narrowed copy of it.
     */
    protected engineSource!: ComponentEngineSource;

    protected container!: HTMLDivElement;
    protected options: ComponentOptions = {};
    protected schemeId!: string;
    protected scheme!: SchemePublicView;
    protected wrap!: HTMLDivElement;
    protected host!: H;
    protected display!: HTMLDivElement;
    /**
     * The field's inline chrome, mounted by {@link appendFooter}. The subclass
     * mounts its branding/tools button into `chrome.status` with `shape:
     * 'chrome'`; clear follows it.
     */
    protected chrome!: FieldChrome;
    /**
     * Where the chrome sits on the field's trailing edge: centered on a
     * single-line field, pinned to the first line of a multi-line one.
     */
    protected readonly chromeAlign: 'center' | 'start' = 'center';
    private clearControl?: ClearButton;
    /**
     * The undo of a clear (see marking-undo.ts). The field's value is its text,
     * so every change to the text after the clear ends the offer.
     */
    private readonly undo = new MarkingUndo();
    private releaseUndo: (() => void) | null = null;
    private readonly followText = () => this.undo.observe(this.host.value);
    private readonly undoKey = (event: KeyboardEvent) => {
        if (!isUndoChord(event) || !this.undo.offer) return;
        event.preventDefault();
        event.stopPropagation();
        void this.undo.perform().then(() => {
            this.host.focus({ preventScroll: true });
            if (this.undoAnnouncer)
                announce(this.undoAnnouncer, t('a11y.markingRestored'));
        });
    };
    private undoAnnouncer: HTMLElement | null = null;

    protected embeddedStyle: EmbeddedMarkingStyle | null = null;
    /** Resolved from the scheme in bindEngine; empty until then. */
    protected scanFormat = '';
    protected scanSeq = 0;
    protected hasFocus = false;

    protected picker: InlineMarkingEditor | null = null;
    protected pickerMount: HTMLElement | null = null;
    /**
     * The MutationObserver for the field’s theme scope. Stored so
     * {@link disconnectThemeObserver} can tear it down on destroy; otherwise
     * every mounted field leaks a live observer (and its closure over the
     * detached DOM) for the page lifetime.
     */
    protected _themeObserver: MutationObserver | null = null;
    protected _explicitClose = false;
    protected _lastCloseTime = 0;
    /**
     * True while a mouse press that began on the host is held. A caret move
     * during a press opens nothing: the release decides, so a plain click opens
     * the marking with its list, and a drag or a double-click stays a text
     * selection.
     */
    protected pressing = false;
    private readonly beginPress = (event: Event): void => {
        if ((event as MouseEvent).button === 0) this.pressing = true;
    };
    // Cleared on any release in the document: a drag can end anywhere.
    private readonly endPress = (): void => {
        this.pressing = false;
    };

    /** Start tracking presses on the host (see {@link pressing}). */
    protected watchPresses(): void {
        this.host.addEventListener('mousedown', this.beginPress);
        this.wrap.addEventListener('pointermove', this.forwardSegmentHover);
        this.wrap.addEventListener('pointerleave', this.clearSegmentHover);
        this.wrap.addEventListener('pointerdown', this.clearSegmentHover, true);
        document.addEventListener('mouseup', this.endPress, true);
        window.addEventListener('blur', this.endPress);
    }

    /** Stop tracking presses. */
    protected unwatchPresses(): void {
        this.host.removeEventListener('mousedown', this.beginPress);
        this.wrap.removeEventListener('pointermove', this.forwardSegmentHover);
        this.wrap.removeEventListener('pointerleave', this.clearSegmentHover);
        this.wrap.removeEventListener(
            'pointerdown',
            this.clearSegmentHover,
            true,
        );
        this.clearSegmentHover();
        document.removeEventListener('mouseup', this.endPress, true);
        window.removeEventListener('blur', this.endPress);
        this.pressing = false;
    }
    /**
     * Host value + caret captured when the picker opens (for the textarea,
     * BEFORE the template insertion that precedes the open). Escape restores
     * this snapshot so closing the picker with Escape CANCELS the edit instead
     * of committing whatever is in the editor; without it, Escape persisted
     * unrecognized junk like "(junkxyz)" into the field as text that reads like
     * a marking. Cleared on every close (commit paths keep their
     * commit-on-close semantics and never read it).
     */
    protected _pickerCancelSnapshot: { value: string; caret: number } | null =
        null;
    /**
     * Saved picker assertions from the last close: avoids re-parsing the
     * rendered string.
     */
    protected _editorAssertions: {
        marking: string;
        assertions: Assertion[];
    } | null = null;
    protected _inSelectionChange = false;

    protected boundInput!: () => void;
    protected boundKeydown!: (e: KeyboardEvent) => void;
    protected boundDocKeydown!: (e: KeyboardEvent) => void;
    protected boundDocClick!: (e: MouseEvent) => void;
    protected boundSelectionChange!: () => void;

    // --- Hooks the two subclasses supply (the real differences) -------------

    /** Human-readable component label used in error messages. */
    protected abstract readonly componentLabel: string;
    /** The host-specific CSS class names (see {@link MarkedFieldClassNames}). */
    protected abstract readonly classNames: MarkedFieldClassNames;
    /** The component's inline CSS string. */
    protected abstract readonly css: string;
    /** I18n key naming the marking button's action. */
    protected abstract readonly markingActionKey:
        'hint.setMarking' | 'hint.addMarking';

    /** Resolve the host element (input vs textarea) for this container. */
    protected abstract resolveHost(): H;
    /**
     * Drive the "add a marking at the caret" action: input opens the picker;
     * textarea inserts a template at the caret then opens.
     */
    protected abstract triggerAddMarking(): void;

    // The value↔marking model + render/sync specifics stay per-subclass.
    protected abstract renderDisplay(): void;

    /**
     * Bind the engine, scheme, format, and embedded style. Identical across
     * both fields: resolve the engine source, resolve the scheme id, snapshot
     * the embedded marking style, then choose the scan format: the output the
     * requested spelling names, else the scheme's part default.
     *
     * @param requestedFormat - The per-component format option (formatId /
     *   scanFormat)
     */
    protected bindEngine(
        container: HTMLDivElement,
        engineOrContext: ComponentEngineSource | null | undefined,
        requestedFormat: string | undefined,
    ): void {
        const resolvedEngine = resolveSchemeEngine(
            engineOrContext,
            this.componentLabel,
        );
        assertDescribesConcepts(resolvedEngine, this.componentLabel);
        this.engine = resolvedEngine;
        this.engineSource =
            resolveContextSource(engineOrContext) ?? resolvedEngine;
        this.container = container;
        this.schemeId = resolveProfile(resolvedEngine);
        const resolvedScheme = resolvedEngine.getScheme();
        this.scheme = resolvedScheme;
        this.embeddedStyle =
            (
                resolvedScheme as unknown as {
                    embeddedMarking?: EmbeddedMarkingStyle[];
                }
            ).embeddedMarking?.[0] ?? null;
        const formats = this.scheme.formats ?? [];
        // A lone `scope` is a list of one, and a list of one is that scope.
        const listed = listedScopesOf(this.options);
        const meta = resolvedEngine.getSchemeMeta();
        // The host's spelling is resolved to the output it names: an output id
        // as it is, a bare view id to that view on the field's surface (the
        // first of the scopes it lists). A scheme that lists no formats leaves
        // nothing to check it against.
        const requested =
            requestedFormat !== undefined && formats.length === 0
                ? requestedFormat
                : requestedFormat &&
                  resolveOutput(
                      formats,
                      requestedFormat,
                      inDeclarationOrder(listed, meta)[0] ??
                          defaultSurfaceOf(
                              formats,
                              this.scheme.defaultRenderFormat,
                          ),
                  );
        // A field that lists scopes writes them as one mark: in the format it
        // names, else the part default of the first of them. Several are
        // written only when that one output writes every one of them. The
        // scheme decides; a field whose scopes no one output covers is
        // refused here.
        if (listed.length > 1) {
            this.scanFormat =
                requested ||
                requestedFormat ||
                viewOutputOf(meta, listed, true);
            assertWritesScopes(
                resolvedEngine,
                resolvedScheme.categories,
                this.scanFormat,
                listed,
                this.componentLabel,
            );
            return;
        }
        // Every fallback comes out of the scheme. A literal format id here
        // would be a data value in code: a scheme that declares no format under
        // that name gets an id it never heard of. Both fields write parts, so a
        // spelling the scheme does not have falls back to the part default:
        // of the one scope the field lists, else of the default scope.
        this.scanFormat =
            requested ||
            (listed.length === 1
                ? viewOutputOf(meta, listed, true)
                : this.pickPartFormat()) ||
            this.schemeDefaultFormat(formats.map((format) => format.id));
        // A field of one scope writes that scope only.
        assertWritesScopes(
            resolvedEngine,
            resolvedScheme.categories,
            this.scanFormat,
            listed,
            this.componentLabel,
        );
    }

    /**
     * Adopt the component stylesheet onto the container's root and mark the
     * container for scoped CSS. The sheet is adopted for the lifetime of the
     * root and shared by every instance built from the same CSS.
     */
    protected injectStyle(): void {
        this.container.setAttribute('data-ezclassify', '');
        adoptStylesOnce(COMPONENT_CSS + this.css, this.container);
        adoptStylesOnce(markingTouchCss, this.container);
    }

    /**
     * Snapshot the host's layout-affecting computed styles BEFORE it is made
     * invisible, then mirror them onto the display div. Returns the snapshot so
     * callers can keep the at-rest border color current across theme switches.
     */
    protected captureAndMirrorStyles(): Record<string, string> {
        const layoutProps = [
            'padding',
            'borderWidth',
            'borderStyle',
            'borderColor',
            'font',
            'lineHeight',
            'color',
            'backgroundColor',
        ] as const;
        const csLive = window.getComputedStyle(this.host);
        const capturedStyles: Record<string, string> = {};
        for (const p of layoutProps) {
            capturedStyles[p] = (csLive as unknown as Record<string, string>)[
                p
            ];
        }
        for (const p of layoutProps) {
            (this.display.style as unknown as Record<string, string>)[p] =
                capturedStyles[p];
        }
        return capturedStyles;
    }

    protected setMeasuredFontSize(size: string): void {
        this.host.style.setProperty('--ez-field-measured-font-size', size);
        this.display.style.setProperty('--ez-field-measured-font-size', size);
    }

    /**
     * Watch the host's ancestors for theme changes and re-sync the display's
     * color/background/at-rest border to match the themed host. An owned editor
     * can supply its original native input as the paint source.
     */
    protected installThemeObserver(
        capturedStyles: Record<string, string>,
        hostInputClass: string,
        paintHost: HTMLElement = this.host,
    ): void {
        if (typeof MutationObserver === 'undefined') return;
        // Replace any prior observer (defensive against a double install).
        this.disconnectThemeObserver();
        const layout = [
            'font',
            'fontSize',
            'lineHeight',
            'borderWidth',
            'borderStyle',
            'borderRadius',
            'paddingTop',
            'paddingRight',
            'paddingBottom',
            'paddingLeft',
        ] as const;
        const paintProperties = [
            'color',
            'backgroundColor',
            'borderColor',
        ] as const;
        this._themeObserver = observeFieldTheme(paintHost, () => {
            const masked = paintHost === this.host;
            const transitionProperty = paintHost.style.getPropertyValue(
                'transition-property',
            );
            const transitionPriority = paintHost.style.getPropertyPriority(
                'transition-property',
            );
            const paint: Partial<
                Record<(typeof layout | typeof paintProperties)[number], string>
            > = {};
            try {
                if (masked) {
                    // Even reduced-motion's tiny nonzero duration can leave the
                    // old transparent paint in a synchronous computed-style read.
                    paintHost.style.setProperty(
                        'transition-property',
                        'none',
                        'important',
                    );
                    paintHost.classList.remove(hostInputClass);
                }
                const cs = window.getComputedStyle(paintHost);
                for (const property of [...layout, ...paintProperties])
                    paint[property] = cs[property];
            } finally {
                if (masked) {
                    paintHost.classList.add(hostInputClass);
                    if (transitionProperty)
                        paintHost.style.setProperty(
                            'transition-property',
                            transitionProperty,
                            transitionPriority,
                        );
                    else paintHost.style.removeProperty('transition-property');
                }
            }
            for (const property of layout) {
                const value = paint[property] ?? '';
                this.display.style[property] = value;
                if (!masked) this.host.style[property] = value;
            }
            if (paint.fontSize) this.setMeasuredFontSize(paint.fontSize);
            this.display.style.color = paint.color ?? '';
            this.display.style.backgroundColor = paint.backgroundColor ?? '';
            // Keep the at-rest border current so blur restores themed paint.
            capturedStyles.borderColor = paint.borderColor ?? '';
            this.display.style.borderColor = capturedStyles.borderColor;
        });
    }

    /**
     * Release what setup attached around the host: the clear control, the
     * inline chrome and the theme observer installed by installThemeObserver.
     */
    protected disconnectThemeObserver(): void {
        this.undo.end();
        this.releaseUndo?.();
        this.releaseUndo = null;
        this.host?.removeEventListener('input', this.followText);
        this.wrap?.removeEventListener('keydown', this.undoKey, true);
        this.undoAnnouncer?.remove();
        this.undoAnnouncer = null;
        this.clearControl?.destroy();
        this.clearControl = undefined;
        this.chrome?.destroy();
        this._themeObserver?.disconnect();
        this._themeObserver = null;
    }

    /**
     * Append the marking action footer and the field's inline chrome to the
     * wrap. The touch-add click delegates to {@link triggerAddMarking}.
     *
     * The chrome ({@link chrome}) sits inside the field's trailing edge in every
     * state, so its controls never move while the inline editor opens, and the
     * field's text layers reserve the room it takes.
     */
    protected appendFooter(): void {
        const footer = document.createElement('div');
        footer.className = `ez-marked-field-footer ${this.classNames.footer}`;
        const actions = document.createElement('div');
        actions.className = 'ez-marked-field-actions';

        // One direct action and Tab stop: its desktop keycap documents the
        // shortcut; coarse pointers keep the same plain action button.
        const touchAdd = document.createElement('button');
        touchAdd.type = 'button';
        touchAdd.className = this.classNames.touchAdd;
        const label = t(this.markingActionKey);
        const shortcut = isMacPlatform() ? '⌘+Enter' : 'Ctrl+Enter';
        const keycap = document.createElement('kbd');
        keycap.className = 'ez-marked-field-shortcut';
        keycap.setAttribute('aria-hidden', 'true');
        keycap.textContent = shortcut;
        const actionLabel = document.createTextNode(` ${label}`);
        touchAdd.append(keycap, actionLabel);
        this.footerAction = { button: touchAdd, label: actionLabel };
        touchAdd.setAttribute('aria-label', label);
        touchAdd.title = `${label} (${shortcut})`;
        touchAdd.setAttribute(
            'aria-keyshortcuts',
            isMacPlatform() ? 'Meta+Enter' : 'Control+Enter',
        );
        touchAdd.addEventListener('click', (e) => {
            e.preventDefault();
            this.triggerAddMarking();
        });
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'ez-marked-field-remove';
        remove.textContent = t('mark.removeMarking');
        remove.hidden = true;
        let pressed: (() => void) | undefined;
        remove.addEventListener('pointerdown', () => {
            pressed = this.removeFromFooter;
        });
        remove.addEventListener('pointercancel', () => {
            pressed = undefined;
        });
        remove.addEventListener('click', (event) => {
            const action = event.detail ? pressed : this.removeFromFooter;
            pressed = undefined;
            if (usesPhoneMarkingActions(remove)) action?.();
        });
        this.footerRemove = remove;
        actions.append(touchAdd, remove);
        footer.append(actions);

        this.wrap.appendChild(footer);

        // Last in the wrap, so Tab reaches the field, its fixes and the action
        // before the chrome.
        this.chrome = mountFieldChrome(this.wrap, {
            root: this.container,
            align: this.chromeAlign,
        });
        this.clearControl = this.createFieldClear({
            label: t('aria.clearText'),
            host: this.host,
            empty: () => this.host.value.length === 0,
            clear: () => {
                const text = this.host.value;
                this.undo.make('clear', this, () => this.replaceText(text));
                this.replaceText('');
            },
            undoOffer: () => this.undo.offer,
            undo: () => this.undo.perform(),
            focusField: () => this.host.focus({ preventScroll: true }),
        });
        this.chrome.element.appendChild(this.clearControl.button);
        this.releaseUndo = this.undo.subscribe(() =>
            this.clearControl?.update(),
        );
        this.host.addEventListener('input', this.followText);
        this.wrap.addEventListener('keydown', this.undoKey, true);
        // Beside clear, which stays the chrome's last control.
        this.undoAnnouncer = createAnnouncer();
        this.chrome.element.insertBefore(
            this.undoAnnouncer,
            this.clearControl.button,
        );
    }

    /**
     * Replace the field's whole text as the author's own edit: a clear, or the
     * undo of one. Any open editor and scan are dropped.
     */
    private replaceText(text: string): void {
        ++this.scanSeq;
        this._editorAssertions = null;
        this.finishClose();
        this.setValue(text);
        // This is a user edit, so observers receive the same native event as typing.
        this.host.dispatchEvent(new Event('input', { bubbles: true }));
    }

    /**
     * True while the component itself dispatches a native `input` event on the
     * host. The component's own input listener must ignore that event or the
     * sync pipeline would run twice (and, for bound fields, echo into the
     * store).
     */
    protected _selfDispatch = false;

    /**
     * Write a value to the host field and, when it actually changed from a
     * user-driven action, dispatch a native bubbling `input` event. Host Form
     * Contract: the native field emits its normal form events when its value
     * changes, so a host may observe picker- and repair-driven edits with an
     * ordinary listener and never needs EzClassify events for that.
     *
     * @param value - The new host value
     * @param notify - False for reflections of EXTERNAL state (store
     *   subscription pushes, host-initiated setValue), which the host already
     *   knows about; true (default) for changes the component originated
     */
    protected setHostValue(value: string, notify = true): void {
        const changed = this.host.value !== value;
        this.host.value = value;
        // Value unchanged: no event, no downstream work (architecture rule).
        if (!changed || !notify) return;
        this._selfDispatch = true;
        try {
            this.host.dispatchEvent(new Event('input', { bubbles: true }));
        } finally {
            this._selfDispatch = false;
        }
    }

    private phoneMarkingSource?: {
        expected: string;
        native: HTMLInputElement | HTMLTextAreaElement;
    };

    protected holdPhoneMarkingSource(
        expected: string,
        native: HTMLInputElement | HTMLTextAreaElement,
    ): void {
        this.phoneMarkingSource = { expected, native };
    }

    protected writePhoneMarkingValue(value: string): void {
        if (this.phoneMarkingSource) this.phoneMarkingSource.expected = value;
        this.setHostValue(value);
    }

    /** A native host replacement wins over the older editor and its snapshot. */
    protected discardStalePhoneMarking(): boolean {
        const source = this.phoneMarkingSource;
        if (!source) return false;
        const native = source.native.value;
        if (
            source.expected === native &&
            source.expected === this.host.value &&
            !source.native.matches(':disabled, [readonly]')
        )
            return false;
        this.finishClose();
        this._editorAssertions = null;
        this.host.value = native;
        this.afterCancel(false);
        this.afterClose();
        return true;
    }

    /**
     * How the field's status mark names values and categories: a value the way
     * this field writes its concept, in its scan format as a part, a category
     * by its label.
     */
    protected changeWords(): ChangeWords {
        return schemeChangeWords(() => {
            if (!this.scheme || !this.engine) return undefined;
            const meta = this.engine.getSchemeMeta();
            return {
                scheme: this.scheme,
                meta,
                field: {
                    formatId: this.scanFormat,
                    part: true,
                    scopes: scopeSetOf(listedScopesOf(this.options), meta),
                },
            };
        });
    }

    /**
     * The changes the field's status mark explains for what it holds: those to
     * what its marks write that its scopes write or it changed. A text field
     * shows only its text, so a fact a rule filled in that the text does not
     * write is not one of them (see explainedChanges).
     *
     * @param applied - The applied changes the field has recorded
     * @param holds - What the field holds now, every mark of it
     */
    protected textStatusChanges(
        applied: readonly Change[],
        holds: readonly Assertion[],
    ): Change[] {
        const meta = this.engine.getSchemeMeta();
        return explainedChanges(applied, holds, {
            writes: writesCategoryOf(
                listedScopesOf(this.options),
                this.scheme.categories,
                meta,
            ),
            written: writtenFactTest(
                this.markForms(),
                this.scheme.categories,
                meta,
            ),
            showsUnwritten: false,
        });
    }

    /**
     * The forms the field's marks are written in, each with what writing it
     * did, so its status mark explains changes to what the marks write (see
     * written-facts.ts).
     */
    protected abstract markForms(): ShownForm[];

    /**
     * The scheme's declared render format for a part of a marking, if it names
     * one. Matches the `defaultPartRenderFormat` field it reads.
     *
     * @returns The format id, or undefined when the scheme declares none
     */
    protected pickPartFormat(): string | undefined {
        return this.engine.getSchemeMeta().defaultPartRenderFormat ?? undefined;
    }

    /**
     * The format to scan with when neither the host nor the scheme's part
     * format decided one: the scheme's declared default, then its first
     * declared format.
     *
     * @param knownFormatIds - Format ids the scheme declares, in order
     * @returns A format id, or an empty string when the scheme declares none
     */
    private schemeDefaultFormat(knownFormatIds: string[]): string {
        const declaredDefault = (
            this.scheme as unknown as { defaultRenderFormat?: string }
        ).defaultRenderFormat;
        return declaredDefault ?? knownFormatIds[0] ?? '';
    }

    /** The embedded-marking template, defaulting to "{marking} " when none. */
    protected get template(): string {
        return this.embeddedStyle?.template ?? '{marking} ';
    }

    /** The delimiters the embedded-marking template writes around a mark. */
    protected get delimiters(): { open: string; close: string } {
        return templateDelimiters(this.template);
    }

    /** The scheme's embedded marking patterns, in declaration order. */
    protected get embeddedPatterns(): Array<{ pattern: string }> {
        return (
            (
                this.scheme as unknown as {
                    embeddedMarking?: Array<{ pattern: string }>;
                }
            ).embeddedMarking ?? []
        );
    }

    /**
     * The field text for a rendered part marking. The template wraps a bare
     * rendering once; a rendering that already is a whole embedded mark is
     * written as it is. See {@link wrapPartMark}.
     */
    protected wrapRendered(rendered: string): string {
        return wrapPartMark(
            rendered,
            this.template,
            this.embeddedStyle?.pattern,
        );
    }

    // --- Picker lifecycle (shared) ------------------------------------------

    /**
     * Bumped by every `destroyPicker()`. Opening an editor awaits its init, and
     * a second open (the caret landing in a mark on focus, then the shortcut a
     * moment later) can start before the first finishes. Each open captures
     * this after its own teardown and drops its editor if it changed, so a
     * stale editor never mounts or takes focus from the current one.
     */
    private pickerOpenSeq = 0;

    protected async mountPicker(
        inner: string,
        mountClass: string,
        options: Pick<
            InlineMarkingEditorOptions,
            | 'assertions'
            | 'caret'
            | 'draft'
            | 'label'
            | 'onChange'
            | 'onExit'
            | 'onLineMove'
            | 'openList'
            | 'resolveParts'
            | 'sheetTools'
            | 'protectExistingMarking'
            | 'textToolsEdges'
        >,
        finishBlur: () => void,
    ): Promise<boolean> {
        const openSeq = this.pickerOpenSeq;
        const mount = this.host.ownerDocument.createElement('span');
        mount.className = mountClass;
        mount.style.display = 'inline';
        const picker = new InlineMarkingEditor();
        await picker.init(
            mount as unknown as HTMLDivElement,
            this.engineSource,
            inner,
            {
                ...options,
                formatId: this.scanFormat,
                scope: this.options.scope,
                scopes: this.options.scopes,
                resolveContext: this.options.resolveContext,
                tooltips: this.options.tooltips,
                tooltipConceptProperty: this.options.tooltipConceptProperty,
                onBlurCommit: (outcome) => {
                    if (outcome !== 'invalid' && this.picker === picker)
                        finishBlur();
                },
                onCancel: (fromSheet) => this.escapeClosePicker(fromSheet),
                onChange: (...args) => {
                    if (!this.discardStalePhoneMarking())
                        options.onChange?.(...args);
                },
                focusTarget: this.wrap,
                isFieldChrome: (node) => this.isFieldChrome(node),
                root: this.container,
            },
        );
        if (openSeq !== this.pickerOpenSeq) {
            picker.destroy();
            return false;
        }
        if (this.discardStalePhoneMarking()) {
            picker.destroy();
            return false;
        }
        this.picker = picker;
        this.pickerMount = mount;
        this.suppressFieldReport(true);
        this.container.classList.add(this.classNames.pickerActive);
        this.renderDisplay();
        picker.focus();
        return true;
    }

    /** A superseded or invalid session cannot write a mark to the host. */
    protected async commitPicker(): Promise<boolean> {
        if (this.discardStalePhoneMarking()) return false;
        const picker = this.picker;
        if (!picker) return false;
        const outcome = await picker.commit();
        return (
            this.picker === picker &&
            !this.discardStalePhoneMarking() &&
            outcome !== 'invalid'
        );
    }

    /** Carry the editor's facts into the next read of the same written mark. */
    protected pickerReading(picker: InlineMarkingEditor) {
        return {
            marking: this.wrapRendered(picker.getRendered().trim()).trimEnd(),
            assertions: picker.getAssertions(),
        };
    }

    protected destroyPicker(): void {
        this.pickerOpenSeq++;
        this.phoneMarkingSource = undefined;
        this.picker?.destroy();
        this.picker = null;
        this.pickerMount?.remove();
        this.pickerMount = null;
    }

    /**
     * Keep the display layer hidden from assistive technology everywhere except
     * the path to the inline editor. The display mirrors the host's text for
     * sighted users and is `aria-hidden` for that reason; an editor mounted
     * inside it would be hidden too, leaving a focused combobox with no name
     * and nothing announced. While an editor is mounted, the layer itself is
     * exposed and every sibling along the editor's ancestor chain is hidden
     * instead. Call at the end of every display render.
     */
    protected exposePickerInDisplay(): void {
        const mount = this.pickerMount;
        if (!mount || !this.display.contains(mount)) {
            this.display.setAttribute('aria-hidden', 'true');
            return;
        }
        this.display.removeAttribute('aria-hidden');
        const hideAround = (parent: Node): void => {
            for (const child of [...parent.childNodes]) {
                if (child === mount) continue;
                if (child.contains(mount)) {
                    hideAround(child);
                } else if (child.nodeType === Node.TEXT_NODE) {
                    const span = document.createElement('span');
                    span.setAttribute('aria-hidden', 'true');
                    parent.replaceChild(span, child);
                    span.appendChild(child);
                } else if (child instanceof Element) {
                    child.setAttribute('aria-hidden', 'true');
                }
            }
        };
        hideAround(this.display);
    }

    /**
     * Shared close teardown: stamp the close time, drop the picker-active
     * marker, remove any stray tooltips, and destroy the picker.
     */
    protected finishClose(): void {
        this._lastCloseTime = performance.now();
        this._pickerCancelSnapshot = null;
        this.container.classList.remove(this.classNames.pickerActive);
        this.container
            .querySelectorAll('.ez-tooltip')
            .forEach((t) => t.remove());
        this.destroyPicker();
    }

    /**
     * Cancel the picker: discard the editor's content and restore the host
     * value captured when the picker opened. This is the Escape path; the
     * arrow-exit and outside-click paths keep commit-on-close semantics because
     * there the user is navigating away from work they mean to keep.
     */
    protected cancelPicker(): void {
        if (this.discardStalePhoneMarking()) return;
        const snap = this._pickerCancelSnapshot;
        // Nothing from this editing session may be committed or reused.
        this._editorAssertions = null;
        this.finishClose();
        const restored = !!(snap && this.host.value !== snap.value);
        if (restored && snap) {
            // The host observed the intermediate picker edits as ordinary
            // input events, so the restore must notify too.
            this.setHostValue(snap.value);
        }
        this.afterCancel(restored);
    }

    /**
     * Subclass hook run after {@link cancelPicker} restored (or confirmed) the
     * host value: reset marking-position state that was derived from the
     * discarded value and repaint the display.
     *
     * @param valueRestored - True when the cancel actually rewrote the host
     *   value (state derived from the discarded value must be dropped)
     */
    protected abstract afterCancel(valueRestored: boolean): void;

    /** Controls acting on the open edit remain part of the field. */
    protected isFieldChrome(_node: Node): boolean {
        return false;
    }

    /**
     * Capture-phase Escape handler for a picker whose editor does not have
     * focus (an invalid draft left on screen while the user is elsewhere in the
     * field): Escape discards the edit. Escape inside the editor belongs to the
     * composer, whose first press only closes the list, so it is left alone
     * here. The two fields differ only in whether they restore the caret on
     * this path, delegated to {@link restoreCaretOnDocEscape}. The caret target
     * is captured BEFORE the close, since closing clears the textarea's active
     * range.
     */
    protected onDocKeydown(e: KeyboardEvent): void {
        if (!this.picker) return;
        const target = e.target as Node;
        if (this.isFieldChrome(target)) return;
        if (this.pickerMount?.contains(target) || this.picker.owns(target)) {
            return;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopImmediatePropagation();
            const caretTarget = this.escapeCaretTarget();
            this.cancelPicker();
            this.host.focus();
            this.restoreCaretOnDocEscape(caretTarget);
            this.afterClose();
        }
    }

    /**
     * Outside-click handler: closes the picker when the click lands outside the
     * picker mount and the display. Shared by both fields; refocuses the host
     * when the click was within the host or wrap.
     */
    protected async onDocClick(e: MouseEvent): Promise<void> {
        if (!this.picker) return;
        const t = e.target as Node;
        if (this.isFieldChrome(t)) return;
        if (this.pickerMount?.contains(t) || this.picker.owns(t)) return;
        if (this.display.contains(t)) return;
        this._explicitClose = true;
        await this.closePicker();
        if (this.host.contains(t) || this.wrap.contains(t)) {
            this.host.focus();
        }
        this.afterClose();
    }

    /**
     * Cancel the picker, place the caret, and run the post-close sync. A
     * host-level Escape refocuses the text host; explicit sheet Cancel keeps
     * the already parked permanent field box. The caret target is captured
     * BEFORE the close (the textarea clears its active range on close);
     * placement is delegated to {@link restoreCaretAfterEscape}.
     */
    protected escapeClosePicker(fromSheet = false): void {
        const caretTarget = this.escapeCaretTarget();
        this.cancelPicker();
        // Explicit sheet cancellation already parked the permanent visual box;
        // keyboard idle Escape still returns to the ordinary text editor.
        if (!fromSheet) this.host.focus();
        this.restoreCaretAfterEscape(caretTarget);
        this.afterClose();
    }

    /**
     * Caret target for the Escape paths: when the cancel will rewrite the host
     * value, the caret from the pre-open snapshot (positions derived from the
     * discarded value would be stale); otherwise the subclass's usual target.
     */
    private escapeCaretTarget(): number | null {
        const snap = this._pickerCancelSnapshot;
        if (snap && this.host.value !== snap.value) return snap.caret;
        return this.captureCaretTarget();
    }

    /**
     * Capture the caret position to restore after a close, evaluated BEFORE the
     * close runs. Returns `null` when the field has no marking-relative target
     * yet; subclasses interpret `null` as "use the live caret".
     */
    protected abstract captureCaretTarget(): number | null;

    /**
     * Place the caret after a host-level Escape close, using the pre-close
     * target captured by {@link captureCaretTarget}.
     */
    protected abstract restoreCaretAfterEscape(target: number | null): void;

    /**
     * Place the caret after a capture-phase (document) Escape close. The input
     * leaves the caret untouched here; the textarea restores it. Defaults to
     * no-op so the input needs no override.
     */
    protected restoreCaretOnDocEscape(_target: number | null): void {
        /* no caret restoration on the doc path by default */
    }

    /** Run the post-close re-sync (syncFromInput / syncFromTextarea). */
    protected abstract afterClose(): void;

    protected shouldShowTooltip(): boolean {
        return this.options.tooltips !== false;
    }

    /** Add native help to the concepts the field actually prints. */
    protected paintSegmentConceptHints(
        chip: HTMLElement,
        text: string,
        assertions: readonly Assertion[],
        assessment: ShownForm['assessment'],
    ): void {
        if (
            !this.shouldShowTooltip() ||
            chip.hasAttribute('data-ez-segment-tooltip')
        ) {
            chip.textContent = text;
            return;
        }

        const meta = this.engine.getSchemeMeta();
        const written = writtenFactTest(
            [{ formatId: this.scanFormat, assessment }],
            this.scheme.categories,
            meta,
        );
        const tree = buildTokenTree(
            assertions.filter((assertion) => !takenFromWhole(assertion)),
            this.scheme,
            meta,
            this.scanFormat,
        );
        const spans = locateTokenSpans(
            text,
            tree,
            (node) =>
                node.conceptId !== undefined &&
                // A tier can be collapsed into a compound that still prints
                // its label, for example SI in SI-G.
                written(
                    { conceptId: node.conceptId, categoryId: node.categoryId },
                    true,
                ),
        );

        let cursor = 0;
        for (const { start, end, token } of spans) {
            const concept = this.scheme.concepts.find(
                (c) => c.id === token.conceptId,
            );
            if (!concept) continue;
            const category = this.scheme.categories.find(
                (c) => c.id === token.categoryId,
            );
            const hint = conceptHint(
                category?.label ?? '',
                conceptHintName(concept, this.options.tooltipConceptProperty),
                concept.definition ?? '',
            );
            const span = document.createElement('span');
            span.dataset.ezSegmentConcept = '';
            span.dataset.conceptId = concept.id;
            span.title = hint.title;
            span.setAttribute('aria-description', hint.description);
            span.textContent = text.slice(start, end);
            chip.append(text.slice(cursor, start), span);
            cursor = end;
        }
        chip.append(text.slice(cursor));
    }

    protected segmentAttention(segment: {
        valid: boolean;
        errors: readonly string[];
        warnings?: readonly string[];
    }) {
        if (!segment.valid && segment.errors.length)
            return markAttention('invalid', segment.errors);
        if (segment.valid && segment.warnings?.length)
            return markAttention('warning', segment.warnings);
        return null;
    }

    /** Paint segment feedback and keep the native text surface interactive. */
    protected attachSegmentFeedback(
        chip: HTMLElement,
        className: string,
        segment: {
            valid: boolean;
            errors: readonly string[];
            warnings?: readonly string[];
        },
        open?: (event: Event) => void,
        openAttentionOnDesktop = false,
        remove?: () => void,
    ) {
        const attention = this.segmentAttention(segment);
        chip.className = !segment.valid
            ? `${className} ${className}--invalid`
            : attention
              ? `${className} ${className}--warning`
              : className;
        if (open) {
            chip.classList.add('ez-marked-field-tap-target');
            const consumeLongPress = remove
                ? bindMarkingLongPress(chip, () => {
                      hideTooltip(this.container);
                      this.closeTouchActions?.();
                      this.closeTouchActions = showMarkingActions(
                          this.wrap,
                          chip,
                          open,
                          remove,
                      );
                  })
                : undefined;
            // On touch layouts the painted chip owns the tap. Let scrolling
            // cancel the click and keep the native editor from taking focus.
            chip.addEventListener('mousedown', (event) => {
                if (window.matchMedia?.('(pointer: coarse)').matches)
                    event.preventDefault();
                else if (attention && openAttentionOnDesktop) open(event);
            });
            chip.addEventListener('click', (event) => {
                if (consumeLongPress?.(event)) return;
                if (
                    event.detail < 2 &&
                    window.matchMedia?.('(pointer: coarse)').matches
                )
                    open(event);
            });
        }
        if (attention && open && openAttentionOnDesktop) {
            chip.tabIndex = 0;
            chip.setAttribute('role', 'button');
            chip.setAttribute('aria-label', attention.label);
            chip.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') open(event);
            });
        }
        if (!attention || !this.shouldShowTooltip()) return attention;
        chip.dataset.ezSegmentTooltip = '';
        attachTooltip(
            chip,
            () => attention.tooltip,
            this.container,
            () =>
                chip.isConnected &&
                this.shouldShowTooltip() &&
                (!remove || !usesPhoneMarkingActions(chip)),
            undefined,
            undefined,
            () => ({ clearOf: this.wrap }),
        );
        return attention;
    }

    private closeTouchActions?: () => void;
    private footerAction?: { button: HTMLButtonElement; label: Text };
    private footerRemove?: HTMLButtonElement;
    private removeFromFooter?: () => void;

    protected setPhoneRemoveAction(remove?: () => void): void {
        this.removeFromFooter = remove;
        if (this.footerRemove) this.footerRemove.hidden = !remove;
    }

    protected setFooterMarkingAction(
        editing: boolean | undefined,
        disabled: boolean,
    ): void {
        if (!this.footerAction) return;
        const { button, label } = this.footerAction;
        button.disabled = disabled;
        if (editing === undefined) return;
        const text = t(editing ? 'mark.editMarking' : this.markingActionKey);
        if (button.getAttribute('aria-label') !== text) {
            label.data = ` ${text}`;
            button.setAttribute('aria-label', text);
            button.title = editing
                ? text
                : `${text} (${isMacPlatform() ? '⌘+Enter' : 'Ctrl+Enter'})`;
        }
    }
    private phoneEditOpening = false;

    /** A held Backspace can repeat before the async editor has mounted. */
    protected openFromPhoneEdit(
        event: Event,
        open: () => Promise<void>,
    ): boolean {
        if (!event.cancelable || event.defaultPrevented) return false;
        event.preventDefault();
        if (!this.phoneEditOpening && !this.picker) {
            this.phoneEditOpening = true;
            void open().finally(() => {
                this.phoneEditOpening = false;
            });
        }
        return true;
    }

    private hoveredSegment: HTMLElement | undefined;

    private segmentHoverTitle:
        { original: string | null; applied: string } | undefined;

    protected readonly clearSegmentHover = () => {
        this.hoveredSegment?.dispatchEvent(new MouseEvent('mouseleave'));
        this.hoveredSegment = undefined;
        const title = this.segmentHoverTitle;
        this.segmentHoverTitle = undefined;
        if (!title || this.host.getAttribute('title') !== title.applied) return;
        if (title.original === null) this.host.removeAttribute('title');
        else this.host.title = title.original;
    };

    /**
     * The native editor owns the pointer so it can place the caret and select
     * text. Hover alone can inspect the painted mark beneath that editor.
     */
    private readonly forwardSegmentHover = (event: PointerEvent): void => {
        if (
            event.pointerType !== 'mouse' ||
            event.buttons ||
            event.target !== this.host ||
            this.picker ||
            !this.shouldShowTooltip()
        ) {
            this.clearSegmentHover();
            return;
        }
        const { clientX: x, clientY: y } = event;
        const contains = (chip: HTMLElement) =>
            [...chip.getClientRects()].some(
                ({ left, right, top, bottom }) =>
                    x >= left && x <= right && y >= top && y <= bottom,
            );
        if (this.hoveredSegment?.isConnected && contains(this.hoveredSegment))
            return;
        this.clearSegmentHover();
        const chip = [
            ...this.display.querySelectorAll<HTMLElement>(
                '[data-ez-segment-tooltip], [data-ez-segment-concept]',
            ),
        ].find(contains);
        this.hoveredSegment = chip;
        if (chip?.hasAttribute('data-ez-segment-concept')) {
            this.segmentHoverTitle = {
                original: this.host.getAttribute('title'),
                applied: chip.title,
            };
            this.host.title = chip.title;
        } else {
            chip?.dispatchEvent(new MouseEvent('mouseenter'));
        }
    };

    /**
     * Close the picker. The two fields save editor assertions and (for the
     * textarea) write the editor content back, so the body stays per-subclass.
     */
    protected abstract closePicker(...args: unknown[]): void | Promise<void>;

    /**
     * Destroy the field, first committing a draft left open in its editor the
     * way a press outside the field would (see teardown-write.ts). Both marked
     * fields route destroy() here.
     *
     * @param teardown - The field's own teardown
     */
    protected destroyAfterDraft(teardown: () => void): void {
        this.closeTouchActions?.();
        teardownAfterWrite(
            this,
            this.picker?.hasDraft() ? () => this.commitOpenEditor() : null,
            teardown,
        );
    }

    /**
     * Close the open editor through its commit path and write the result into
     * the field: host text, then the field's own sync and change event.
     */
    protected abstract commitOpenEditor(): Promise<void>;

    // --- ComponentInstance surface the subclasses keep implementing ----------

    abstract init(
        container: HTMLDivElement,
        engineOrContext?: ComponentEngineSource | null,
        options?: ComponentOptions,
    ): Promise<void>;
    abstract getAssertions(): Assertion[];
    abstract setAssertions(assertions: Assertion[]): void;
    abstract setValue(value: string): void;
    abstract getRendered(): string;
    abstract destroy(): void;
}
