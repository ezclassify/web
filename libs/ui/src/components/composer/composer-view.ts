/**
 * ComposerView: the one row renderer and surface every field's picker paints.
 *
 * The view owns DOM and events only. It forwards the field input's events to a
 * {@link ComposerController} and paints each snapshot: the pinned result row,
 * the needed strip, the list (flat and ranked for a query, grouped for
 * browsing), gated rows and the live region. What a key or tap means is decided
 * by the controller, never here.
 *
 * Surfaces. On a fine pointer, or on any viewport at least
 * {@link SHEET_BREAKPOINT} wide, the list is a popover anchored to the field. On
 * a coarse pointer below that width it is a sheet docked to the top of the
 * keyboard, with its own copy of the field at the top so the typed text stays
 * in view, under a bar with Cancel and Done so a phone user can see how to
 * finish. The sheet's input becomes the focus owner while the sheet is open;
 * the field's own input mirrors the draft and shows it when the sheet closes.
 *
 * Accessibility follows the APG editable combobox with a grouped listbox: the
 * text input owns row and category navigation; heading arrows jump categories.
 * The active row is conveyed through `aria-activedescendant`, `aria-selected`
 * means "in the marking" and nothing else, group labels are presentational and
 * never in the arrow path, key hints are aria-hidden and shown on fine pointers
 * only, and one polite live region per field carries counts, the result,
 * commits and parse failures.
 */

import { t } from '../../i18n';
import { isMacPlatform } from '../dom-helpers';
import { portalViewportOverlay } from '../overlay-portal';
import type { AdoptedStyles } from '../../styles/adopt';
import {
    isInternalScroll,
    listenForViewportChanges,
    popoverSide,
    positionPopover,
    positionCompactSheet,
    positionSheet,
    revealRow,
    keyboardUp,
    holdPageScroll,
} from './composer-placement';
import {
    isTypingFragment,
    ruleMessageOf,
    type CommitOutcome,
    type ComposerController,
    type ComposerRow,
    type ComposerSnapshot,
} from './composer-controller';
import { ruleErrorsFrom } from '../rule-errors';
import composerCss from './composer.css?inline';

/** More broken rules than this fold under one line in the result row. */
const FOLD_OVER = 3;

/** Below this width a coarse pointer gets the docked sheet. */
export const SHEET_BREAKPOINT = 768;

/** Ranked rows shown before "more", by surface. */
const CAP_POPOVER = 8;
const CAP_SHEET = 5;

/** How often, and how many times, an active row asks again for its definition. */
const DEFINITION_RETRY_MS = 200;
const DEFINITION_RETRIES = 10;

/** Rows PageUp and PageDown move the active row by. */
const PAGE = 5;

/** Change marks shown in the result row before the rest become a count. */
const MAX_CHANGE_MARKS = 4;

/**
 * Delay before a blur commits when the blur came from a press on the surface,
 * so that press (a row, the result row) lands first: some platforms take focus
 * away from the input on the press, before its own click handler runs. Any
 * other blur commits at once.
 */
const BLUR_COMMIT_DELAY_MS = 120;

/** Why the composer is opening. */
export type ComposerOpenReason = 'typing' | 'keyboard' | 'pointer' | 'api';

/** What a field tells the view about itself. */
export interface ComposerViewOptions {
    readonly controller: ComposerController;
    /** The field's own text input (the focus owner on a popover). */
    readonly input: HTMLInputElement | HTMLTextAreaElement;
    /** The field box the popover anchors to and never covers. */
    readonly anchor: HTMLElement;
    /** The box the popover's left edge is clamped within. */
    readonly bounds?: HTMLElement;
    /** Owning field when the anchor is an inline editor within body text. */
    readonly field?: HTMLElement;
    /**
     * The field's accessible name: the id of a visible label when there is one,
     * and its text for surfaces that need a string.
     */
    readonly label: () => { id?: string; text: string };
    /** CSS that must follow the portaled surface (the field's own sheet). */
    readonly css?: string;
    /** Validation of the held marking when there is no unsaved draft. */
    readonly committedValidity?: () => string;
    /** Always swallow Enter (a textarea or inline editor holding one line). */
    readonly singleLine?: boolean;
    /** Placeholder for the sheet's input. */
    readonly placeholder?: string;
    /** Concept detail for the active row's definition line. */
    readonly describeConcept?: (
        conceptId: string,
        categoryId: string,
    ) => string | undefined;
    /** The composer opened, closed or changed side. */
    readonly onPlacement?: (
        open: boolean,
        side: 'above' | 'below' | 'sheet',
    ) => void;
    /** The draft text changed; the field mirrors it (height, width, paint). */
    readonly onDraft?: (text: string) => void;
    /**
     * Whether a node focus moves to is the field's own chrome (its favorites
     * button, say). Focus going there waits out the same grace period as a
     * press on the list instead of committing at once, so a control that works
     * on the open edit still finds it open.
     */
    readonly isFieldChrome?: (node: Node) => boolean;
    /** A blur finished committing. */
    readonly onBlurCommit?: (outcome: CommitOutcome) => void;
    /**
     * Escape found nothing to do in the composer (list closed, draft clean).
     * Return true when the field used the key.
     */
    readonly onEscapeIdle?: () => boolean;
    /**
     * Enter (or Done) committed, stored or unchanged, and the composer closed.
     * `fromSheet` says it closed the phone sheet, where the field should not
     * take focus back (that would bring the keyboard up again).
     */
    readonly onEnterCommit?: (
        outcome: CommitOutcome,
        fromSheet: boolean,
    ) => void;
}

let nextId = 0;

/**
 * A field input's accessible name, for the listbox and the sheet: its
 * `aria-labelledby` target, else its `aria-label`, else its visible label
 * (given an id so it can be referenced), else `fallback`.
 */
export function accessibleLabel(
    input: HTMLInputElement | HTMLTextAreaElement,
    fallback: string,
): { id?: string; text: string } {
    // The accessible name's own order: aria-labelledby, then aria-label, then
    // a <label>. A field can carry a short aria-label beside a <label> that
    // also holds instructions; its name is the short one.
    const ref = input.getAttribute('aria-labelledby');
    if (ref) {
        const target = document.getElementById(ref.split(/\s+/)[0]);
        if (target)
            return {
                id: target.id,
                text: target.textContent?.trim() || fallback,
            };
    }
    const named = input.getAttribute('aria-label')?.trim();
    if (named) return { text: named };
    const label = input.labels?.[0];
    if (label) {
        if (!label.id) {
            label.id = `ez-label-${++nextId}-${Math.random().toString(36).slice(2, 6)}`;
        }
        return { id: label.id, text: label.textContent?.trim() || fallback };
    }
    return { text: fallback };
}

/**
 * Shorten a title that does not fit by taking words out of its middle, so its
 * start (what it is, "Paragraph 2:") and its end (the field's own last words)
 * both stay readable: "Paragraph 2: Document … portion markings". The start is
 * the words up to one ending in a colon among the first three, or else the
 * first word.
 *
 * @param text - The whole title
 * @param fits - Whether a candidate fits the space it has
 * @returns The title, or the longest shortened form that fits
 */
export function middleEllipsis(
    text: string,
    fits: (candidate: string) => boolean,
): string {
    if (fits(text)) return text;
    const words = text.split(/\s+/).filter(Boolean);
    const colon = words.slice(0, 3).findIndex((w) => w.endsWith(':'));
    const head = words.slice(0, colon >= 0 ? colon + 1 : 1).join(' ');
    const rest = words.slice(colon >= 0 ? colon + 1 : 1);
    for (let keep = rest.length - 1; keep >= 1; keep--) {
        const candidate = `${head} \u2026 ${rest.slice(-keep).join(' ')}`;
        if (fits(candidate)) return candidate;
    }
    return `${head} \u2026`;
}

/** See the module comment. */
export class ComposerView {
    readonly announcer: HTMLDivElement;
    /** Shown under the field while a draft is invalid and the list is closed. */
    readonly note: HTMLDivElement;
    readonly surface: HTMLDivElement;
    readonly list: HTMLDivElement;

