/**
 * Interactive base class for form components that support editing.
 *
 * Extends ReadOnlyComponentBase with reprocessing, suggestion fetching,
 * assertion add/remove/toggle, token tree access, and tooltip attachment.
 * Interactive components like TagInput, SingleSelect, and CategoryChecklist
 * extend this class.
 */

import type {
    Assertion,
    Change,
    Fix,
    ProcessResult,
    RenderAssessment,
    Suggestion,
    Warning,
} from '@ezclassify/types';
import { buildTokenTree, type TokenTree } from '../token-tree/token-tree';
import { createKeyboardHints, attachTooltip } from './component-utils';
import {
    ReadOnlyComponentBase,
    type ComponentEngineSource,
    type ComponentOptions,
} from './component-base-readonly';
import { createClearButton, type ClearButton } from './clear-button';
import { announce, createAnnouncer } from './accessibility-helpers';
import {
    isUndoChord,
    MarkingUndo,
    valueSignature,
    type UndoKind,
} from './marking-undo';
import { t } from '../i18n';
import {
    assertDescribesConcepts,
    createConceptDescriber,
} from './concept-description';
import { removeAssertionCascade } from './assertion-removal';
import { fixAssertions } from './rule-errors';
import {
    dismissStatusMarkPopover,
    ensureStatusMark,
    explainedChanges,
    recordAppliedFixes,
    setStatusMarkFixes,
    type StatusMarkOptions,
} from './status-mark';
import { factsOfScopeSet, listedScopesOf, writesCategoryOf } from '../scopes';
import {
    applyFieldFrame,
    mountFieldChrome,
    type FieldChrome,
} from './field-chrome';
import {
    assertionFactKey,
    derivedAssertion,
    takenFromWhole,
} from '../assertion-identity';
import type { EzClassifyState } from '../store/ezclassify-store';
import { createComposerPort } from './composer/composer-port';
import { judgedAsHeld } from '../loaded-value';
import { renderViewRefused } from '../render-refusal';
import {
    coveredCategoriesOf,
    suggestionSurfaces,
    type SuggestionSurface,
} from '../format-resolver';
import {
    replacesStated,
    statedAssertions,
    type ComposerCommit,
    type ComposerDraftShape,
    type ComposerPort,
    type ComposerReading,
} from './composer/composer-controller';

// Re-export types from the read-only base so existing imports still work
export type {
    ComponentInstance,
    ComponentOptions,
} from './component-base-readonly';
export {
    CATEGORY_COLORS,
    ReadOnlyComponentBase,
    resolveProfile,
} from './component-base-readonly';

/**
 * Interactive foundation for form components, adding reprocessing, editing,
 * suggestion fetching, and tooltip support on top of the read-only base.
 */
export abstract class ComponentBase extends ReadOnlyComponentBase {
    /**
     * Sequence counter for reprocess: ensures only the latest mutation's result
     * is applied
     */
    private _reprocessSeq = 0;
    private clearControl?: ClearButton;
    private readonly updateClearButton = () => {
        queueMicrotask(() => this.clearControl?.update());
    };
    /**
     * The marking's undo (see marking-undo.ts). A field keeps one of its own
     * until the runtime binds it to a store marking and shares that marking's
     * (see {@link shareUndo}).
     */
    private undo = new MarkingUndo();
    /**
     * Whether the field tells its undo every value it settles on. A shared undo
     * hears the store instead, which sees every field's values.
     */
    private feedsUndo = true;
    private releaseUndo: (() => void) | null = null;
    /** Puts back the value the field held when the edit in progress began. */
    private editStart: (() => Promise<void>) | null = null;
    /** The value the field last settled on, as {@link valueSignature}. */
    private settledValue = '';
    /** Says what an undo did. */
    private undoAnnouncer: HTMLElement | null = null;
    /** Where the undo chord is heard: the whole field (see fieldScope). */
    private undoScope: HTMLElement | null = null;
    private readonly undoKey = (event: KeyboardEvent) => {
        if (!isUndoChord(event) || !this.undo.offer) return;
        // Text typed and not yet committed is the author's last action, so
        // the platform's own undo takes it back.
        if (this.hasTypedDraft(event)) return;
        event.preventDefault();
        event.stopPropagation();
        void this.performUndo();
    };

    override async init(
        container: HTMLDivElement,
        engine?: ComponentEngineSource | null,
        options?: ComponentOptions,
    ): Promise<void> {
        await super.init(container, engine, options);
        if (this._destroyed) return;
        this.settledValue = this.valueSignature();
        this.watchUndo();
        this.undoScope = this.fieldScope();
        this.undoScope.addEventListener('keydown', this.undoKey, true);
        const mount = this.clearButtonMount();
        this.undoAnnouncer = createAnnouncer();
        (mount ?? this.container).appendChild(this.undoAnnouncer);
        if (!mount) return;
        // Clear stays the last control of the chrome; the announcer sits
        // before it.
        this.clearControl = createClearButton({
            label: this.clearLabel(),
            host: this.enhancedInput ?? undefined,
            empty: () => !this.hasClearValue(),
            clear: async () => {
                this.editStart = null;
                this.undo.make('clear', this, this.captureValue(true));
                this.discardDraft();
                await this.setValue('');
                this.discardDraft();
            },
            undoOffer: () => this.undo.offer,
            undo: () => this.undo.perform(),
            focusField: () => this.focusField(),
        });
        mount.appendChild(this.clearControl.button);
        mount.insertBefore(this.undoAnnouncer, this.clearControl.button);
        this.container.addEventListener('input', this.updateClearButton);
    }

    /**
     * Use the undo of the store marking this field is bound to, which every
     * field bound to it shares and the runtime feeds the marking's values. The
     * runtime calls this once the field is wired to the store.
     *
     * @internal
     */
    shareUndo(undo: MarkingUndo): void {
        if (undo === this.undo) return;
        this.undo.end(this);
        this.undo = undo;
        this.feedsUndo = false;
        this.watchUndo();
    }

    /** Follow the offer of the undo the field uses now. */
    private watchUndo(): void {
        this.releaseUndo?.();
        this.releaseUndo = this.undo.subscribe(() => {
            this.clearControl?.update();
        });
        this.clearControl?.update();
    }

