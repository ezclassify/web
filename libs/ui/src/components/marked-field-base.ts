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
 * sync, the keyboard hint + touch "Add marking" footer, the inline-picker
 * lifecycle (close/destroy, close-on-Escape, close-on-outside-click), and the
 * teardown sequence. That shared logic lives here. The genuine differences are
 * abstract hooks the subclasses provide.
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
    isAddressableSchemeEngine,
    resolveProfile,
    resolveSchemeEngine,
    resolveContextSource,
} from './component-base-readonly';
import { isMacPlatform } from './dom-helpers';
import { takenFromWhole } from '../assertion-identity';
import { t } from '../i18n';
import { wrapPartMark } from './marked-text-area-logic';
import { adoptStylesOnce } from '../styles/adopt';
import { attachTooltip, COMPONENT_CSS } from './component-utils';
import {
    assertDescribesConcepts,
    createConceptDescriber,
} from './concept-description';
import { defaultSurfaceOf, resolveOutput } from '../format-resolver';
import type { InlineMarkingEditor } from './inline-marking-editor';
import { createClearButton, type ClearButton } from './clear-button';

/**
 * CSS class-name set a concrete field uses. Keeps the shared scaffolding (wrap,
 * display, hint, touch-add, picker-active marker) host-specific so the existing
 * stylesheets keep matching byte-for-byte.
 */