    private readonly opts: ComposerViewOptions;
    private readonly controller: ComposerController;
    private readonly id: string;
    private readonly result: HTMLDivElement;
    private readonly resultContent: HTMLDivElement;
    private readonly needs: HTMLDivElement;
    private readonly status: HTMLDivElement;
    private readonly gated: HTMLDivElement;
    private readonly footer: HTMLDivElement;
    private readonly sheetField: HTMLDivElement;
    private readonly sheetDone: HTMLButtonElement;
    private readonly sheetCancel: HTMLButtonElement;
    private readonly sheetLabel: HTMLDivElement;
    /** The sheet's whole title; the label may show it shortened. */
    private sheetTitle = '';
    private readonly sheetInput: HTMLInputElement;
    private readonly portalStyle: AdoptedStyles | null;
    private readonly unsubscribe: () => void;
    private readonly listeners: Array<() => void> = [];
    private sheet = false;
    /**
     * The sheet with the keyboard up (see keyboardUp): only the bar, the input,
     * a one-line result and the rules' fold line stay fixed; everything else
     * scrolls with the list.
     */
    private compact = false;
    /** The rules' fold is open (kept across reads, reset on each open). */
    private problemsOpen = false;
    /** The result, needs and options share one scrollport in every layout. */
    private readonly scroller: HTMLDivElement;
    /** Releases the page held still while the sheet is open. */
    private releasePage: (() => void) | null = null;
    private placed = false;
    /**
     * The popover's side is fixed for this open. Set on the first placement
     * after the list's content is known (catalog loaded, draft read): a side
     * chosen for an empty list would lock a long list into the smaller room.
     */
    private sideLocked = false;
    /**
     * Set when this open's popover did not fit with the broken rules listed in
     * full, so they fold under one line (see {@link paintResult}).
     */
    private foldForRoom = false;
    private stopViewport: (() => void) | null = null;
    private pointerIntent = false;
    private pressInSurface = false;
    private blurTimer: ReturnType<typeof setTimeout> | null = null;
    private lastQuery = '';
    private destroyed = false;
    /** Nonzero while the field writes its own committed value back. */
    private muted = 0;

    constructor(options: ComposerViewOptions) {
        this.opts = options;
        this.controller = options.controller;
        this.id = `ez-composer-${++nextId}-${Math.random().toString(36).slice(2, 6)}`;

        this.announcer = document.createElement('div');
        this.announcer.className = 'ez-sr-only';
        this.announcer.setAttribute('role', 'status');
        this.announcer.setAttribute('aria-live', 'polite');
        this.announcer.setAttribute('aria-atomic', 'true');

        this.note = document.createElement('div');
        this.note.className = 'ez-composer-note';
        this.note.id = `${this.id}-note`;
        this.note.hidden = true;

        this.surface = document.createElement('div');
        this.surface.className = 'ez-composer';
        this.surface.id = this.id;
        this.surface.hidden = true;

        this.sheetField = document.createElement('div');
        this.sheetField.className = 'ez-composer__sheet-field';
        this.sheetLabel = document.createElement('div');
        this.sheetLabel.className = 'ez-composer__sheet-label';
        this.sheetLabel.id = `${this.id}-sheet-label`;
        this.sheetInput = document.createElement('input');
        this.sheetInput.type = 'text';
        this.sheetInput.className = 'ez-composer__sheet-input';
        this.sheetInput.setAttribute('autocomplete', 'off');
        this.sheetInput.setAttribute('autocapitalize', 'characters');
        this.sheetInput.setAttribute('spellcheck', 'false');
        this.sheetInput.setAttribute('aria-labelledby', this.sheetLabel.id);
        if (options.placeholder)
            this.sheetInput.placeholder = options.placeholder;
        // The keyboard's Done key and a tap outside are the only other ways
        // to finish, and neither says so. The bar names both ways out where a
        // phone user expects them: Cancel on the left, Done on the right.
        const barButton = (className: string, text: string) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `ez-composer__sheet-button ${className}`;
            button.textContent = text;
            return button;
        };
        this.sheetCancel = barButton(
            'ez-composer__sheet-cancel',
            t('composer.cancel'),
        );
        this.sheetDone = barButton(
            'ez-composer__sheet-done',
            t('composer.done'),
        );
        const bar = document.createElement('div');
        bar.className = 'ez-composer__sheet-bar';
        bar.append(this.sheetCancel, this.sheetLabel, this.sheetDone);
        this.sheetField.append(bar, this.sheetInput);

        this.result = document.createElement('div');
        this.result.className = 'ez-composer__result';
        this.result.id = `${this.id}-result`;
        this.resultContent = document.createElement('div');
        this.resultContent.className = 'ez-composer__result-content';
        this.result.appendChild(this.resultContent);

        this.needs = document.createElement('div');
        this.needs.className = 'ez-composer__needs';

        this.status = document.createElement('div');
        this.status.className = 'ez-composer__status';

        this.list = document.createElement('div');
        this.list.className = 'ez-composer__list';
        this.list.id = `${this.id}-list`;
        this.list.setAttribute('role', 'listbox');
        this.list.setAttribute('aria-multiselectable', 'true');

        this.gated = document.createElement('div');
        this.gated.className = 'ez-composer__gated';

        this.footer = document.createElement('div');
        this.footer.className = 'ez-composer__footer';
        this.footer.setAttribute('aria-hidden', 'true');

        this.scroller = document.createElement('div');
        this.scroller.className = 'ez-composer__scroll';
        this.scroller.append(
            this.result,
            this.needs,
            this.status,
            this.list,
            this.gated,
        );

        this.surface.append(this.sheetField, this.scroller, this.footer);
        this.portalStyle = portalViewportOverlay(
            this.surface,
            options.anchor,
            (options.css ?? '') + composerCss,
        );