    /**
     * The edit the author is making starts now: keep what the field holds, so
     * once the edit changes it, the marking can go back. Every path an author
     * edits the value through calls this first; a value the field takes from
     * its host or its store does not.
     */
    protected beginUserEdit(): void {
        this.editStart ??= this.captureValue();
    }

    /**
     * What the field holds now, and how to put it back. A value the engine read
     * completely goes back as its facts, so what the rules derived from them is
     * derived again and explained again; text the engine could not read all of
     * goes back as that text.
     *
     * @param clearing - Whether a clear is about to take it, which also takes
     *   whatever the field has in progress
     */
    protected captureValue(_clearing = false): () => Promise<void> {
        const assertions = this.assertions.map((a) => ({ ...a }));
        const rendered = this._lastRendered;
        const asText = this.unreadSpans.length > 0;
        return async () => {
            if (this._destroyed) return;
            this.discardDraft();
            if (asText) {
                await this.setValue(rendered);
                return;
            }
            this.invalidateValueRead();
            if (replacesStated(this.assertions, assertions))
                this._appliedFixes.clear();
            this.assertions = assertions;
            await this.reprocessNow();
        };
    }

    /**
     * Undo the marking's last action, then return to the field and say so.
     *
     * @returns Whether there was anything to undo
     */
    protected async performUndo(): Promise<boolean> {
        const kind: UndoKind | undefined = this.undo.offer?.kind;
        if (!(await this.undo.perform())) return false;
        if (this._destroyed) return true;
        this.focusField();
        if (this.undoAnnouncer)
            announce(
                this.undoAnnouncer,
                t(
                    kind === 'clear'
                        ? 'a11y.markingRestored'
                        : 'a11y.lastEditUndone',
                ),
            );
        return true;
    }

    /**
     * What the status mark needs to name the changes in the field's words and
     * end its list with the undo of the author's last edit while the marking
     * offers one.
     */
    protected statusMarkUndo(): Pick<
        StatusMarkOptions,
        'words' | 'undoLastEdit'
    > {
        return {
            words: this.changeWords(),
            undoLastEdit: () =>
                this.undo.offer ? () => void this.performUndo() : null,
        };
    }

    /**
     * Whether the key press lands on text the author has typed and not yet
     * committed: a box inside the field, other than the field's own input, that
     * holds text.
     */
    protected hasTypedDraft(event: KeyboardEvent): boolean {
        const target = event.target;
        return (
            (target instanceof HTMLInputElement ||
                target instanceof HTMLTextAreaElement) &&
            target !== this.enhancedInput &&
            target.value !== ''
        );
    }

    /**
     * The element that holds everything of the field the author works in: its
     * mount, unless the field draws itself around its host instead.
     */
    protected fieldScope(): HTMLElement {
        return this.container;
    }

    /**
     * Put focus in the field itself: after a keyboard clear, and after an undo.
     * The first control in the field's frame that takes focus, outside its
     * chrome.
     */
    protected focusField(): void {
        const target = [
            ...this.fieldScope().querySelectorAll<HTMLElement>(
                'input:not([type="hidden"]), textarea, button, [tabindex]',
            ),
        ].find(
            (el) =>
                el.tabIndex >= 0 &&
                !el.matches(':disabled') &&
                !el.closest('.ez-field-chrome') &&
                el.offsetParent !== null,
        );
        target?.focus({ preventScroll: true });
    }

    /** The value the field holds, as one comparable string. */
    private valueSignature(): string {
        return valueSignature(this._lastRendered, this.assertions);
    }

    /** The clear control's tooltip and accessible name. */
    protected clearLabel(): string {
        return t('aria.clearMarking');
    }

    /**
     * Where clear goes: the component's suite chrome when it mounted one (see
     * {@link mountSuiteChrome}), else the container. A component whose header
     * already carries a clear action returns null.
     */
    protected clearButtonMount(): HTMLElement | null {
        return this.suiteChrome?.element ?? this.container;
    }

    /**
     * The suite's chrome for a control with a header row of its own: the status
     * mark and, once init finishes, clear, at the row's trailing end. Null
     * until the component mounts one.
     */
    protected suiteChrome: FieldChrome | null = null;

    /** The root the component's styles and overlays live in. */
    private get styleRoot(): HTMLElement {
        return this.options.root ?? this.container;
    }

    /**
     * Give `frame` the suite's field frame (field-chrome.css): the box an
     * ordinary input draws, from the library's tokens.
     */
    protected applySuiteFrame(frame: HTMLElement): void {
        applyFieldFrame(frame, this.styleRoot);
    }

    /**
     * Mount the suite's chrome at the trailing end of `row`: the same status
     * mark the text fields carry, and clear after it. A header row takes it in
     * flow (`'inline'`); a single-line field lays it over its trailing edge
     * (`'overlay'`), as the text fields do. The chrome is one element for the
     * component's life; a component that rebuilds its header moves
     * {@link suiteChrome} into the new row.
     */
    protected mountSuiteChrome(
        row: HTMLElement,
        placement: 'inline' | 'overlay' = 'inline',
    ): FieldChrome {
        if (this.suiteChrome) {
            row.appendChild(this.suiteChrome.element);
            return this.suiteChrome;
        }
        const chrome = mountFieldChrome(row, {
            root: this.styleRoot,
            placement,
        });
        ensureStatusMark(chrome.status, {
            shape: 'chrome',
            root: this.styleRoot,
            shouldShowTooltip: () => this.shouldShowTooltip(),
            ...this.statusMarkUndo(),
            onReviewChange: () => this.onStatusReviewChange(),
        });
        this.suiteChrome = chrome;
        this.updateSuiteStatusMark();
        return chrome;
    }

    /**
     * What the author has not reviewed of the changes the suite's status mark
     * lists changed. A control that draws rule-added values differently until
     * they are reviewed draws them again.
     */
    protected onStatusReviewChange(): void {}

    /** Remove the suite's chrome; every component's destroy() calls this. */
    protected destroySuiteChrome(): void {
        this.suiteChrome?.destroy();
        this.suiteChrome = null;
    }