export interface MarkedFieldClassNames {
    /** Wrapper div inserted around the host element. */
    wrap: string;
    /** Visible display layer that mirrors the host. */
    display: string;
    /**
     * Footer row holding the keyboard hint / touch "Add marking" button and the
     * trailing chrome slot, in one flex row so the chrome always lands
     * right-aligned opposite whichever of the two is currently shown.
     */
    footer: string;
    /** Keyboard-hint footer. */
    kbHint: string;
    /** Touch "Add marking" button. */
    touchAdd: string;
    /**
     * Chrome slot: the field's status mark and (when wired) its ★ favorites
     * button, hanging off the field's bottom-right edge. It stays there at rest
     * and while the inline editor is open, so the controls never move between
     * states, and the editor, which opens below or above the line being edited,
     * never has to push them aside.
     */
    hintChrome: string;
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
> implements ComponentInstance {
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
            this.schemeAddressing && isAddressableSchemeEngine(this.engine)
                ? this.engine.validate(marking, this.schemeId, {
                      outputFormat: this.scanFormat,
                  })
                : this.engine.validate(marking, {
                      outputFormat: this.scanFormat,
                  }),
        );
        return {
            assertions: result.assertions,
            rendered: result.rendered,
            appliedFixes: result.appliedFixes,
        };
    }
    /** Expand a named scheme preset through the bound adapter. */
    protected callApplyPreset(presetId: string, outputFormat?: string) {
        const options = outputFormat ? { outputFormat } : undefined;
        if (this.schemeAddressing && isAddressableSchemeEngine(this.engine)) {
            return this.engine.applyPreset(presetId, this.schemeId, options);
        }
        return this.engine.applyPreset(presetId, options);
    }
    /**
     * The engine source the field was mounted with (direct argument or ancestor
     * provider): the composed context when the host injected one, the bare
     * scheme adapter otherwise. Held so a nested component can be mounted with
     * the same source rather than a narrowed copy of it.
     */
    protected engineSource!: ComponentEngineSource;

    /** Whether calls from this bare adapter may include an explicit scheme id. */
    protected get schemeAddressing(): boolean {
        return (
            !('scheme' in this.engineSource) &&
            isAddressableSchemeEngine(this.engine)
        );
    }
    protected container!: HTMLDivElement;
    protected options: ComponentOptions = {};
    protected schemeId!: string;
    protected scheme!: SchemePublicView;
    protected wrap!: HTMLDivElement;
    protected host!: H;
    protected display!: HTMLDivElement;
    /**
     * The chrome slot (see {@link MarkedFieldClassNames.hintChrome}), appended
     * by {@link appendFooter}. The subclass mounts its status mark and (when
     * wired) favorites button into it with `shape: 'chrome'`.
     */
    protected hintChrome!: HTMLDivElement;
    private clearControl?: ClearButton;

    protected embeddedStyle: EmbeddedMarkingStyle | null = null;
    /** Resolved from the scheme in bindEngine; empty until then. */
    protected scanFormat = '';
    protected scanSeq = 0;
    protected hasFocus = false;

    protected picker: InlineMarkingEditor | null = null;
    protected pickerMount: HTMLElement | null = null;
    /**
     * The theme MutationObserver on document.documentElement. Stored so
     * {@link disconnectThemeObserver} can tear it down on destroy; otherwise
     * every mounted field leaks a live observer (and its closure over the
     * detached DOM) for the page lifetime.
     */
    protected _themeObserver: MutationObserver | null = null;
    protected _explicitClose = false;
    protected _lastCloseTime = 0;
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
    /** Footer hint suffix text (e.g. " to set marking" / " to add marking"). */
    protected abstract readonly hintSuffix: string;
    /** I18n key naming the footer hint button's action. */
    protected abstract readonly hintActionKey:
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
            container,
            engineOrContext,
            this.componentLabel,
        );
        assertDescribesConcepts(resolvedEngine, this.componentLabel);
        this.engine = resolvedEngine;
        this.engineSource =
            resolveContextSource(container, engineOrContext) ?? resolvedEngine;
        this.container = container;
        this.schemeId = resolveProfile(
            container,
            resolvedEngine,
            this.options,
            this.schemeAddressing,
        );
        const resolvedScheme = this.schemeAddressing
            ? resolvedEngine.getScheme(this.schemeId)
            : resolvedEngine.getScheme();
        this.scheme = resolvedScheme;
        this.embeddedStyle =
            (
                resolvedScheme as unknown as {
                    embeddedMarking?: EmbeddedMarkingStyle[];
                }
            ).embeddedMarking?.[0] ?? null;
        const formats = this.scheme.formats ?? [];
        // The host's spelling is resolved to the output it names: an output id
        // as it is, a bare view id to that view on the field's surface. A
        // scheme that lists no formats leaves nothing to check it against.
        const requested =
            requestedFormat !== undefined && formats.length === 0
                ? requestedFormat
                : requestedFormat &&
                  resolveOutput(
                      formats,
                      requestedFormat,
                      this.options.scope ??
                          defaultSurfaceOf(
                              formats,
                              this.scheme.defaultRenderFormat,
                          ),
                  );
        // Every fallback comes out of the scheme. A literal format id here
        // would be a data value in code: a scheme that declares no format under
        // that name gets an id it never heard of. Both fields write parts, so a
        // spelling the scheme does not have falls back to the part default.
        this.scanFormat =
            requested ||
            this.pickPartFormat() ||
            this.schemeDefaultFormat(formats.map((format) => format.id));
    }

    /**
     * Adopt the component stylesheet onto the container's root and mark the
     * container for scoped CSS. The sheet is adopted for the lifetime of the
     * root and shared by every instance built from the same CSS.
     */
    protected injectStyle(): void {
        this.container.setAttribute('data-ezclassify', '');
        adoptStylesOnce(COMPONENT_CSS + this.css, this.container);
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

    /**
     * Watch the document root for theme attribute changes and re-sync the
     * display's color/background/at-rest border to match the themed host. An
     * owned editor can supply its original native input as the paint source.
     */
    protected installThemeObserver(
        capturedStyles: Record<string, string>,
        hostInputClass: string,
        paintHost: HTMLElement = this.host,
    ): void {
        if (typeof MutationObserver === 'undefined') return;
        // Replace any prior observer (defensive against a double install).
        this.disconnectThemeObserver();
        const observer = new MutationObserver(() => {
            const masked = paintHost === this.host;
            const transitionProperty = paintHost.style.getPropertyValue(
                'transition-property',
            );
            const transitionPriority = paintHost.style.getPropertyPriority(
                'transition-property',
            );
            let paint: {
                color: string;
                backgroundColor: string;
                borderColor: string;
            };
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
                paint = {
                    color: cs.color,
                    backgroundColor: cs.backgroundColor,
                    borderColor: cs.borderColor,
                };
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
            this.display.style.color = paint.color;
            this.display.style.backgroundColor = paint.backgroundColor;
            // Keep the at-rest border current so blur restores themed paint.
            capturedStyles.borderColor = paint.borderColor;
            if (!this.hasFocus)
                this.display.style.borderColor = paint.borderColor;
        });
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: [
                'data-color-scheme',
                'data-theme',
                'data-bs-theme',
                'class',
            ],
        });
        this._themeObserver = observer;
    }

    /** Disconnect and drop the theme observer installed by installThemeObserver. */
    protected disconnectThemeObserver(): void {
        this.clearControl?.destroy();
        this.clearControl = undefined;
        this._themeObserver?.disconnect();
        this._themeObserver = null;
    }

    /**
     * Append the footer row (keyboard hint + touch "Add marking") and the
     * chrome slot to the wrap. The touch-add click delegates to
     * {@link triggerAddMarking}.
     *
     * The status mark and ★ favorites button live in {@link hintChrome}, which
     * hangs off the field's bottom-right edge in every state (see
     * {@link MarkedFieldClassNames.hintChrome}), keeping their position stable
     * while the inline editor opens.
     */
    protected appendFooter(): void {
        const footer = document.createElement('div');
        footer.className = this.classNames.footer;

        // Keyboard hint is optional guidance; hosts disable it with
        // data-ezclassify-no-hints. The touch "Add marking" button below is
        // core interaction on coarse pointers and is never disabled.
        //
        // A REAL button, not decorative text: it performs the exact same
        // action as the ⌘/Ctrl+Enter shortcut it documents (insert the
        // marking template at caret + open the inline picker: the same
        // triggerAddMarking() path the touch "+ Add marking" button uses),
        // so a mouse/trackpad user who never learns the shortcut still has a
        // click path to it. Real button semantics (focusable, hoverable,
        // clickable) with the same quiet hint styling; see
        // .marked-input-kb-hint / .marked-textarea-kb-hint's button reset.
        if (this.options.hints !== false) {
            const mac = isMacPlatform();
            const hint = document.createElement('button');
            hint.type = 'button';
            hint.className = this.classNames.kbHint;
            // Keep the visible label in the accessible name for voice control.
            // aria-keyshortcuts also exposes the platform shortcut semantically.
            hint.setAttribute(
                'aria-keyshortcuts',
                mac ? 'Meta+Enter' : 'Control+Enter',
            );
            const kbd = document.createElement('kbd');
            kbd.setAttribute('aria-hidden', 'true');
            kbd.textContent = `${mac ? '\u2318' : 'Ctrl'}+Enter`;
            hint.setAttribute(
                'aria-label',
                `${kbd.textContent}${this.hintSuffix}`,
            );
            hint.appendChild(kbd);
            const suffix = document.createElement('span');
            suffix.setAttribute('aria-hidden', 'true');
            suffix.textContent = this.hintSuffix;
            hint.appendChild(suffix);
            hint.addEventListener('click', (e) => {
                e.preventDefault();
                this.triggerAddMarking();
            });
            footer.appendChild(hint);
        }

        // Touch affordance: a tappable "Add marking" with the SAME effect as
        // Cmd/Ctrl+Enter. Shown only on coarse pointers (CSS), where the keyboard
        // hint is hidden; there is no keyboard there.
        const touchAdd = document.createElement('button');
        touchAdd.type = 'button';
        touchAdd.className = this.classNames.touchAdd;
        touchAdd.textContent = `+ ${t(this.hintActionKey)}`;
        touchAdd.addEventListener('click', (e) => {
            e.preventDefault();
            this.triggerAddMarking();
        });
        footer.appendChild(touchAdd);

        this.wrap.appendChild(footer);

        // Last in the wrap, so Tab reaches the field, its fixes and the hint
        // before the chrome; CSS hangs it above the field's bottom-right edge.
        this.hintChrome = document.createElement('div');
        this.hintChrome.className = this.classNames.hintChrome;
        this.wrap.appendChild(this.hintChrome);
        this.clearControl = createClearButton({
            label: t('aria.clearText'),
            host: this.host,
            empty: () => this.host.value.length === 0,
            clear: () => {
                ++this.scanSeq;
                this._editorAssertions = null;
                this.finishClose();
                this.setValue('');
                // This is a user edit, so observers receive the same native event as typing.
                this.host.dispatchEvent(new Event('input', { bubbles: true }));
            },
        });
        this.wrap.classList.add('ez-clear-text');
        this.wrap.insertBefore(this.clearControl.button, this.hintChrome);
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

    /**
     * The scheme's declared render format for a part of a marking, if it names
     * one. Matches the `defaultPartRenderFormat` field it reads.
     *
     * @returns The format id, or undefined when the scheme declares none
     */
    protected pickPartFormat(): string | undefined {
        return (
            this.engine.getSchemeMeta(this.schemeId).defaultPartRenderFormat ??
            undefined
        );
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
    protected pickerOpenSeq = 0;

    protected destroyPicker(): void {
        this.pickerOpenSeq++;
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
     * Cancel the picker in response to a host-level Escape, refocus the host,
     * place the caret, and run the post-close sync. The caret target is
     * captured BEFORE the close (the textarea clears its active range on
     * close); placement is delegated to {@link restoreCaretAfterEscape}.
     */
    protected escapeClosePicker(): void {
        const caretTarget = this.escapeCaretTarget();
        this.cancelPicker();
        this.host.focus();
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

    // --- Concept dwell tooltip: the one resolution path a marking chip's
    // hover reads from, shared with the dropdown row and MarkingField token
    // tooltips via `createConceptDescriber`. -------------------------------

    /**
     * Concept-detail resolution and its result cache for this instance, shared
     * with every other field class via `createConceptDescriber`. Constructed
     * here even though `engine` and `schemeId` are not assigned until `init()`
     * runs; the describer reads those fields live on each call, not at
     * construction time.
     */
    private readonly _conceptDescriber = createConceptDescriber({
        engine: () => this.engine,
        schemeId: () => this.schemeId,
        schemeAddressing: () => this.schemeAddressing,
        options: () => this.options,
    });

    /** Resolve one concept's detail text (see `createConceptDescriber`). */
    protected resolveConceptDescription(
        conceptId: string,
        categoryId: string,
    ): string | undefined {
        return this._conceptDescriber.resolve(conceptId, categoryId);
    }

    /**
     * Guard for tooltip display: honors the host's declarative opt-out
     * (`data-ezclassify-no-tooltips` → options.tooltips === false). The one
     * spelling of this predicate every tooltip on a marked field reads,
     * concept-detail or not (segment chips, the status mark, the invalid-
     * marking error tooltip).
     */
    protected shouldShowTooltip(): boolean {
        return this._conceptDescriber.enabled();
    }

    /**
     * Join every assertion in a marking segment into one tooltip body,
     * blank-line separated so the tooltip's line parser treats each concept as
     * its own block. A segment can hold more than one concept (e.g. "[[H/A]]"
     * is HIGH + CTRL-A), unlike MarkingField's per-token paint, which already
     * isolates one concept per hoverable span.
     *
     * Returns undefined while any assertion's description is still resolving
     * asynchronously, so a caller polling for content (attachTooltip) waits for
     * the whole segment rather than showing a partial result that then never
     * completes.
     */
    private describeSegment(assertions: Assertion[]): string | undefined {
        if (assertions.length === 0) return undefined;
        const blocks: string[] = [];
        for (const a of assertions) {
            const text = this.resolveConceptDescription(
                a.conceptId,
                a.categoryId,
            );
            if (text === undefined) return undefined;
            blocks.push(text);
        }
        return blocks.join('\n\n');
    }

    /**
     * Attach the segment's concept-description tooltip to its chip element. It
     * describes what the mark says: a value taken from the whole for a word in
     * the mark is the whole's, so the chip does not describe it.
     */
    protected attachSegmentTooltip(
        el: HTMLElement,
        assertions: Assertion[],
    ): void {
        const written = assertions.filter((a) => !takenFromWhole(a));
        if (written.length === 0) return;
        attachTooltip(
            el,
            () => this.describeSegment(written),
            this.container,
            () => this.shouldShowTooltip(),
        );
    }

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