        this.wireInput(options.input);
        this.wireInput(this.sheetInput);
        this.wireSurface();
        this.applyComboboxAttrs(options.input);
        this.unsubscribe = this.controller.subscribe((s) => this.paint(s));
        this.paint(this.controller.snapshot());
    }

    // --- Public ------------------------------------------------------------------

    /** The input that owns focus right now (the sheet's while it is open). */
    get activeInput(): HTMLInputElement | HTMLTextAreaElement {
        return this.sheet && this.controller.isOpen
            ? this.sheetInput
            : this.opts.input;
    }

    /** Whether focus is in the field's input, the sheet's, or the surface. */
    private holdsFocus(): boolean {
        const active = document.activeElement;
        return (
            active === this.opts.input ||
            active === this.sheetInput ||
            (active instanceof Node && this.surface.contains(active))
        );
    }

    /** True while the sheet (not the popover) is the surface. */
    get isSheet(): boolean {
        return this.sheet;
    }

    /** Open the composer. `pointer` and `api` opens may move to the sheet. */
    async open(reason: ComposerOpenReason): Promise<void> {
        if (this.destroyed) return;
        const wasOpen = this.controller.isOpen;
        if (!wasOpen) {
            // A hardware keyboard on a tablet keeps the popover: the sheet is
            // for a tap that brings up the on-screen keyboard.
            this.sheet =
                (reason === 'pointer' || reason === 'api') && this.wantsSheet();
            this.placed = false;
            this.sideLocked = false;
            // A new open starts the sheet at its content's height again.
            delete this.surface.dataset.sheetHeight;
            this.foldForRoom = false;
            this.problemsOpen = false;
            this.controller.setCap(this.sheet ? CAP_SHEET : CAP_POPOVER);
        }
        const opening = this.controller.open(reason !== 'typing');
        if (!wasOpen && this.sheet) {
            this.releasePage?.();
            this.releasePage = holdPageScroll(document);
            this.sheetInput.value = this.controller.draftText;
            // Focus moves inside the user's own tap, so the keyboard stays up.
            this.sheetInput.focus();
            const caret = this.controller.draftCaret;
            this.sheetInput.setSelectionRange(caret, caret);
        }
        await opening;
    }

    /**
     * Close the composer. A closing popover leaves focus in the field; a
     * closing sheet hands it to the field box (see {@link parkFocus}).
     */
    close(): void {
        const wasSheet = this.sheet && this.controller.isOpen;
        this.controller.close();
        if (wasSheet && this.surface.contains(document.activeElement)) {
            this.parkFocus();
        }
    }

    /**
     * Return focus to the field after the sheet closes, without its text input:
     * on a phone, focusing the input would bring the keyboard up again for an
     * edit that just ended. The field box takes focus until the next move, so
     * neither the place in the page nor a screen reader's position is lost to
     * the document body.
     */
    private parkFocus(): void {
        if (this.destroyed) return;
        const anchor = this.opts.anchor;
        const focused = document.activeElement;
        // Focus the host has already placed somewhere else stays there.
        if (
            focused &&
            focused !== document.body &&
            !this.surface.contains(focused) &&
            !anchor.contains(focused)
        ) {
            return;
        }
        const leave = () => {
            if (focused instanceof HTMLElement) focused.blur();
        };
        if (!anchor.isConnected) return leave();
        const borrowed = !anchor.hasAttribute('tabindex');
        if (borrowed) anchor.tabIndex = -1;
        anchor.focus({ preventScroll: true });
        if (!borrowed) return;
        if (document.activeElement !== anchor) {
            anchor.removeAttribute('tabindex');
            return leave();
        }
        anchor.addEventListener(
            'blur',
            () => anchor.removeAttribute('tabindex'),
            { once: true },
        );
    }

    /** Refresh native validity after the held marking's diagnostics change. */
    refreshValidity(): void {
        this.paint(this.controller.snapshot());
    }

    /** Tear down listeners and the portaled surface. */
    destroy(): void {
        this.destroyed = true;
        // A blur commit still waiting on a press goes with the view. The field
        // commits an open draft itself before it tears down (see
        // teardown-write.ts), through the same commit a blur would run.
        if (this.blurTimer) clearTimeout(this.blurTimer);
        if (this.definitionRetry.timer)
            clearTimeout(this.definitionRetry.timer);
        this.unsubscribe();
        for (const off of this.listeners) off();
        this.stopViewport?.();
        this.releasePage?.();
        this.releasePage = null;
        this.surface.remove();
        this.portalStyle?.release();
        this.announcer.remove();
        this.note.remove();
        const input = this.opts.input;
        for (const name of [
            'role',
            'aria-expanded',
            'aria-controls',
            'aria-autocomplete',
            'aria-activedescendant',
            'aria-haspopup',
            'aria-invalid',
            'aria-keyshortcuts',
            'enterkeyhint',
        ]) {
            input.removeAttribute(name);
        }
        input.setCustomValidity('');
    }

    /**
     * Run a field's own synchronous write of its value to the host input. A
     * field that writes its host and dispatches the native `input` event (the
     * host form contract) would otherwise have that echo read back as typing.
     * Only the write itself is muted: a commit's store round trip is not, so
     * what the user types while it is out still reaches the draft.
     */
    muteInput(write: () => void): void {
        this.muted++;
        try {
            write();
        } finally {
            this.muted--;
        }
    }

    /** Say something in the field's live region. */
    announce(text: string): void {
        this.announcer.textContent = '';
        // A fresh text node after a frame makes screen readers re-read an
        // identical message, which a plain textContent swap does not.
        requestAnimationFrame(() => {
            if (!this.destroyed) this.announcer.textContent = text;
        });
    }

    // --- Events --------------------------------------------------------------------

    private on<K extends keyof HTMLElementEventMap>(
        el: HTMLElement | Document | Window,
        type: K | string,
        fn: (e: Event) => void,
        options?: AddEventListenerOptions | boolean,
    ): void {
        el.addEventListener(type, fn, options);
        this.listeners.push(() => el.removeEventListener(type, fn, options));
    }

    private wireInput(input: HTMLInputElement | HTMLTextAreaElement): void {
        this.on(input, 'input', () => {
            if (this.destroyed || this.muted > 0) return;
            if (input.value === this.controller.draftText) return;
            void this.controller.input(
                input.value,
                input.selectionStart ?? input.value.length,
            );
            if (!this.controller.isOpen) void this.open('typing');
        });
        this.on(input, 'keydown', (e) => this.onKeydown(e as KeyboardEvent));
        for (const type of ['click', 'keyup', 'select']) {
            this.on(input, type, (e) => {
                if (type === 'keyup' && !this.isCaretKey(e as KeyboardEvent))
                    return;
                if (input !== this.activeInput) return;
                void this.controller.input(
                    input.value,
                    input.selectionStart ?? input.value.length,
                );
            });
        }
        this.on(input, 'pointerdown', () => {
            this.pointerIntent = true;
        });
        this.on(input, 'focus', () => {
            if (this.blurTimer) {
                clearTimeout(this.blurTimer);
                this.blurTimer = null;
            }
            this.pressInSurface = false;
            // Focus alone never opens the list: a keyboard user tabbing
            // through a form should not have a popup land on every field. A
            // press is an explicit request, so it does.
            if (this.pointerIntent && input === this.opts.input) {
                this.pointerIntent = false;
                void this.open('pointer');
            }
        });
        this.on(input, 'blur', (e) =>
            this.onBlur((e as FocusEvent).relatedTarget),
        );
    }

    private isCaretKey(e: KeyboardEvent): boolean {
        return ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key);
    }

    private wireSurface(): void {
        // Pressing on the surface must neither blur the input nor count as
        // leaving the field.
        this.on(this.surface, 'mousedown', (e) => {
            if (e.target !== this.sheetInput) e.preventDefault();
        });
        this.on(this.surface, 'pointerdown', () => {
            this.pressInSurface = true;
        });
        // A press on the surface is over once its click has landed (or the
        // pointer gave up). Cleared a turn later, so a blur that the same
        // press caused still sees it; left set, the flag would make the next,
        // unrelated blur (a click elsewhere, Tab) wait for a press that
        // already ended and then pull focus back instead of committing.
        const pressEnded = () =>
            setTimeout(() => {
                this.pressInSurface = false;
            }, 0);
        this.on(this.surface, 'click', pressEnded);
        this.on(this.surface, 'pointercancel', pressEnded);
        // iOS does not blur an input when the user taps a blank part of the
        // page, so an outside press has to end the edit explicitly.
        this.on(
            document,
            'pointerdown',
            (e) => {
                if (!this.controller.isOpen) return;
                const target = e.target as Node | null;
                if (!target) return;
                if (this.surface.contains(target)) return;
                if (this.opts.anchor.contains(target)) return;
                if (this.opts.input.contains(target)) return;
                this.activeInput.blur();
            },
            true,
        );
        // A press on the result row stores it, except on the folded broken
        // rules: opening them to read is not a choice of the result.
        this.on(this.result, 'click', (e) => {
            const target = e.target as Element | null;
            if (
                target?.closest('.ez-composer__problems') ||
                this.sheetDone.contains(target)
            )
                return;
            void this.commitFromResult();
        });
        this.on(this.sheetDone, 'click', () => void this.commitFromResult());
        this.on(this.sheetDone, 'blur', (event) => {
            if (this.controller.isOpen)
                this.onBlur((event as FocusEvent).relatedTarget);
        });
        this.on(this.sheetCancel, 'click', () => this.cancelSheet());
    }

    private onKeydown(e: KeyboardEvent): void {
        if (this.destroyed) return;
        if (e.isComposing || e.keyCode === 229) return;
        const open = this.controller.isOpen;
        if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            if (open) this.jumpCategory(e.key === 'ArrowDown' ? 1 : -1);
            else void this.open('keyboard');
            return;
        }
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                if (!open) void this.open('keyboard');
                else this.controller.move(1);
                return;
            case 'ArrowUp':
                if (open) {
                    e.preventDefault();
                    this.controller.move(-1);
                }
                return;
            case 'PageDown':
            case 'PageUp':
                if (open) {
                    e.preventDefault();
                    this.controller.move(e.key === 'PageDown' ? PAGE : -PAGE);
                }
                return;
            case 'Enter': {
                // Ctrl/Cmd+Enter is the family's "set marking" shortcut. An
                // editor the caret opened without a list (the marked fields do
                // that when the caret moves into a mark) answers it by showing
                // the list, so the shortcut the hint names always does
                // something. It opens the way the field's own shortcut and
                // hint button do, so a phone gets the same sheet either way.
                if (
                    (e.ctrlKey || e.metaKey) &&
                    !e.shiftKey &&
                    !e.altKey &&
                    !open
                ) {
                    e.preventDefault();
                    void this.open('api');
                    return;
                }
                if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
                const dirty = this.controller.isDirty();
                if (open || dirty || this.opts.singleLine) e.preventDefault();
                if (open || dirty) void this.onEnter();
                return;
            }
            case 'Tab':
                if (e.shiftKey) return;
                if (this.controller.tab()) e.preventDefault();
                return;
            case 'Escape': {
                if (this.controller.escape()) {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
                if (this.opts.onEscapeIdle?.()) {
                    e.preventDefault();
                    e.stopPropagation();
                }
                return;
            }
        }
    }

    private async onEnter(): Promise<void> {
        // Whether this press came from the sheet, as it was when pressed.
        const wasSheet = this.sheet;
        const outcome = await this.controller.enter();
        if (this.destroyed) return;
        if (outcome === 'stored' || outcome === 'unchanged') {
            this.close();
            if (!wasSheet) this.opts.input.focus();
            this.opts.onEnterCommit?.(outcome, wasSheet);
        } else if (outcome === 'invalid') {
            this.showRefusal();
        }
    }

    private async commitFromResult(): Promise<void> {
        const wasSheet = this.sheet;
        const outcome = await this.controller.commit();
        if (this.destroyed) return;
        if (outcome !== 'invalid') {
            this.close();
            if (!wasSheet) this.opts.input.focus();
            this.opts.onEnterCommit?.(outcome, wasSheet);
        } else {
            this.showRefusal();
        }
    }

    /**
     * A press of Done (or Enter) that stored nothing gets a visible answer, not
     * only the spoken one: Done gives a short shake and the reason line in the
     * result row is marked (see paintResult).
     */
    private showRefusal(): void {
        const done = this.sheetDone;
        done.classList.remove('ez-composer__sheet-done--refused');
        // Restart the animation on a second press.
        void done.offsetWidth;
        done.classList.add('ez-composer__sheet-done--refused');
        done.addEventListener(
            'animationend',
            () => done.classList.remove('ez-composer__sheet-done--refused'),
            { once: true },
        );
    }

    /**
     * The sheet's Cancel: the whole Escape ladder in one tap. Close, revert the
     * draft (the second Escape), then hand off to the field the way an Escape
     * with nothing left to do does, so an editor the field opened for this edit
     * is taken down with whatever it inserted. Closing first means the blur
     * that follows commits an already clean draft.
     */
    private cancelSheet(): void {
        if (this.destroyed) return;
        this.close();
        this.controller.escape();
        if (this.opts.onEscapeIdle?.()) {
            // The field puts focus back on its own input, which on a phone
            // brings the keyboard up again for an edit the user just
            // canceled.
            this.parkFocus();
        }
    }

    /**
     * Focus left one of the composer's inputs. Leaving the field commits
     * straight away: the draft is read as it stands, so a keystroke just before
     * the blur is in the value a host sees on the same click (a Save button, a
     * route change that unmounts the field). Only a press on the surface waits,
     * for its own click to land.
     */
    private onBlur(next: EventTarget | null): void {
        if (this.destroyed) return;
        if (
            next === this.opts.input ||
            next === this.sheetInput ||
            (next instanceof Node && this.surface.contains(next))
        ) {
            return;
        }
        if (
            this.pressInSurface ||
            (next instanceof Node && this.opts.isFieldChrome?.(next))
        ) {
            this.scheduleBlur();
            return;
        }
        if (this.blurTimer) {
            clearTimeout(this.blurTimer);
            this.blurTimer = null;
        }
        this.commitOnBlur();
    }

    private commitOnBlur(): void {
        void this.controller.blur().then((outcome) => {
            if (!this.destroyed) this.opts.onBlurCommit?.(outcome);
        });
    }

    private scheduleBlur(): void {
        if (this.blurTimer) clearTimeout(this.blurTimer);
        this.blurTimer = setTimeout(() => {
            this.blurTimer = null;
            if (this.destroyed) return;
            // A press that closed the sheet (Done, Cancel, the result row)
            // ended the edit, so focus is not pulled back to the field: on
            // a phone that would bring the keyboard up again.
            const pressed = this.pressInSurface;
            this.pressInSurface = false;
            if (pressed && this.controller.isOpen) {
                // The press landed on the list; its click keeps working with
                // the input it came from.
                if (document.activeElement !== this.activeInput) {
                    this.activeInput.focus();
                }
                return;
            }
            const active = document.activeElement;
            if (
                active === this.opts.input ||
                active === this.sheetInput ||
                (active && this.surface.contains(active))
            ) {
                return;
            }
            this.commitOnBlur();
        }, BLUR_COMMIT_DELAY_MS);
    }

    // --- Surface choice and placement --------------------------------------------

    private wantsSheet(): boolean {
        if (typeof window.matchMedia !== 'function') return false;
        return (
            window.matchMedia('(pointer: coarse)').matches &&
            window.innerWidth < SHEET_BREAKPOINT
        );
    }

    /**
     * Place the surface against its field.
     *
     * @param mayScroll - Whether this placement may scroll the page to make
     *   room below the field. A change to what the box shows may, while the
     *   user is in the field; a placement that answers a scroll or a resize
     *   must not, or it would scroll again in answer to its own scroll and undo
     *   every scroll the user makes while the list is open.
     */
    private place(mayScroll = true): void {
        if (!this.controller.isOpen) return;
        if (this.sheet && this.compact) {
            // The whole band, whatever the content: nothing the user reads
            // or scrolls changes its size (see positionCompactSheet).
            positionCompactSheet(this.surface, this.scroller);
            this.fitSheetTitle();
        } else if (this.sheet) {
            // Keep this open's height once it has one (see positionSheet).
            positionSheet(this.surface, this.scroller, true);
            this.fitSheetTitle();
        } else {
            const width = this.popoverWidth();
            const placement = {
                surface: this.surface,
                list: this.scroller,
                input: this.opts.input,
                anchor: this.opts.anchor,
                bounds: this.opts.bounds ?? this.opts.anchor,
                field: this.opts.field,
            };
            this.surface.style.width = `${width}px`;
            // The page may be scrolled to fit the box below its field when
            // below is the first side it can fit on (see positionPopover).
            const placed = positionPopover(
                placement,
                this.sideLocked,
                mayScroll,
            );
            if (!placed.fits && !this.foldForRoom) {
                // No room for the result row and an option: fold the broken
                // rules under one line, as the phone sheet does, and place
                // the smaller box again.
                this.foldForRoom = true;
                this.paintResult(this.controller.snapshot());
                this.surface.style.width = `${width}px`;
                positionPopover(placement, this.sideLocked, false);
            }
            // positionPopover clears an inline width; keep the one set above.
            this.surface.style.width = `${width}px`;
        }
        this.placed = true;
        const s = this.controller.snapshot();
        if (
            s.reading &&
            !s.stale &&
            (s.rows.length > 0 || s.mode === 'ranked')
        ) {
            this.sideLocked = true;
        }
        this.opts.onPlacement?.(
            true,
            this.sheet ? 'sheet' : popoverSide(this.surface),
        );
    }

    /**
     * Lay the surface out for the keyboard-up sheet or back. Compact, only the
     * bar and the input stay fixed: the result block leads the scrolling area,
     * and the needs strip follows the list with the rows not yet available.
     * Every layout keeps the whole body scrollable; fixed chrome cannot squeeze
     * the options into a sliver when many categories are required.
     */
    private arrange(compact: boolean): void {
        if (compact === this.compact) return;
        this.compact = compact;
        if (compact) {
            this.surface.dataset.compact = 'true';
            this.scroller.prepend(this.result);
            this.scroller.appendChild(this.needs);
        } else {
            delete this.surface.dataset.compact;
            this.scroller.prepend(this.result, this.needs);
            this.scroller.style.maxHeight = '';
        }
    }

    /**
     * Fit the sheet's title between Cancel and Done by shortening its middle
     * (see middleEllipsis). The sheet's input is named by the whole title.
     */
    private fitSheetTitle(): void {
        const label = this.sheetLabel;
        const fits = (candidate: string): boolean => {
            label.textContent = candidate;
            return label.scrollWidth <= label.clientWidth;
        };
        label.textContent = middleEllipsis(this.sheetTitle, fits);
        if (label.textContent === this.sheetTitle) {
            this.sheetInput.removeAttribute('aria-label');
            this.sheetInput.setAttribute('aria-labelledby', label.id);
        } else {
            this.sheetInput.removeAttribute('aria-labelledby');
            this.sheetInput.setAttribute('aria-label', this.sheetTitle);
        }
    }

    /**
     * The popover matches the field's width, within a readable band: never
     * narrower than a row with its category tag needs, never wider than a
     * comfortable line, and never past the viewport.
     */
    private popoverWidth(): number {
        const anchor = this.opts.anchor.getBoundingClientRect().width;
        const rem =
            Number.parseFloat(
                getComputedStyle(document.documentElement).fontSize,
            ) || 16;
        const width = Math.min(Math.max(anchor, 22.5 * rem), 30 * rem);
        return Math.round(Math.min(width, window.innerWidth - rem));
    }

    private startTracking(): void {
        if (this.stopViewport) return;
        const reposition = (e: Event) => {
            if (
                (e.type === 'scroll' || e.type === 'scrollend') &&
                isInternalScroll(this.surface, e)
            )
                return;
            this.place(false);
        };
        // Every viewport change and page scroll places the box again, and so
        // does the end of a scroll: a box opened while the page was still
        // moving is placed once more where the field came to rest.
        this.stopViewport = listenForViewportChanges(reposition);
    }

    private stopTracking(): void {
        this.stopViewport?.();
        this.stopViewport = null;
    }

    // --- Painting --------------------------------------------------------------

    private applyComboboxAttrs(
        input: HTMLInputElement | HTMLTextAreaElement,
    ): void {
        input.setAttribute('role', 'combobox');
        input.setAttribute('aria-autocomplete', 'list');
        input.setAttribute('aria-haspopup', 'listbox');
        input.setAttribute('aria-controls', this.list.id);
        input.setAttribute('aria-expanded', 'false');
        // The field owns the category shortcuts; the arrows in the list are
        // only their pointer equivalents.
        input.setAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown');
    }

    private paint(s: ComposerSnapshot): void {
        if (this.destroyed) return;
        const input = this.opts.input;
        // Mirror the draft into whichever input is not being typed in.
        for (const el of [input, this.sheetInput]) {
            if (el.value !== s.text && document.activeElement !== el) {
                el.value = s.text;
            }
        }
        const active = this.activeInput;
        if (active.value !== s.text) {
            active.value = s.text;
            active.setSelectionRange(s.caret, s.caret);
        }
        this.opts.onDraft?.(s.text);

        const label = this.opts.label();
        this.sheetTitle = label.text;
        this.sheetLabel.textContent = label.text;
        if (label.id) this.list.setAttribute('aria-labelledby', label.id);
        else this.list.setAttribute('aria-label', label.text);
        // An input with no name of its own (the inline editor) takes the
        // field's: a focused combobox must never be announced unnamed.
        const named =
            (input.labels?.length ?? 0) > 0 ||
            input.hasAttribute('aria-label') ||
            input.hasAttribute('aria-labelledby');
        if (!named) {
            if (label.id) input.setAttribute('aria-labelledby', label.id);
            else input.setAttribute('aria-label', label.text);
        }

        this.paintNote(s);
        this.applyComboboxAttrs(this.sheetInput);
        // An unsaved draft that could not be read is also invalid to the
        // host form: submitting would post text the field never stored (the
        // MarkingField host is the input holding it) or skip the field's
        // real value unnoticed. Constraint validation stops the submit and
        // says why.
        const validity =
            s.invalid && s.problem
                ? this.controller.problemText(s.problem)
                : (this.opts.committedValidity?.() ?? '');
        if (input.validationMessage !== validity) {
            input.setCustomValidity(validity);
        }
        for (const el of [input, this.sheetInput]) {
            const owns = el === active && s.open;
            el.setAttribute('aria-expanded', owns ? 'true' : 'false');
            el.setAttribute('aria-invalid', validity ? 'true' : 'false');
            el.setAttribute(
                'enterkeyhint',
                s.activeIndex >= 0 ? 'enter' : 'done',
            );
        }

        if (!s.open) {
            this.lastListSignature = '';
            this.surface.hidden = true;
            // A closed surface keeps nothing: text left in it (a reading's
            // errors, say) would still be in the document, stale, for
            // anything that reads it.
            this.resultContent.replaceChildren();
            if (this.sheetDone.parentElement === this.result)
                this.sheetDone.remove();
            this.needs.replaceChildren();
            this.list.replaceChildren();
            this.gated.replaceChildren();
            this.status.textContent = '';
            input.removeAttribute('aria-activedescendant');
            this.sheetInput.removeAttribute('aria-activedescendant');
            this.stopTracking();
            this.releasePage?.();
            this.releasePage = null;
            if (this.placed) {
                this.placed = false;
                this.opts.onPlacement?.(false, 'below');
            }
            return;
        }
        this.surface.hidden = false;
        this.surface.dataset.surface = this.sheet ? 'sheet' : 'popover';
        this.arrange(this.sheet && keyboardUp());
        this.sheetField.hidden = !this.sheet;
        // Done cannot store a draft that does not read completely. It stays
        // pressable, so a press still shows why.
        const unstorable =
            s.invalid ||
            (!!s.reading &&
                !s.stale &&
                !s.reading.complete &&
                s.text.trim().length > 0);
        if (unstorable) this.sheetDone.setAttribute('aria-disabled', 'true');
        else this.sheetDone.removeAttribute('aria-disabled');
        this.paintResult(s);
        this.paintNeeds(s);
        this.renderFooter(s);
        this.paintList(s);
        this.paintGated(s);
        this.paintStatus(s);

        const activeRow = s.activeIndex >= 0 ? s.rows[s.activeIndex] : null;
        const activeId = activeRow ? this.optionId(activeRow) : null;
        for (const el of [input, this.sheetInput]) {
            if (el === active && activeId) {
                el.setAttribute('aria-activedescendant', activeId);
            } else {
                el.removeAttribute('aria-activedescendant');
            }
        }
        // Room is made for the list the user is working in. Once focus has
        // left the field (a press on another control commits it), a repaint
        // must not scroll that control out from under the press.
        this.place(this.holdsFocus());
        this.startTracking();
        // Moving up onto the first row, or up out of the list, brings back
        // what sits above the list, the result included, so the keyboard
        // reaches all of it. Any other change of row keeps the scroll.
        const previous = this.lastActiveIndex;
        this.lastActiveIndex = s.activeIndex;
        if (
            (s.activeIndex === 0 && previous > 0) ||
            (s.activeIndex < 0 && previous === 0)
        ) {
            this.scroller.scrollTop = 0;
        }
        if (activeId) {
            const row = document.getElementById(activeId);
            if (row && this.list.contains(row)) revealRow(this.scroller, row);
        }
    }

    /**
     * The active row's index at the last paint, to tell which way the keyboard
     * moved.
     */
    private lastActiveIndex = -1;

    private paintNote(s: ComposerSnapshot): void {
        const input = this.opts.input;
        const ids = (input.getAttribute('aria-describedby') ?? '')
            .split(/\s+/)
            .filter((id) => id && id !== this.note.id);
        if (s.invalid && s.problem) {
            this.note.hidden = false;
            this.note.textContent = this.controller.problemText(s.problem);
            ids.push(this.note.id);
        } else {
            this.note.hidden = true;
            this.note.textContent = '';
        }
        if (ids.length > 0)
            input.setAttribute('aria-describedby', ids.join(' '));
        else input.removeAttribute('aria-describedby');
    }

    private paintResult(s: ComposerSnapshot): void {
        // Keep the action outside the repainted reading, so a refused commit
        // never removes the keyboard user's focused button.
        const parent = this.sheet ? this.sheetLabel.parentElement : this.result;
        if (parent && this.sheetDone.parentElement !== parent)
            parent.appendChild(this.sheetDone);
        this.resultContent.replaceChildren();
        this.paintResultRow(s);
    }

    private paintResultRow(s: ComposerSnapshot): void {
        const r = this.result;
        // Between a keystroke and its reading the row still describes the
        // previous text. It stays (blanking it on every key would flicker)
        // but reads as not current.
        if (s.stale && s.reading) r.dataset.stale = 'true';
        else delete r.dataset.stale;
        // A commit was refused: the reason line is marked, so a press of
        // Done that stored nothing points at why.
        if (s.invalid) r.dataset.refused = 'true';
        else delete r.dataset.refused;
        r.setAttribute('aria-busy', s.stale ? 'true' : 'false');
        const reading = s.reading;
        const label = document.createElement('span');
        label.className = 'ez-composer__result-label';
        const value = document.createElement('span');
        value.className = 'ez-composer__result-value';
        this.resultContent.append(label, value);
        if (!reading) {
            r.dataset.state = 'pending';
            label.textContent = t('composer.savesAs');
            value.textContent = '…';
            return;
        }
        const empty = !s.text.trim() && reading.assertions.length === 0;
        if (empty) {
            r.dataset.state = 'empty';
            label.textContent = t('composer.savesAs');
            value.textContent = t('composer.nothing');
            return;
        }
        if (reading.complete) {
            r.dataset.state = s.invalid ? 'invalid' : 'ok';
            label.textContent = t('composer.savesAs');
            value.textContent = reading.rendered;
            const changes = document.createElement('span');
            changes.className = 'ez-composer__changes';
            // A handful of marks reads at a glance; a long list pushes the
            // list off a short screen, so the rest collapse into a count.
            const shown = s.changes.slice(0, MAX_CHANGE_MARKS);
            for (const change of shown) {
                const mark = document.createElement('span');
                mark.className = `ez-composer__change ez-composer__change--${change.kind}`;
                mark.textContent =
                    change.kind === 'added'
                        ? t('composer.changeAdded').replace(
                              '{label}',
                              change.label,
                          )
                        : change.kind === 'removed'
                          ? t('composer.changeRemoved').replace(
                                '{label}',
                                change.label,
                            )
                          : t('composer.reordered');
                changes.appendChild(mark);
            }
            if (s.changes.length > shown.length) {
                const rest = document.createElement('span');
                rest.className =
                    'ez-composer__change ez-composer__change--more';
                rest.textContent = t('composer.moreChanges').replace(
                    '{count}',
                    String(s.changes.length - shown.length),
                );
                changes.appendChild(rest);
            }
            if (changes.childElementCount > 0)
                this.resultContent.appendChild(changes);
            const readAs = reading.corrections.filter(
                (c) => c.reason === 'alias' || c.reason === 'case',
            );
            if (readAs.length > 0 && readAs.some((c) => c.reason === 'alias')) {
                const line = document.createElement('span');
                line.className = 'ez-composer__result-detail';
                line.textContent = readAs
                    .filter((c) => c.reason === 'alias')
                    .map((c) =>
                        t('composer.readAs')
                            .replace('{from}', c.original.trim())
                            .replace('{to}', c.replacement.trim()),
                    )
                    .join(t('composer.readAsSeparator'));
                this.resultContent.appendChild(line);
            }
            // The same report the field shows under itself when the list is
            // closed: every rule the result breaks, then the warnings. The
            // fix rows below are the ways to fix it.
            const report = ruleErrorsFrom(reading.errors, [], reading.warnings);
            // The broken rules fold under one line so the ways to fix stay in
            // view: on the phone sheet when there are fixes, whenever more
            // than three are listed, and when the popover had no room for
            // them (see place()).
            const fold =
                report.messages.length > 0 &&
                ((this.sheet && s.rows.some((row) => row.kind === 'fix')) ||
                    report.messages.length > FOLD_OVER ||
                    this.foldForRoom);
            const rules = fold
                ? this.problemsFold(report.messages.length)
                : this.resultContent;
            if (rules !== this.resultContent)
                this.resultContent.appendChild(rules);
            for (const message of report.messages)
                rules.appendChild(this.resultLine(message, 'rule'));
            for (const message of report.warnings)
                this.resultContent.appendChild(
                    this.resultLine(message, 'warning'),
                );
            return;
        }
        if (!reading.unmatched.some((f) => f.text.trim())) {
            // Every character was read, yet there is no single complete
            // reading: a rule problem, not a spelling one. Say which rule.
            r.dataset.state = 'incomplete';
            label.textContent = t('composer.notSaved');
            value.textContent = s.text;
            this.appendProblems([], ruleMessageOf(reading));
            return;
        }
        // Only the token being typed is unread: the draft is in progress,
        // not wrong, so it keeps the "saves as" label and no error line.
        // After a commit was refused, nothing is still being typed: every
        // unread fragment is why.
        const typing =
            !s.invalid &&
            reading.unmatched.every((f) => isTypingFragment(f, s.token));
        r.dataset.state = typing ? 'typing' : 'incomplete';
        label.textContent = t(
            typing ? 'composer.savesAs' : 'composer.notSaved',
        );
        this.paintFragments(value, s);
    }

    /**
     * The draft as typed, with every fragment the parser could not read marked
     * in place. The fragment under the caret is marked as still being typed
     * rather than as a mistake.
     */
    private paintFragments(into: HTMLElement, s: ComposerSnapshot): void {
        const reading = s.reading!;
        const text = s.text;
        let cursor = 0;
        const spans = [...reading.unmatched].sort((a, b) => a.start - b.start);
        const problems: string[] = [];
        if (this.controller.shape === 'additive') {
            // Additive text sits on top of what the field already holds, so
            // the row shows that marking (with whatever the text did read
            // folded in) followed by the fragments still unread. The typed
            // text alone would claim the field saves only the fragment.
            if (reading.rendered) into.append(reading.rendered);
            for (const span of spans) {
                const typing = !s.invalid && isTypingFragment(span, s.token);
                const mark = document.createElement('mark');
                mark.className = typing
                    ? 'ez-composer__fragment ez-composer__fragment--typing'
                    : 'ez-composer__fragment';
                mark.textContent = span.text.trim();
                if (into.childNodes.length > 0) into.append(' ');
                into.appendChild(mark);
                if (!typing) problems.push(span.text.trim());
            }
            this.appendProblems(problems);
            return;
        }
        for (const span of spans) {
            if (span.start < cursor || span.end > text.length) continue;
            if (span.start > cursor) {
                into.appendChild(
                    document.createTextNode(text.slice(cursor, span.start)),
                );
            }
            const mark = document.createElement('mark');
            const typing = !s.invalid && isTypingFragment(span, s.token);
            mark.className = typing
                ? 'ez-composer__fragment ez-composer__fragment--typing'
                : 'ez-composer__fragment';
            mark.textContent = text.slice(span.start, span.end);
            into.appendChild(mark);
            if (!typing) problems.push(span.text.trim());
            cursor = span.end;
        }
        if (cursor < text.length)
            into.appendChild(document.createTextNode(text.slice(cursor)));
        this.appendProblems(problems);
    }

    /** A collapsed disclosure that holds the broken rules on the sheet. */
    private problemsFold(count: number): HTMLElement {
        const fold = document.createElement('details');
        fold.className = 'ez-composer__problems';
        // A read repaints the result; the fold stays as the user left it.
        fold.open = this.problemsOpen;
        // Opening it grows the box: place it again for the new height.
        fold.addEventListener('toggle', () => {
            this.problemsOpen = fold.open;
            this.place();
        });
        const summary = document.createElement('summary');
        summary.className = 'ez-composer__problems-summary';
        summary.textContent = t(
            count === 1 ? 'composer.brokenRule' : 'composer.brokenRules',
        ).replace('{count}', String(count));
        fold.appendChild(summary);
        return fold;
    }

    /** One line of the result row's report: a broken rule or a warning. */
    private resultLine(text: string, kind: 'rule' | 'warning'): HTMLElement {
        const line = document.createElement('span');
        line.className = `ez-composer__result-${kind}`;
        line.textContent = text;
        return line;
    }

    /**
     * Say, under the result, which fragments were not recognized, or the rule a
     * fully read draft breaks.
     */
    private appendProblems(problems: readonly string[], rule?: string): void {
        const text = rule
            ? rule
            : problems
                  .map((p) => t('composer.notRecognized').replace('{text}', p))
                  .join(' ');
        if (!text) return;
        const line = document.createElement('span');
        line.className = 'ez-composer__result-rule';
        line.textContent = text;
        this.resultContent.appendChild(line);
    }

    private paintNeeds(s: ComposerSnapshot): void {
        const box = this.needs;
        box.replaceChildren();
        if (s.needs.length === 0) {
            box.hidden = true;
            return;
        }
        box.hidden = false;
        const caption = document.createElement('span');
        caption.className = 'ez-composer__needs-caption';
        caption.textContent = t('composer.needs');
        box.appendChild(caption);
        for (const need of s.needs) {
            const chip = this.chipButton(
                need.label,
                `ez-composer__need ez-composer__need--${need.kind}${
                    s.scope === need.categoryId ? ' ez-composer__need--on' : ''
                }`,
                () =>
                    this.controller.scopeTo(
                        s.scope === need.categoryId ? null : need.categoryId,
                    ),
            );
            chip.setAttribute(
                'aria-pressed',
                s.scope === need.categoryId ? 'true' : 'false',
            );
            box.appendChild(chip);
        }
        if (s.scope && !s.needs.some((n) => n.categoryId === s.scope)) {
            box.appendChild(
                this.chipButton(
                    t('composer.showAll'),
                    'ez-composer__need',
                    () => this.controller.scopeTo(null),
                ),
            );
        }
    }

    /**
     * Browse adjacent groups without filtering, completing or storing the
     * draft.
     */
    private jumpCategory(delta: -1 | 1, from?: string): void {
        const before = this.controller.snapshot();
        const active = before.rows[before.activeIndex];
        const headings = () => [
            ...this.list.querySelectorAll<HTMLElement>(
                '.ez-composer__group-label[data-category-id]',
            ),
        ];
        const scroll = this.scroller;
        const viewport = scroll.getBoundingClientRect();
        const current = headings();
        let category =
            from ??
            (active?.kind === 'concept'
                ? active.suggestion.categoryId
                : before.scope);
        const activeElement = active
            ? document.getElementById(this.optionId(active))
            : null;
        const activeBounds = activeElement?.getBoundingClientRect();
        if (
            !from &&
            (!category ||
                (activeBounds &&
                    viewport.bottom > viewport.top &&
                    (activeBounds.bottom < viewport.top ||
                        activeBounds.top >= viewport.bottom)))
        ) {
            category = current[0]?.dataset.categoryId ?? null;
            for (const heading of scroll.scrollTop > 0 ? current : []) {
                if (
                    heading.parentElement!.getBoundingClientRect().top <=
                    viewport.top + 1
                )
                    category = heading.dataset.categoryId ?? null;
                else break;
            }
        }
        this.controller.scopeTo(null);
        const all = headings();
        if (!all.length) return;
        const index = all.findIndex((h) => h.dataset.categoryId === category);
        const target =
            all[
                Math.max(
                    0,
                    Math.min(
                        all.length - 1,
                        index < 0
                            ? delta > 0
                                ? 0
                                : all.length - 1
                            : index + delta,
                    ),
                )
            ];
        const snapshot = this.controller.snapshot();
        this.controller.setActive(
            snapshot.rows.findIndex(
                (row) =>
                    row.kind === 'concept' &&
                    row.suggestion.categoryId === target.dataset.categoryId,
            ),
        );
        scroll.scrollTop +=
            target.parentElement!.getBoundingClientRect().top -
            scroll.getBoundingClientRect().top;
    }

    /**
     * Small mouse/touch equivalents of the field's category shortcuts. The
     * field announces the shortcuts itself, and a listbox may hold only
     * options, so the arrows stay out of the accessibility tree.
     */
    private categoryArrow(
        categoryId: string,
        delta: -1 | 1,
        disabled: boolean,
    ): HTMLButtonElement {
        const label = t(
            delta < 0 ? 'composer.previousCategory' : 'composer.nextCategory',
        );
        const button = this.chipButton('', 'ez-composer__category-arrow', () =>
            this.jumpCategory(delta, categoryId),
        );
        button.setAttribute('aria-label', label);
        button.title = `${label} (${isMacPlatform() ? 'Option' : 'Alt'}+${delta < 0 ? '↑' : '↓'})`;
        button.dataset.direction = delta < 0 ? 'up' : 'down';
        button.disabled = disabled;
        return button;
    }

    private chipButton(
        text: string,
        className: string,
        act: () => void,
    ): HTMLButtonElement {
        const b = document.createElement('button');
        b.type = 'button';
        b.tabIndex = -1;
        b.className = className;
        b.textContent = text;
        b.addEventListener('click', (e) => {
            e.preventDefault();
            act();
        });
        return b;
    }

    private optionId(row: ComposerRow): string {
        return `${this.id}-${row.id}`;
    }

    /**
     * What the list shows, as one string. A reading that lands with the same
     * rows must not rebuild them: a press that started on a row would lose its
     * click to a replaced element, and hover would flicker. Only the active row
     * moves then.
     */
    private listSignature(s: ComposerSnapshot): string {
        const parts: string[] = [s.mode, s.scope ?? ''];
        if (s.scope) parts.push(JSON.stringify(s.categories.map((c) => c.id)));
        for (const group of s.groups) {
            parts.push(`g:${group.id}:${group.label}`);
            for (const row of group.rows) {
                if (row.kind === 'concept') {
                    parts.push(
                        [
                            row.id,
                            row.checked,
                            row.inferred,
                            row.action,
                            row.replaces ?? '',
                            row.gated,
                            row.suggestion.label,
                            row.ranked?.matchedSpelling ?? '',
                        ].join(':'),
                    );
                } else if (row.kind === 'more') {
                    parts.push(`${row.id}:${row.count}`);
                } else if (row.kind === 'correction') {
                    parts.push(
                        `${row.id}:${row.fragment.text}:${row.suggestion.label}`,
                    );
                } else {
                    parts.push(`${row.id}:${row.label}`);
                }
            }
        }
        return parts.join('|');
    }

    private lastListSignature = '';

    private paintList(s: ComposerSnapshot): void {
        const query = s.token.query;
        const queryChanged = query !== this.lastQuery;
        this.lastQuery = query;
        const activeRow = s.activeIndex >= 0 ? s.rows[s.activeIndex] : null;
        const signature = this.listSignature(s);
        if (signature === this.lastListSignature) {
            this.moveActive(activeRow);
            return;
        }
        this.lastListSignature = signature;
        const saved = this.list.scrollTop;
        const savedOuter = this.scroller.scrollTop;
        this.list.replaceChildren();
        this.list.dataset.mode = s.mode;
        const categoryCount = s.scope
            ? s.categories.length
            : s.groups.filter((g) => g.rows[0]?.kind === 'concept').length;
        let categoryIndex = 0;
        for (const group of s.groups) {
            if (group.rows.length === 0) continue;
            if (!group.label) {
                for (const row of group.rows) {
                    this.list.appendChild(
                        this.rowElement(row, row === activeRow, s),
                    );
                }
                continue;
            }
            const g = document.createElement('div');
            g.setAttribute('role', 'group');
            g.className = 'ez-composer__group';
            const heading = document.createElement('div');
            heading.className = 'ez-composer__group-label';
            heading.setAttribute('role', 'presentation');
            const title = this.span('ez-composer__group-title', group.label);
            title.id = `${this.id}-${group.id}-label`;
            title.setAttribute('role', 'presentation');
            heading.append(title);
            const first = group.rows[0];
            if (s.mode === 'browse' && first.kind === 'concept') {
                const categoryId = first.suggestion.categoryId;
                heading.dataset.categoryId = categoryId;
                const index = s.scope
                    ? s.categories.findIndex((c) => c.id === categoryId)
                    : categoryIndex++;
                const nav = document.createElement('span');
                nav.className = 'ez-composer__category-arrows';
                nav.setAttribute('aria-hidden', 'true');
                nav.append(
                    this.categoryArrow(categoryId, -1, index === 0),
                    this.categoryArrow(
                        categoryId,
                        1,
                        index === categoryCount - 1,
                    ),
                );
                heading.append(nav);
            }
            g.setAttribute('aria-labelledby', title.id);
            g.appendChild(heading);
            for (const row of group.rows) {
                g.appendChild(this.rowElement(row, row === activeRow, s));
            }
            this.list.appendChild(g);
        }
        this.list.scrollTop = queryChanged ? 0 : saved;
        this.scroller.scrollTop = queryChanged ? 0 : savedOuter;
    }

    /** Move the active marker to `row` on the rows already rendered. */
    private moveActive(row: ComposerRow | null): void {
        const nextId = row ? this.optionId(row) : null;
        for (const el of this.list.querySelectorAll<HTMLElement>(
            '.ez-composer__row--active',
        )) {
            if (el.id === nextId) continue;
            el.classList.remove('ez-composer__row--active');
            el.querySelector('.ez-composer__definition')?.remove();
            el.removeAttribute('aria-describedby');
        }
        if (!row || !nextId) return;
        const el = document.getElementById(nextId);
        if (!el || el.classList.contains('ez-composer__row--active')) return;
        el.classList.add('ez-composer__row--active');
        if (row.kind === 'concept') this.applyDefinition(el, row);
    }

    /** The active row's one-line definition, referenced for screen readers. */
    private applyDefinition(
        el: HTMLElement,
        row: Extract<ComposerRow, { kind: 'concept' }>,
    ): void {
        if (!this.opts.describeConcept) return;
        const sug = row.suggestion;
        const detail = this.opts.describeConcept(sug.conceptId, sug.categoryId);
        if (!detail) {
            this.retryDefinition(row.id);
            return;
        }
        el.querySelector('.ez-composer__definition')?.remove();
        const def = this.span(
            'ez-composer__definition',
            detail.replace(/\s*\n+\s*/g, ' ').trim(),
        );
        def.id = `${el.id}-def`;
        el.appendChild(def);
        el.setAttribute('aria-describedby', def.id);
    }

    private rowElement(
        row: ComposerRow,
        active: boolean,
        s: ComposerSnapshot,
    ): HTMLElement {
        const el = document.createElement('div');
        el.id = this.optionId(row);
        el.setAttribute('role', 'option');
        el.className = 'ez-composer__row';
        el.dataset.kind = row.kind;
        if (active) el.classList.add('ez-composer__row--active');
        el.addEventListener('click', (e) => {
            e.preventDefault();
            void this.controller.activate(row);
        });
        el.addEventListener('mouseenter', () =>
            el.classList.add('ez-composer__row--hover'),
        );
        el.addEventListener('mouseleave', () =>
            el.classList.remove('ez-composer__row--hover'),
        );
        switch (row.kind) {
            case 'concept':
                this.fillConceptRow(el, row, active, s);
                break;
            case 'correction': {
                el.setAttribute('aria-selected', 'false');
                const main = this.span(
                    'ez-composer__primary',
                    t('composer.useCorrection')
                        .replace('{label}', row.suggestion.label)
                        .replace('{text}', row.fragment.text.trim()),
                );
                el.append(this.checkSlot(false), main);
                break;
            }
            case 'fix':
                el.setAttribute('aria-selected', 'false');
                el.append(
                    this.checkSlot(false),
                    this.span('ez-composer__primary', row.label),
                );
                break;
            case 'more':
                el.setAttribute('aria-selected', 'false');
                el.append(
                    this.checkSlot(false),
                    this.span(
                        'ez-composer__more',
                        t('composer.more').replace(
                            '{count}',
                            String(row.count),
                        ),
                    ),
                );
                break;
        }
        return el;
    }

    private fillConceptRow(
        el: HTMLElement,
        row: Extract<ComposerRow, { kind: 'concept' }>,
        active: boolean,
        s: ComposerSnapshot,
    ): void {
        const sug = row.suggestion;
        el.dataset.conceptId = sug.conceptId;
        el.dataset.categoryId = sug.categoryId;
        el.setAttribute(
            'aria-selected',
            row.checked && !row.inferred ? 'true' : 'false',
        );
        if (row.checked) el.classList.add('ez-composer__row--checked');
        if (row.inferred) el.classList.add('ez-composer__row--inferred');
        if (row.gated) {
            el.setAttribute('aria-disabled', 'true');
            el.classList.add('ez-composer__row--gated');
        }
        const line = document.createElement('span');
        line.className = 'ez-composer__line';
        line.appendChild(this.span('ez-composer__short', sug.label));
        const long =
            sug.name && sug.name.toLowerCase() !== sug.label.toLowerCase()
                ? sug.name
                : '';
        if (long) line.appendChild(this.span('ez-composer__long', long));
        if (row.ranked?.matchedSpelling) {
            line.appendChild(
                this.span(
                    'ez-composer__matched',
                    t('composer.matched').replace(
                        '{text}',
                        row.ranked.matchedSpelling,
                    ),
                ),
            );
        }
        const action = this.actionText(row);
        if (action) line.appendChild(this.span('ez-composer__action', action));
        if (s.mode === 'ranked' && sug.group) {
            line.appendChild(this.span('ez-composer__category', sug.group));
        }
        el.append(this.checkSlot(row.checked, row.inferred), line);
        if (row.gated && row.gatedReason) {
            el.appendChild(this.span('ez-composer__reason', row.gatedReason));
        }
        if (active) this.applyDefinition(el, row);
    }

    private definitionRetry: {
        rowId: string;
        left: number;
        timer: ReturnType<typeof setTimeout> | null;
    } = { rowId: '', left: 0, timer: null };

    /**
     * A remote engine answers a concept's detail asynchronously; the first
     * paint of an active row may have nothing to show yet. Repaint a few times
     * while the same row stays active, then give up quietly.
     */
    private retryDefinition(rowId: string): void {
        const retry = this.definitionRetry;
        if (retry.rowId !== rowId) {
            if (retry.timer) clearTimeout(retry.timer);
            this.definitionRetry = {
                rowId,
                left: DEFINITION_RETRIES,
                timer: null,
            };
        }
        const current = this.definitionRetry;
        if (current.timer || current.left <= 0) return;
        current.left--;
        current.timer = setTimeout(() => {
            current.timer = null;
            if (this.destroyed || !this.controller.isOpen) return;
            const s = this.controller.snapshot();
            const row = s.activeIndex >= 0 ? s.rows[s.activeIndex] : null;
            if (row?.kind !== 'concept' || row.id !== rowId) return;
            const el = document.getElementById(this.optionId(row));
            if (el) this.applyDefinition(el, row);
        }, DEFINITION_RETRY_MS);
    }

    private actionText(row: Extract<ComposerRow, { kind: 'concept' }>): string {
        switch (row.action) {
            case 'remove':
                return t('composer.action.remove');
            case 'replace':
                return t('composer.action.replace').replace(
                    '{label}',
                    row.replaces ?? '',
                );
            case 'confirm':
                return t('composer.inferred');
            default:
                return '';
        }
    }

    /** The fixed-width check column; a checked row differs by this shape. */
    private checkSlot(checked: boolean, inferred = false): HTMLElement {
        const slot = document.createElement('span');
        slot.className = 'ez-composer__check';
        slot.setAttribute('aria-hidden', 'true');
        if (checked) slot.textContent = inferred ? '○' : '✓';
        return slot;
    }

    private span(className: string, text: string): HTMLSpanElement {
        const el = document.createElement('span');
        el.className = className;
        el.textContent = text;
        return el;
    }

    private paintGated(s: ComposerSnapshot): void {
        this.gated.replaceChildren();
        if (s.gatedRows.length === 0) {
            this.gated.hidden = true;
            return;
        }
        this.gated.hidden = false;
        const caption = this.span(
            'ez-composer__gated-caption',
            t('composer.notYetAvailable'),
        );
        this.gated.appendChild(caption);
        for (const row of s.gatedRows) {
            if (row.kind !== 'concept') continue;
            const el = document.createElement('div');
            el.className = 'ez-composer__row ez-composer__row--gated';
            el.append(
                this.checkSlot(false),
                this.span('ez-composer__short', row.suggestion.label),
                this.span('ez-composer__reason', row.gatedReason ?? ''),
            );
            this.gated.appendChild(el);
        }
    }

    private paintStatus(s: ComposerSnapshot): void {
        const concepts = s.rows.filter((r) => r.kind !== 'more');
        if (s.mode === 'ranked' && concepts.length === 0 && s.token.query) {
            this.status.hidden = false;
            this.status.textContent = t('composer.noMatch').replace(
                '{query}',
                s.token.query,
            );
        } else if (
            s.mode === 'browse' &&
            s.rows.length === 0 &&
            s.reading &&
            !s.stale
        ) {
            // Nothing left to add (every category holds what it can): say so,
            // so an empty list reads as done rather than broken.
            this.status.hidden = false;
            this.status.textContent = t('composer.nothingMore');
        } else {
            this.status.hidden = true;
            this.status.textContent = '';
        }
    }

    private renderFooter(s: ComposerSnapshot): void {
        const hint = (keys: string, action: string) => {
            const span = document.createElement('span');
            span.className = 'ez-composer__hint';
            const kbd = document.createElement('kbd');
            kbd.textContent = keys;
            span.append(kbd, document.createTextNode(` ${action}`));
            return span;
        };
        const categories = hint(
            isMacPlatform() ? '⌥↑↓' : 'Alt+↑↓',
            t('composer.categories'),
        );
        categories.classList.add('ez-composer__hint--categories');
        categories.hidden = s.categories.length < 2;
        this.footer.replaceChildren(
            hint('↑↓', t('hint.browse')),
            categories,
            hint('Enter', t(s.activeIndex >= 0 ? 'hint.accept' : 'hint.save')),
            hint('Esc', t('hint.close')),
        );
    }
}