    protected hasClearValue(): boolean {
        return !!this._lastRendered || this.assertions.length > 0;
    }

    protected discardDraft(): void {}

    protected destroyClearButton(): void {
        this.container.removeEventListener('input', this.updateClearButton);
        this.undoScope?.removeEventListener('keydown', this.undoKey, true);
        this.undoScope = null;
        // The snapshot goes with the field that took it.
        this.undo.end(this);
        this.releaseUndo?.();
        this.releaseUndo = null;
        this.undoAnnouncer?.remove();
        this.undoAnnouncer = null;
        this.clearControl?.destroy();
        this.clearControl = undefined;
        this.destroySuiteChrome();
    }

    protected override onAssertionsChanged(): void {
        const value = this.valueSignature();
        if (value !== this.settledValue) {
            this.settledValue = value;
            // The author's edit changed the value: the marking can go back
            // to what it held when the edit began. Offered before the field
            // publishes, so the store's commit of it is heard as its result.
            if (this.editStart) this.undo.make('edit', this, this.editStart);
            this.editStart = null;
            if (this.feedsUndo) this.undo.observe(value);
        }
        super.onAssertionsChanged();
        this.clearControl?.update();
        // The mark says what EzClassify changed in the value the field holds.
        this.updateSuiteStatusMark();
    }

    /**
     * Show on the suite's status mark what EzClassify changed in what the
     * control's marking writes: every such change for a control that holds the
     * whole marking; for a facet, those that changed its own category, the
     * slice of the marking it holds.
     */
    protected updateSuiteStatusMark(): void {
        if (!this.suiteChrome) return;
        const category = this.options.facetOf
            ? this.options.categoryId
            : undefined;
        setStatusMarkFixes(
            this.suiteChrome.status,
            explainedChanges(this.getAppliedFixes(), this.assertions, {
                writes: category ? (id) => id === category : undefined,
                written: this.writtenFact(),
                showsUnwritten: true,
            }),
        );
    }

    /**
     * Close the popover the suite's status mark opened, if it is open. A
     * control whose presses change what it shows without changing its value
     * calls this for a press anywhere but its chrome.
     */
    protected dismissSuiteStatusPopover(): void {
        const mark = this.suiteChrome?.status.querySelector<HTMLElement>(
            ':scope > .ez-status-mark',
        );
        if (mark) dismissStatusMarkPopover(mark);
    }

    /**
     * The changes a text or chip field's status mark explains for the value it
     * holds: those to what its marking writes that its scopes write or it
     * changed, and for a field that shows each fact as a chip, the written
     * facts a rule filled in (see explainedChanges).
     */
    protected fieldStatusChanges(): Change[] {
        return explainedChanges(this.getAppliedFixes(), this.assertions, {
            writes: writesCategoryOf(
                listedScopesOf(this.options),
                this.scheme.categories,
                this.schemeMeta,
            ),
            written: this.writtenFact(),
            showsUnwritten: !this.writesScopesAsText(),
        });
    }
    /**
     * Set to true by destroy(): prevents async callbacks from mutating
     * destroyed state
     */
    protected _destroyed = false;

    protected override get abandoned(): boolean {
        return this._destroyed;
    }

    /**
     * Concept-detail resolution and its result cache for this instance, shared
     * with every other field class via `createConceptDescriber`. Constructed
     * here even though `engine` and `schemeId` are not assigned until `init()`
     * runs; the describer reads those fields live on each call, not at
     * construction time.
     */
    private readonly _conceptDescriber = createConceptDescriber({
        engine: () => this.engine,
        options: () => this.options,
    });

    /** Every editable field shows concept detail, so it needs `describeConcept`. */
    protected override assertEngineCapabilities(componentLabel: string): void {
        assertDescribesConcepts(this.engine, componentLabel);
    }

    /**
     * Fixes the engine has APPLIED while producing the field's current value,
     * deduplicated by ruleId. Sourced from `ProcessResult.appliedFixes` (the
     * engine's own record, which carries the rule identity and human message);
     * proposed fixes never land here. Accumulates across reprocesses so the
     * status mark keeps communicating state after a later no-fix reprocess;
     * cleared when the field is emptied or its value is replaced (through
     * setValue, a replacing composer commit, or an edit that drops something
     * the field stated).
     */
    protected _appliedFixes = new Map<string, Change>();

    /**
     * Fixes the engine applied while producing the field's current value,
     * deduplicated by rule. Empty when the value is exactly what the user built
     * with no rule-driven changes.
     */
    getAppliedFixes(): readonly Change[] {
        return [...this._appliedFixes.values()];
    }

    protected override recordAppliedFixes(
        fixes: readonly Change[],
        reset = false,
    ): void {
        if (reset) this._appliedFixes.clear();
        recordAppliedFixes(this._appliedFixes, fixes);
    }

    /**
     * A picker holds the facts of its scope set: the scopes its host lists, the
     * scheme's default scope when it lists none. A fact of another scope
     * belongs to the controls that write that scope, so the picker neither
     * shows it nor states it back, and a value removed or cleared here leaves
     * it where it is. A facet holds its own category, whatever scope that is
     * in. A text field holds what its text reads as, which its format decides.
     */
    protected override heldFacts(
        assertions: readonly Assertion[],
    ): Assertion[] {
        if (
            !this.scheme ||
            !this.schemeMeta ||
            this.writesScopesAsText() ||
            this.options.facetOf ||
            this.options.resolveFacetSiblings
        )
            return [...assertions];
        return factsOfScopeSet(
            assertions,
            listedScopesOf(this.options),
            this.scheme.categories,
            this.schemeMeta,
        );
    }

    override setAssertions(assertions: Assertion[]): void {
        // A value from the host or the store is nobody's edit here.
        this.editStart = null;
        this.invalidateValueRead();
        // A marking that drops something the field stated replaces its value,
        // and the fixes behind the old value no longer explain it.
        const held = this.heldFacts(assertions);
        if (replacesStated(this.assertions, held)) this._appliedFixes.clear();
        this.assertions = held;
        this.reprocess();
    }

    /**
     * Reflect an already evaluated marking, including unrecognized text and
     * facts its text leaves out, of those the field holds (see
     * {@link heldFacts}). Reprocessing only its assertions would erase the text
     * and publish a different marking back to the store. The store's judgment
     * of the marking comes with it, so every field bound to it shows the same
     * errors and ways to fix. The fixes the store's reading applied are
     * explained too; a state that echoes the value the field holds keeps the
     * field's own explanation of how that value came about.
     */
    applyStoreState(state: EzClassifyState): void {
        this.editStart = null;
        this.invalidateValueRead();
        ++this._reprocessSeq;
        if (this._destroyed) return;
        // A refused state's text is the engine's marker, not a marking: the
        // field keeps the value it holds and says why.
        const refused = renderViewRefused(state);
        const replacesValue = !refused && state.rendered !== this._lastRendered;
        this.assertions = this.heldFacts(state.assertions);
        this.failedRead = null;
        if (!refused) this._lastRendered = state.rendered;
        // A structured or computed state has no recognition: nothing was read.
        // A marking's text states its default scope.
        this.noteReading(refused ? {} : state, undefined, {
            surface: this.schemeMeta.defaultScope,
        });
        this.displayColor = state.displayColor;
        this.recordAppliedFixes(state.appliedFixes ?? [], replacesValue);
        if (refused)
            this.showRenderRefusal(state, state.errors, state.proposedFixes);
        else this.updateValidationErrors(state.errors, state.proposedFixes);
        this.onAssertionsChanged();
        if (!refused && !state.assessment) this.assessHeldForm();
    }

    /**
     * Learn which of the held facts the field's form writes, for a state that
     * came with no assessment of a text: one composed from facts. Only a fact
     * the engine derived can go unwritten, so a value with none needs no
     * answer. The field draws its facts and explains its changes again once the
     * answer lands, unless a newer value has replaced the one it is for.
     */
    private assessHeldForm(): void {
        if (this.writesScopesAsText()) return;
        const held = [...this.assertions];
        if (!held.some(derivedAssertion)) return;
        const seq = this._reprocessSeq;
        const formatId = this.formatId;
        void Promise.resolve()
            .then(() => this.callRender(held, { format: formatId }))
            .then((written) => {
                if (seq !== this._reprocessSeq || this._destroyed) return;
                this.noteHeldForm({ formatId, assessment: written.assessment });
                this.render();
                this.updateSuiteStatusMark();
            })
            .catch(() => {
                // Without an answer every held fact counts as written.
            });
    }

    /**
     * Add an assertion. Re-processes through the engine to apply constraints,
     * inference, and defaults.
     */
    protected addAssertion(
        conceptId: string,
        categoryId: string,
        value?: string,
        insertIndex?: number,
    ): void {
        this.beginUserEdit();
        // Single-select categories: remove existing concept before adding the new one
        const category = this.scheme.categories.find(
            (f) => f.id === categoryId,
        );
        if (category?.single) {
            this.assertions = this.assertions.filter(
                (a) => a.categoryId !== categoryId,
            );
        }

        // Don't add duplicates; upgrade inferred to explicit
        const existing = this.assertions.find(
            (a) => a.conceptId === conceptId && a.categoryId === categoryId,
        );
        if (existing) {
            if (existing.confidence === 'inferred') {
                existing.confidence = 'certain';
                existing.source = 'user';
                this.reprocess();
            }
            return;
        }

        const assertion: Assertion = {
            conceptId,
            categoryId,
            confidence: 'certain',
            source: 'user',
            ...(value ? { value } : {}),
        };
        if (
            insertIndex !== undefined &&
            insertIndex >= 0 &&
            insertIndex < this.assertions.length
        ) {
            this.assertions.splice(insertIndex, 0, assertion);
        } else {
            this.assertions.push(assertion);
        }

        this.reprocess();
    }

    /**
     * A pressed fix changes the value the same way a pick does: the concepts it
     * keeps and adds become the author's marking, in one write, and the engine
     * settles everything they imply before the field writes the result back to
     * its host.
     */
    protected override ruleFixHandler(): (fix: Fix) => void {
        return (fix) => {
            if (this._destroyed) return;
            this.beginUserEdit();
            this.reprocessEdit(fixAssertions(fix));
        };
    }

    /**
     * Toggle a suggestion: add if not present, remove if explicit, upgrade if
     * inferred
     */
    protected toggleSuggestion(s: {
        conceptId: string;
        categoryId: string;
        selected?: boolean;
    }): void {
        this.beginUserEdit();
        if (s.selected) {
            const assertion = this.assertions.find(
                (a) =>
                    a.conceptId === s.conceptId &&
                    a.categoryId === s.categoryId,
            );
            if (assertion?.confidence === 'inferred') {
                // Upgrade inferred to explicit
                assertion.confidence = 'certain';
                assertion.source = 'user';
                this.reprocess();
            } else {
                this.removeAssertion(s.conceptId, s.categoryId);
            }
        } else {
            this.addAssertion(s.conceptId, s.categoryId);
        }
    }

    /**
     * A new value replaces the old one: any read still in flight for the old
     * value (a reprocess, or a judging read started by a whole or parts change)
     * is for a marking the field no longer holds, and its errors and fixes must
     * not be painted over the new value's.
     */
    override async setValue(value: string): Promise<void> {
        ++this._reprocessSeq;
        return super.setValue(value);
    }

    /**
     * An editable field reads its value as the author's call: the proven fix
     * paths are the buttons under it.
     */
    protected override readValue(value: string): Promise<ProcessResult> {
        return Promise.resolve(
            this.callProcess(value, {
                outputFormat: this.formatId,
                context: this.getProcessingContext(),
            }),
        );
    }

    /**
     * The parts this field's whole covers changed: judge the current value
     * against them again and show what that finds. Only the errors and their
     * fixes are refreshed; the value itself is not rewritten or republished,
     * because nothing the author stated changed.
     */
    refreshParts(): void {
        if (!this.coversParts || this._destroyed) return;
        // A value that never read has nothing to judge yet: read it first.
        if (this.readFailed) {
            this.retryRead();
            return;
        }
        const userAssertions = statedAssertions(this.assertions);
        // An empty whole is judged only once a part is marked: then it is
        // missing everything the parts carry, and the field offers the fix.
        // No recognized assertions can also mean unread text; keep its report.
        if (userAssertions.length === 0 && !this.partsMarked) {
            if (!this._lastRendered.trim()) this.updateValidationErrors([]);
            return;
        }
        this.judgeAgain(userAssertions);
    }

    /**
     * The whole this part belongs to changed: judge the current value against
     * it again and show what that finds, the same way {@link refreshParts} does
     * for a whole. Only a field that reads in its whole's context has anything
     * to refresh.
     */
    refreshWhole(): void {
        if (this._destroyed) return;
        if (this.readFailed) {
            this.retryRead();
            return;
        }
        if (!this.getProcessingContext()) return;
        const userAssertions = statedAssertions(this.assertions);
        if (userAssertions.length === 0) return;
        this.judgeAgain(userAssertions);
    }

    /**
     * Read the author's assertions again and replace the errors, fixes and
     * warnings the field shows. The value itself is not rewritten or
     * republished, because nothing the author stated changed.
     */
    private judgeAgain(userAssertions: Assertion[]): void {
        // A reprocess already under way reads the parts itself; a newer one
        // started while this read runs makes this one stale.
        const seq = this._reprocessSeq;
        const current = () => seq === this._reprocessSeq && !this._destroyed;
        const read = (assertions: Assertion[]) =>
            this.callProcess('', {
                outputFormat: this.formatId,
                assertions,
                context: this.getProcessingContext(),
            });
        void Promise.resolve()
            .then(() =>
                judgedAsHeld(userAssertions, read(userAssertions), (settled) =>
                    read(statedAssertions(settled.assertions)),
                ),
            )
            .then((result) => {
                if (!current()) return;
                this.updateValidationErrors(
                    result.errors ?? [],
                    result.proposedFixes,
                    result.warnings,
                );
            })
            .catch((error: unknown) => {
                if (current()) this.showReadFailure(error);
            });
    }

    /**
     * Re-process current assertions through the engine to apply all rules
     * (constraints, inference, defaults, repair). Updates assertions, rendered
     * string, and triggers onAssertionsChanged.
     */
    protected reprocess(): void {
        void this.reprocessNow();
    }

    /**
     * {@link reprocess}, returning a promise that settles once the result has
     * been applied (or discarded as stale, or failed). The composer's commit
     * awaits this so the stored value, the host write-back and its native
     * `input` event have all happened before it reports the commit.
     *
     * @param processEmpty - Evaluate empty category selections through the
     *   engine so its defaults apply; text controls may still clear to blank.
     */
    protected reprocessNow(processEmpty = false): Promise<void> {
        // Sequence guard: if another reprocess fires before this one completes,
        // the stale result is discarded (only the latest mutation wins).
        const seq = ++this._reprocessSeq;

        // Only render user-selected assertions. Inferred concepts are stripped so
        // the engine re-derives them from the current user set; removing a concept
        // also removes anything it implied.
        const userAssertions = statedAssertions(this.assertions);
        const facetCategory = this.options.resolveFacetSiblings
            ? this.options.categoryId
            : undefined;
        const siblings = this.options.resolveFacetSiblings?.() ?? [];

        // Skip the API call when there's nothing to process
        if (
            !processEmpty &&
            userAssertions.length === 0 &&
            this.assertions.length === 0
        ) {
            this._lastRendered = '';
            this.noteReading({});
            // Cleared field: back to the starless "enhanced" state.
            this._appliedFixes.clear();
            this.updateValidationErrors([]);
            this.onAssertionsChanged();
            // A cleared whole still has to cover its parts.
            this.refreshParts();
            return Promise.resolve();
        }

        const userByKey = new Map(
            userAssertions.map((a) => [assertionFactKey(a), a]),
        );

        const applyResult = (result: {
            assertions: Assertion[];
            rendered: string;
            errors?: Array<{ constraintId: string; message: string }>;
            appliedFixes?: Change[];
            proposedFixes?: Fix[];
            warnings?: Warning[];
            assessment?: RenderAssessment;
        }) => {
            if (seq !== this._reprocessSeq || this._destroyed) return;
            this.assertions = this.heldFacts(result.assertions)
                .filter((assertion) =>
                    facetCategory
                        ? assertion.categoryId === facetCategory
                        : true,
                )
                .map((a) => {
                    const key = assertionFactKey(a);
                    const chosen = userByKey.get(key);
                    if (chosen) {
                        const settled = { ...a, ...chosen };
                        // An absent attribution is also part of the chosen provenance.
                        if (chosen.sourceRule === undefined)
                            delete settled.sourceRule;
                        return settled;
                    }
                    // Canonical values can differ from the chosen input. The
                    // reader retains their chosen origin without a local codec.
                    if (a.source === 'user' || a.source === 'parse') return a;
                    // A value taken from the whole keeps its source: relabeled,
                    // it would read as the part's own and be stated on the
                    // next pass.
                    if (takenFromWhole(a)) return a;
                    // Defaults are certain origins. Marking them inferred would
                    // make getSuggestions() hide their checked rows as if they
                    // were engine-derived side effects.
                    return {
                        ...a,
                        confidence:
                            a.source === 'default'
                                ? ('certain' as const)
                                : ('inferred' as const),
                    };
                });
            // The engine could not write this selection, so its text is the
            // refusal marker. The field keeps the value it holds; the selection
            // stays visible so the author can change it, and the status says
            // why it could not be written.
            const refused = renderViewRefused(result);
            if (!refused) this._lastRendered = result.rendered;
            this.noteReading(refused ? {} : result);
            recordAppliedFixes(this._appliedFixes, result.appliedFixes);
            if (refused)
                this.showRenderRefusal(
                    result,
                    result.errors,
                    result.proposedFixes,
                    result.warnings,
                );
            else if (result.errors)
                this.updateValidationErrors(
                    result.errors,
                    result.proposedFixes,
                    result.warnings,
                );
            this.onAssertionsChanged();
        };

        // A read that raises leaves the marking as it was and says why.
        const failed = (error: unknown) => {
            if (seq !== this._reprocessSeq || this._destroyed) return;
            this.showReadFailure(error);
        };

        // Single process() call with pre-built assertions: skips the parse stage
        // and avoids a separate render() round-trip.
        // The facts the engine settles on are judged as the value the field
        // will hold (see judgedAsHeld), so a repair the engine made is not
        // offered back as a way to fix.
        const read = (assertions: Assertion[]) =>
            this.callProcess('', {
                outputFormat: this.formatId,
                assertions,
                context: this.getProcessingContext(),
            });
        const asked = [...siblings, ...userAssertions];
        let processResult: ProcessResult | Promise<ProcessResult>;
        try {
            processResult = judgedAsHeld<ProcessResult>(
                asked,
                read(asked),
                (settled) => read(statedAssertions(settled.assertions)),
            );
        } catch (error) {
            failed(error);
            return Promise.resolve();
        }

        if (processResult && !('then' in processResult)) {
            applyResult(processResult);
            return Promise.resolve();
        }

        // Async engine: await the result
        return Promise.resolve(processResult).then(applyResult).catch(failed);
    }

    /**
     * Remove an assertion by concept+category. Re-processes through the engine
     * to apply cascades, inference, and defaults.
     */
    protected removeAssertion(conceptId: string, categoryId: string): void {
        this.beginUserEdit();
        this.reprocessEdit(
            removeAssertionCascade(
                this.assertions,
                conceptId,
                categoryId,
                this.scheme,
                this.schemeMeta,
            ),
        );
    }

    /**
     * Store an edit made outside the composer (a tag removed, a pressed fix)
     * and reprocess it. An edit that drops something the field stated replaces
     * the value, the same rule a composer commit follows (see
     * `replacesStated`): the fixes behind the old value no longer describe the
     * field, so the record starts over and the reprocess records the repairs
     * that still apply. An edit that only adds keeps them.
     */
    private reprocessEdit(next: Assertion[]): void {
        if (replacesStated(this.assertions, next)) this._appliedFixes.clear();
        this.assertions = next;
        this.reprocess();
    }

    /**
     * Disambiguate suggestions with duplicate labels in the same group by
     * appending (parent)
     */
    protected disambiguateSuggestions(suggestions: Suggestion[]): Suggestion[] {
        // Find labels that appear more than once in the same group
        const groupLabels = new Map<string, Map<string, number>>();
        for (const s of suggestions) {
            const labels =
                groupLabels.get(s.group) ?? new Map<string, number>();
            labels.set(s.label, (labels.get(s.label) ?? 0) + 1);
            groupLabels.set(s.group, labels);
        }

        // For duplicates, clone and append parent info
        const result: Suggestion[] = [];
        let conceptsById:
            Map<string, (typeof this.scheme.concepts)[number]> | undefined;
        for (const s of suggestions) {
            if ((groupLabels.get(s.group)?.get(s.label) ?? 0) > 1) {
                conceptsById ??= new Map(
                    this.scheme.concepts.map((concept) => [
                        concept.id,
                        concept,
                    ]),
                );
                const concept = conceptsById.get(s.conceptId);
                if (concept?.parents.length) {
                    const parent = conceptsById.get(concept.parents[0]);
                    const parentLabel =
                        parent?.views['default'] ?? parent?.id ?? '';
                    if (parentLabel) {
                        result.push({
                            ...s,
                            label: `${s.label} (${parentLabel})`,
                        });
                        continue;
                    }
                }
            }
            result.push(s);
        }
        return result;
    }

    /**
     * Resolve a concept's detail text: the one algorithm every dwell surface
     * (dropdown rows, painted tokens, chips) reads from, via
     * `createConceptDescriber`. Lazy-loads from the engine on first call, then
     * caches.
     */
    protected resolveConceptDescription(
        conceptId: string,
        categoryId: string,
    ): string | undefined {
        return this._conceptDescriber.resolve(conceptId, categoryId);
    }

    /**
     * Attach a concept tooltip to a DOM element. Shows on hover/focus with full
     * concept description including rules.
     */
    protected attachConceptTooltip(
        el: HTMLElement,
        conceptId: string,
        categoryId: string,
    ): void {
        attachTooltip(
            el,
            () => this.resolveConceptDescription(conceptId, categoryId),
            this.options.root,
            () => this.shouldShowTooltip(),
        );
    }

    /**
     * Guard for tooltip display: honors the host's declarative opt-out
     * (`data-ezclassify-no-tooltips` → options.tooltips === false); subclasses
     * can override to suppress tooltips contextually.
     */
    protected shouldShowTooltip(): boolean {
        return this._conceptDescriber.enabled();
    }

    /**
     * Get suggestions from the engine. Filters out concepts that are already
     * inferred in a given category; the user shouldn't see them as selectable
     * since they were auto-added. Example: USA in owner_producer is inferred
     * when TS is selected; showing it in the dropdown would let the user click
     * it thinking they're adding it to REL TO.
     *
     * When the component is category-bound (options.categoryId, wired from
     * `data-ezclassify-category`), the result is scoped to that category's
     * suggestions. The engine's suggest API has no category option, so this is
     * the chokepoint: without it, a bound field's dropdown offers concepts the
     * facet binding will refuse anyway, so they are dead rows.
     *
     * `liveContext`, when supplied, overrides which assertions the engine
     * treats as "currently present" for this call, REGARDLESS of whether a
     * filter is active; see MarkingField.refreshSuggestions for why it needs
     * this. Every other caller leaves it undefined and keeps the behavior
     * described below unchanged.
     */
    protected async getSuggestions(
        filter?: string,
        liveContext?: Assertion[],
    ): Promise<Suggestion[]> {
        // When the user is actively typing a filter, they want to FIND/SWITCH a
        // concept; so suggest must offer all matching concepts, including
        // alternatives to an already-selected single-select value (e.g. typing
        // "TIER 2" while TIER 3 is set must still surface TIER 2). Passing the
        // current full marking as input, or the field's own complete assertions as
        // context, makes the engine treat single-select categories as "satisfied"
        // and return only the current value, hiding the alternatives. So for the
        // filtered path we query by filter alone (empty input, no own-marking
        // context). With no filter (browsing), keep the contextual behavior so
        // cross-category gating still applies. A caller that supplies
        // `liveContext` wants the opposite of that filtered-path carve-out: it
        // has already resolved its own live state and wants the engine's full
        // suppression/rule/constraint machinery to evaluate against it even
        // while filtering (a checked, still-selected row keeps rendering
        // because the engine marks it `selected: true` rather than dropping
        // it, not because context was withheld).
        const hasFilter = !!(filter && filter.trim());
        const rendered =
            liveContext !== undefined || !hasFilter ? this.getRendered() : '';
        const chosen =
            liveContext !== undefined
                ? liveContext
                : hasFilter
                  ? []
                  : this.assertions;
        const options = {
            outputFormat: this.formatId,
            surface: this.options.scope,
        };
        const suggestions =
            rendered && chosen.length > 0
                ? Object.values(
                      (
                          await Promise.resolve(
                              this.callProcess(rendered, {
                                  ...options,
                                  assertions: chosen,
                                  suggestFor: this.options.categoryId
                                      ? [this.options.categoryId]
                                      : this.scheme.categories.map(
                                            (category) => category.id,
                                        ),
                              }),
                          )
                      ).suggestionsFor ?? {},
                  ).flatMap((answer) => answer.suggestions)
                : (
                      await Promise.resolve(
                          this.callSuggest(
                              chosen.length > 0 ? chosen : rendered,
                              {
                                  ...options,
                                  filter: filter || undefined,
                                  includeGated: hasFilter || undefined,
                              },
                          ),
                      )
                  ).suggestions;

        const boundCategory = this.options.categoryId;
        const scoped = boundCategory
            ? suggestions.filter((s) => s.categoryId === boundCategory)
            : suggestions;
        // Build set of concept+category pairs that are inferred (not user-added).
        // Sourced from `liveContext` when the caller supplied one, so a live
        // edit's own inferred concepts are excluded the same tick, not one
        // keystroke behind (same reasoning as `rendered`/`assertions` above).
        const inferredPairs = new Set(
            (liveContext ?? this.assertions)
                .filter((a) => a.confidence === 'inferred')
                .map((a) => `${a.conceptId}::${a.categoryId}`),
        );
        return inferredPairs.size > 0
            ? scoped.filter(
                  (s) => !inferredPairs.has(`${s.conceptId}::${s.categoryId}`),
              )
            : scoped;
    }

    /**
     * The composer port for a field built on this base: every engine call the
     * shared composer makes goes through this component's own scheme, format,
     * context and suggest binding, so the composer never re-derives any of it.
     *
     * @param shape - 'whole' when the field's text is the whole marking,
     *   'additive' when it adds to the committed set (TagInput)
     */
    protected composerPort(shape: ComposerDraftShape): ComposerPort {
        return createComposerPort({
            shape,
            binding: {
                process: (text, request) =>
                    Promise.resolve(
                        this.callProcess(text, {
                            outputFormat: this.formatId,
                            surface: this.options.scope,
                            context: this.getProcessingContext(),
                            ...(request?.chosen
                                ? { assertions: [...request.chosen] }
                                : {}),
                        }),
                    ),
                validate: (text) =>
                    Promise.resolve(
                        this.callValidate(text, {
                            outputFormat: this.formatId,
                            surface: this.options.scope,
                            context: this.getProcessingContext(),
                        }),
                    ),
                coveredCategories: () =>
                    coveredCategoriesOf(
                        this.engine,
                        this.formatId,
                        this.options.scope,
                    ),
                write: (assertions) =>
                    Promise.resolve(
                        this.callRender([...assertions], {
                            format: this.formatId,
                        }),
                    ),
                readsInWhole: () =>
                    this.getProcessingContext()?.partOf !== undefined,
            },
            scheme: () => this.scheme,
            meta: () => this.schemeMeta,
            formatId: () => this.formatId,
            scope: () => this.options.scope,
            scopes: () => this.options.scopes ?? [],
            categoryId: () => this.options.categoryId,
            suggestions: (live) => this.composerSuggestions(live),
            gated: (query, live) => this.composerGated(query, live),
            committed: () => ({
                assertions: this.assertions,
                rendered: this._lastRendered,
            }),
            store: (reading, commit) =>
                this.storeComposerReading(reading, commit),
            siblings: () => this.options.resolveFacetSiblings?.() ?? [],
            ownCategory: () =>
                this.options.resolveFacetSiblings
                    ? this.options.categoryId
                    : undefined,
        });
    }

    /**
     * Every concept this field offers, for the composer's catalog. Asked once
     * per open without the field's own assertions, retaining its whole context:
     * the list must show the other choices in a filled single-choice category
     * (a replace row), and which rows are checked comes from the composer's own
     * reading, not from the engine's `selected` flag. Asked again with `live`,
     * the draft's assertions, for what the scheme offers in their context (see
     * {@link offeredBeside}).
     */
    protected async composerSuggestions(
        live?: readonly Assertion[],
    ): Promise<Suggestion[]> {
        const categories = this.engine.getScheme().categories.map((c) => ({
            id: c.id,
            single: c.single === true,
        }));
        const asked = await Promise.all(
            this.suggestionSurfaces().map((options) =>
                this.offeredBeside(live ?? [], options, categories),
            ),
        );
        const suggestions = asked.flat();
        const bound = this.options.categoryId;
        return this.disambiguateSuggestions(
            suggestions.filter(
                (s) =>
                    !s.conceptId.startsWith('preset:') &&
                    (!bound || s.categoryId === bound),
            ),
        );
    }

    /**
     * What the scheme offers for `categories` on one surface beside the facts
     * in `live`. The engine settles the facts first, so what its rules infer
     * from them (a parent concept a stated child implies) counts. A
     * single-choice category is then asked without its own facts, so it lists
     * every option the other categories allow, not only the one it holds: a
     * choice there replaces its value. Any other category is asked beside every
     * settled fact, so an option that conflicts with one it holds is not
     * offered beside it. A part is asked category by category in its whole's
     * context.
     */
    protected async offeredBeside(
        live: readonly Assertion[],
        options: SuggestionSurface,
        categories: readonly { id: string; single: boolean }[],
    ): Promise<Suggestion[]> {
        const context = this.getProcessingContext();
        const part = context?.role === 'part' || !!context?.partOf;
        if (live.length === 0 && !part)
            return Promise.resolve(this.callSuggest([], options)).then(
                (result) => result.suggestions,
            );
        const alone = part
            ? categories.map((c) => c.id)
            : categories.filter((c) => c.single).map((c) => c.id);
        const settled = await Promise.resolve(
            this.callProcess('', {
                ...options,
                context,
                assertions: [...live],
                ...(alone.length > 0 ? { suggestFor: alone } : {}),
            }),
        );
        const replacing = Object.values(settled.suggestionsFor ?? {}).flatMap(
            (answer) => answer.suggestions,
        );
        if (alone.length === categories.length) return replacing;
        const asked = new Set(alone);
        const beside = (
            await Promise.resolve(
                this.callSuggest(settled.assertions ?? [...live], options),
            )
        ).suggestions.filter((s) => !asked.has(s.categoryId));
        return [...beside, ...replacing];
    }

    /** Rows the scheme's rules gate for `query` given the live assertions. */
    protected async composerGated(
        query: string,
        live: readonly Assertion[],
    ): Promise<Suggestion[]> {
        const asked = await Promise.all(
            this.suggestionSurfaces().map((options) =>
                Promise.resolve(
                    this.callSuggest([...live], {
                        ...options,
                        filter: query,
                        includeGated: true,
                    }),
                ),
            ),
        );
        return asked.flatMap((result) =>
            result.suggestions.filter((s) => s.gated),
        );
    }

    /**
     * Where the composer asks what this field offers (see
     * `suggestionSurfaces`).
     */
    private suggestionSurfaces(): SuggestionSurface[] {
        return suggestionSurfaces(
            this.schemeMeta,
            this.formatId,
            this.options.scope,
            this.options.scopes,
            !!this.options.holdsPart,
        );
    }

    /**
     * Store a complete composer reading as this field's value: what the author
     * stated goes through the ordinary reprocess pipeline, so the host
     * write-back, its native `input` event, the store publish and validation
     * all happen exactly as for any other change. The resulting assertions are
     * the value being committed; diagnostic pre-repair facts never seed it.
     *
     * Reprocessing the statement cannot see how the draft's text was read, so
     * the fixes the engine applied to read it (case, separator, order,
     * spelling) are recorded here, before the reprocess adds any rule repair. A
     * commit that replaces the value (a whole marking, or an additive draft
     * that drops part of what the field held) starts the record over: the fixes
     * behind the value it replaces no longer describe anything, the same as for
     * `setValue`. A commit that only adds keeps them.
     *
     * @param reading - The complete reading the composer commits
     * @param commit - Whether the commit replaces the value or adds to it
     */
    protected async storeComposerReading(
        reading: ComposerReading,
        commit: ComposerCommit,
    ): Promise<void> {
        this.beginUserEdit();
        this.assertions = statedAssertions(this.heldFacts(reading.assertions));
        this.recordAppliedFixes(reading.appliedFixes, commit.replaces);
        await this.reprocessNow();
    }

    /** Append keyboard hint bar to the container */
    /**
     * The control's keys, in the suite's quiet hint row under the control. The
     * row shows while the control has focus, on a pointer with keys.
     */
    protected appendKeyboardHints(
        hints: Array<{ keys: string; action: string }>,
    ): void {
        const row = createKeyboardHints(hints);
        row.classList.add('ez-field-hints');
        this.container.appendChild(row);
    }

    /** Darken a hex color */
    protected darken(hex: string, amount: number): string {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        const f = 1 - amount;
        return (
            '#' +
            Math.round(r * f)
                .toString(16)
                .padStart(2, '0') +
            Math.round(g * f)
                .toString(16)
                .padStart(2, '0') +
            Math.round(b * f)
                .toString(16)
                .padStart(2, '0')
        );
    }

    /** Get token tree for current assertions */
    protected getTokenTree(): TokenTree {
        return buildTokenTree(
            this.assertions,
            this.scheme,
            this.schemeMeta,
            this.formatId,
        );
    }

    /**
     * Relevance score for a query against one candidate string.
     *
     * Tiered so a real, visible match always outranks a loose one: exact (100),
     * prefix (90), substring (70), then a bounded subsequence fallback for
     * abbreviations and dropped letters (e.g. "scrt" -> "SECRET"). The
     * subsequence level is bounded because, unbounded, any short query matches
     * almost any long label by scattering its letters ("arch" spread across
     * "Lincoln Branch"), which floods the list with noise and hides the real
     * no-match / already-selected states. Bounding the matched span to at most
     * twice the query length keeps only tight subsequences and drops the
     * scatter.
     *
     * @param query - The user's filter text
     * @param target - A candidate label, name, or view string
     * @returns 0 for no match, 1 for an empty query, up to 100 for an exact hit
     */
    protected fuzzyMatch(query: string, target: string): number {
        if (!query) return 1;
        const q = query.toLowerCase();
        const t = target.toLowerCase();
        if (t === q) return 100;
        if (t.startsWith(q)) return 90;
        if (t.includes(q)) return 70;

        // Subsequence fallback: every query character appears in order. Track the
        // span of the matched run so a scattered match across a long label is
        // rejected rather than scored like a real one.
        let qi = 0;
        let firstIdx = -1;
        let lastIdx = -1;
        for (let ti = 0; ti < t.length && qi < q.length; ti++) {
            if (t[ti] === q[qi]) {
                if (firstIdx < 0) firstIdx = ti;
                lastIdx = ti;
                qi++;
            }
        }
        if (qi !== q.length) return 0;

        const span = lastIdx - firstIdx + 1;
        // A tight subsequence stays close to the query length; a scattered one
        // spreads far past it. Anything looser than 2x is noise, not a match.
        if (span > q.length * 2) return 0;

        // Tighter spans score higher, but the fallback never reaches the
        // substring level (70), so a genuine substring match always wins.
        return Math.round(40 * (q.length / span)) + 10;
    }
}
