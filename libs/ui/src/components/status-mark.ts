/**
 * Enhancement status mark (ARCHITECTURE.md "Enhancement Status Indicator").
 *
 * Every enhanced input and textarea carries exactly one EzClassify status mark:
 * the 3-bar-plus-sparkle brand glyph. It cycles through four states as fixes
 * arrive and get noticed:
 *
 * - **quiet**: no applied fixes. The whole glyph sits muted.
 * - **unseen**: a marking rule changed the marking and the author has not yet
 *   been shown what. The whole mark turns strong, and the number of changes
 *   stands beside it.
 * - **seen**: the list has actually presented (hover-intent delay elapsed,
 *   keyboard focus, or a press). The number goes; the whole mark stays strong
 *   as "done and known."
 * - **error**: the field could not check all of its text (see
 *   {@link setStatusMarkError}). The whole mark turns the error color and the
 *   popover leads with the reason. It overrides the fix states until the field
 *   clears it, and needs no acknowledgment: it lasts as long as its cause.
 *
 * A fresh fix the user hasn't been shown re-arms unseen even if earlier fixes
 * on the same field were already seen (whole-mark, not per-fix, but a field
 * with any un-shown fix reads as unseen). Clearing the fix set returns to quiet
 * and forgets what was seen, so the next fix starts unseen again. State lives
 * in-memory per mark element; there is no persistence across mounts.
 *
 * Editable controls open their tabbed Auto-fixes and Favorites tools only by a
 * press or Ctrl/Cmd+Shift+Enter; hover shows the shortcut hint. Opening puts
 * focus on the selected tab. The preview behavior below applies to marks that
 * do not provide tools.
 *
 * Needs attention reports unresolved findings. Auto-fixes lists changes
 * EzClassify already made. Hovering (past the tooltip's hover-intent delay) or
 * focusing an active mark previews every change EzClassify made to what the
 * author chose, one line per change to the marking however many rules made it:
 * what was added, removed or replaced, in the field's own words for the value
 * and its category, with the rule that did it under it. A change that adds or
 * removes nothing keeps the engine's own words for it (its `message`). While
 * the marking can go back to what it was before the author's last edit, the
 * list ends with that undo. It lists only what the field's scopes write or what
 * it changed, and only changes to what the marking writes: a fact a rule
 * derived that the marking does not write, such as a member collapsed into its
 * group's name, is not a change the author signs. Pressing it (a tap, a click,
 * Enter or Space) opens that list until a second press, Escape, or a press or
 * focus outside the field closes it; a phone has no hover, so the press is its
 * only way in. A hovered list can be reached: the pointer can move from the
 * mark into it, and it closes a moment after the pointer has left both. Tab
 * from the mark reaches its undo. The list sits outside the field's box, so it
 * never covers what it explains, right next to the mark: on the side of the
 * field the mark is toward, its trailing edge lined up with the mark's. The
 * indicator communicates state; it is not a per-fix activity feed.
 *
 * The module owns the single-mark invariant: `ensureStatusMark` is idempotent
 * per wrap element and `setStatusMarkFixes` mutates the existing mark in place,
 * so re-renders can never stack indicators.
 */

import type { Assertion, AssertionRef, Change, Fix } from '@ezclassify/types';
import {
    attachTooltip,
    hideTooltip,
    showTooltip,
    repositionTooltip,
    type TooltipPlacement,
} from './tooltip-manager';
import { derivedAssertion, takenFromWhole } from '../assertion-identity';
import { t } from '../i18n';
import { isMacPlatform } from './dom-helpers';
import { writtenConcept, type ConceptWriting } from '../written-concept';
import type { WrittenFactTest } from '../written-facts';
import { adoptStylesOnce } from '../styles/adopt';
import statusMarkCss from './status-mark.css?inline';
import {
    ruleAttribution,
    RuleErrorList,
    type RuleErrorReport,
} from './rule-errors';
import {
    bindMarkingToolsShortcut,
    buildMarkingTools,
    focusMarkingTools,
    type MarkingToolsTargets,
    updateMarkingToolsCounts,
} from './marking-tools';

/** A concept in a category, as one string. */
function refKey(ref: Pick<AssertionRef, 'categoryId' | 'conceptId'>): string {
    return `${ref.categoryId}\u0000${ref.conceptId}`;
}

/**
 * What a change did to the marking: the concepts it added and removed, in their
 * categories. Two rules that each add the same concept made one change to the
 * marking, so the mark explains it once. A change that adds and removes nothing
 * (a spelling or order the reading went through) is known by what it says.
 */
function effectKey(change: Change): string {
    const refs = (list: readonly AssertionRef[] | undefined) =>
        (list ?? []).map(refKey).sort();
    const add = refs(change.add);
    const remove = refs(change.remove);
    return add.length > 0 || remove.length > 0
        ? JSON.stringify(['effect', add, remove])
        : JSON.stringify(['note', change.action, change.message]);
}

/**
 * Whether a scheme rule added this fact to the marking. A category's default
 * and a value a part takes from its whole are not changes to what the author
 * chose; they hold before the author chooses anything.
 */
function ruleAdded(assertion: Assertion): boolean {
    return (
        assertion.sourceRule !== undefined &&
        derivedAssertion(assertion) &&
        assertion.source !== 'default' &&
        !takenFromWhole(assertion)
    );
}

/** What a field shows of the marking it holds, so its mark explains that. */
export interface ExplainedField {
    /**
     * Whether the field writes a category's facts: those of the scopes it
     * writes. Every category when omitted.
     */
    writes?: (categoryId: string) => boolean;
    /**
     * Whether the marking the field shows writes a fact, by the engine's render
     * assessments of the forms it shows (see written-facts.ts). Every fact when
     * omitted.
     */
    written?: WrittenFactTest;
    /**
     * Whether the field shows each fact, a chip or a dot or a row for each, so
     * a fact a rule filled in that no applied change names would show up
     * changed with nothing said. A field that shows only its text does not: the
     * engine names every fact a rule adds that the text writes.
     */
    showsUnwritten: boolean;
}

/**
 * The changes a field's status mark explains for the value it holds: pass the
 * result to {@link setStatusMarkFixes}.
 *
 * The author signs what the marking writes, so a change is one to what the
 * marking writes. A fact a rule derived that the marking does not write (a
 * group's members, collapsed into the group's written name, or a default no
 * output prints) changed nothing the author sees, so it is no change, and a
 * change that touched only such facts is left out. A fact a rule added that the
 * marking does write is a change whether or not the author wrote it. An added
 * tier parent can contribute its spelling to a composed token while the render
 * assessment reports it as collapsed.
 *
 * A field that shows each fact also lists the written facts a rule filled in
 * that no applied change names, each as one change in the engine's wording for
 * an added concept. A field that shows only its text lists none of them.
 *
 * An applied change describes a value the field has moved on from, and is left
 * out, when a concept it added is no longer held or a concept it removed is
 * held again. A change to categories the field does not write is left out too:
 * the mark explains what this field writes or changed, not the rest of the
 * marking.
 *
 * @param applied - The applied changes the field has recorded
 * @param holds - The assertions the field holds now (every marking it holds,
 *   for a field that holds several)
 * @param field - What the field writes and shows
 * @returns The applied changes still behind the value, narrowed to the facts
 *   the marking writes, then one change per filled-in fact no applied change
 *   names
 */
export function explainedChanges(
    applied: readonly Change[],
    holds: readonly Assertion[],
    field: ExplainedField,
): Change[] {
    const writes = field.writes ?? (() => true);
    const written = field.written ?? (() => true);
    const held = new Set(holds.map(refKey));
    const current: Change[] = [];
    for (const change of applied) {
        const added = change.add ?? [];
        const removed = change.remove ?? [];
        if (
            !added.every((ref) => held.has(refKey(ref))) ||
            removed.some((ref) => held.has(refKey(ref)))
        )
            continue;
        if (added.length === 0 && removed.length === 0) {
            current.push(change);
            continue;
        }
        const tierParent =
            change.ruleId === '_tier_child_requires_parent' ? true : undefined;
        const add = added.filter((ref) => written(ref, tierParent));
        const remove = removed.filter((ref) => written(ref));
        const touched = [...add, ...remove];
        if (!touched.some((ref) => writes(ref.categoryId))) continue;
        current.push(
            add.length === added.length && remove.length === removed.length
                ? change
                : { ...change, add, remove },
        );
    }
    if (!field.showsUnwritten) return current;
    const explained = new Set(
        current.flatMap((change) => (change.add ?? []).map(refKey)),
    );
    const filledIn: Change[] = [];
    for (const assertion of holds) {
        const key = refKey(assertion);
        if (
            !ruleAdded(assertion) ||
            !writes(assertion.categoryId) ||
            !written(assertion) ||
            explained.has(key)
        )
            continue;
        explained.add(key);
        const ref = {
            conceptId: assertion.conceptId,
            categoryId: assertion.categoryId,
        };
        filledIn.push({
            ruleId: assertion.sourceRule!,
            action: 'add',
            add: [ref],
            message: fill(t('mark.added'), {
                value: ref.conceptId,
                category: ref.categoryId,
            }),
        });
    }
    return [...current, ...filledIn];
}

/**
 * A change's identity: its rule, what it did and to what, and what it says. One
 * rule that removes three concepts made three changes; reading the same text
 * again makes the same ones.
 */
function fixKey(fix: Change): string {
    const refs = (list: readonly AssertionRef[] | undefined) =>
        (list ?? []).map((ref) => `${ref.categoryId}:${ref.conceptId}`);
    return JSON.stringify([
        fix.ruleId,
        fix.action,
        refs(fix.add),
        refs(fix.remove),
        fix.message,
    ]);
}

/**
 * Add the fixes the engine applied to a field's record of them, each change
 * once: a later reading that makes the same change again does not repeat it.
 * Only applied fixes go here, never proposals; the record is what the field's
 * status mark explains (see {@link setStatusMarkFixes}).
 *
 * @param record - The field's applied fixes, keyed by change
 * @param fixes - `ProcessResult.appliedFixes` from a read of the field
 */
export function recordAppliedFixes(
    record: Map<string, Change>,
    fixes: readonly Change[] | undefined,
): void {
    for (const fix of fixes ?? []) {
        const key = fixKey(fix);
        if (!record.has(key)) record.set(key, fix);
    }
}

/** Put each `{name}` of `template` in its place. */
function fill(template: string, values: Record<string, string>): string {
    return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
        name in values ? values[name] : whole,
    );
}

/**
 * How a field names what a change touched, in the words it shows the author. A
 * field that gives none has the ids said instead.
 */
export interface ChangeWords {
    /** A concept, the way the field writes it (see written-concept.ts). */
    value(ref: Pick<AssertionRef, 'categoryId' | 'conceptId'>): string;
    /** A category's label. */
    category(categoryId: string): string;
}

/**
 * A field's words for the status mark: a value the way the field writes its
 * concept, the same text its options and summaries name it by, and a category
 * by its label. Read when a list is built, so a field can hand this over before
 * its scheme has loaded; until then the ids stand in.
 *
 * @param writing - The field and its scheme, once the scheme has loaded
 */
export function schemeChangeWords(
    writing: () => ConceptWriting | undefined,
): ChangeWords {
    return {
        value: (ref) => {
            const known = writing();
            return known ? writtenConcept(known, ref) : ref.conceptId;
        },
        category: (id) =>
            writing()?.scheme.categories.find((c) => c.id === id)?.label || id,
    };
}

const ID_WORDS: ChangeWords = {
    value: (ref) => ref.conceptId,
    category: (id) => id,
};

/**
 * The lines a change reads as in the mark's list. A change that takes one value
 * out of a category and puts one in is a replacement; otherwise each value it
 * adds and each it removes is a line. A change that touches no value reads as
 * the engine's own message.
 *
 * @param change - An applied change
 * @param words - How the field names values and categories
 * @returns One sentence per line
 */
export function changeLines(
    change: Change,
    words: ChangeWords = ID_WORDS,
): string[] {
    const added = change.add ?? [];
    const removed = change.remove ?? [];
    if (added.length === 0 && removed.length === 0) return [change.message];
    if (
        added.length === 1 &&
        removed.length === 1 &&
        added[0].categoryId === removed[0].categoryId
    )
        return [
            fill(t('mark.replaced'), {
                old: words.value(removed[0]),
                new: words.value(added[0]),
                category: words.category(added[0].categoryId),
            }),
        ];
    return [
        ...added.map((ref) =>
            fill(t('mark.added'), {
                value: words.value(ref),
                category: words.category(ref.categoryId),
            }),
        ),
        ...removed.map((ref) =>
            fill(t('mark.removed'), {
                value: words.value(ref),
                category: words.category(ref.categoryId),
            }),
        ),
    ];
}

/** Options for mounting a status mark on a field wrap. */
export interface StatusMarkOptions {
    /** Use the tabbed field helpers, including a quiet-state entry point. */
    tools?: boolean;
    /** The complete editable control that owns the tools shortcut. */
    keyboardRoot?: HTMLElement;
    /** Suspend the field composer before positioning and focusing the tools. */
    onToolsOpen?: () => void;
    /**
     * Field shape: 'input' self-positions at the right edge of the first line
     * for the bare input host in `ezclassify-ui.ts`'s plain-field path.
     * 'chrome' places the mark inline in a caller-owned flex container.
     * MarkingField, TagInput, MarkedInput, and MarkedTextArea use 'chrome'.
     */
    shape: 'input' | 'chrome';
    /** A category editor explains only changes to the category it owns. */
    correctionCategory?: string;
    /** Root element for style injection and tooltip mounting. */
    root?: HTMLElement;
    /** Tooltip guard (the data-ezclassify-no-tooltips opt-out). */
    shouldShowTooltip?: () => boolean;
    /** How the field names values and categories in the list. */
    words?: ChangeWords;
    /**
     * The undo of the author's last edit while the marking offers one (see
     * marking-undo.ts), else null. The list ends with it.
     */
    undoLastEdit?: () => (() => void) | null;
}

/**
 * The mark's visual states, derived from the field's error, its fixes and what
 * has been shown.
 */
type MarkState = 'quiet' | 'unseen' | 'seen' | 'error';

/** The field still owns its status mark while the phone picker borrows it. */
const statusMarks = new WeakMap<HTMLElement, HTMLElement>();

function statusMarkOf(wrap: HTMLElement): HTMLElement | null {
    const mark = statusMarks.get(wrap);
    if (mark && (mark.parentElement === wrap || mark.isConnected)) return mark;
    return wrap.querySelector<HTMLElement>(':scope > .ez-status-mark');
}

/** The error each mark reports, when its field has one (see setStatusMarkError). */
const markErrors = new WeakMap<HTMLElement, string>();

/** An unresolved report and the field-owned action for that report. */
export interface StatusMarkFinding {
    readonly id?: string;
    readonly heading?: string;
    readonly report: RuleErrorReport;
    readonly apply?: (fix: Fix, pointerType?: string) => void;
}

const markFindings = new WeakMap<HTMLElement, readonly StatusMarkFinding[]>();

function visibleFindings(mark: HTMLElement): readonly StatusMarkFinding[] {
    return markDraftFixes.has(mark) ? [] : (markFindings.get(mark) ?? []);
}

function findingError(mark: HTMLElement): string | undefined {
    return visibleFindings(mark).find(({ report }) => report.messages.length)
        ?.report.messages[0];
}

export function setStatusMarkFindings(
    wrap: HTMLElement,
    findings: readonly StatusMarkFinding[],
): void {
    const mark = statusMarkOf(wrap);
    if (!mark) return;
    const display = (items: readonly StatusMarkFinding[]) =>
        JSON.stringify(
            items.map(({ id, heading, report, apply }) => [
                id,
                heading,
                report.messages,
                report.errors?.map(({ constraintId }) => constraintId),
                report.warnings,
                !!apply,
                report.fixes.map(({ fix, label }) => [fix.rendered, label]),
            ]),
        );
    const changed = display(markFindings.get(mark) ?? []) !== display(findings);
    // Keep the latest engine facts and callbacks even when the words repeat.
    markFindings.set(mark, findings);
    if (!changed) return;
    applyVisualState(mark, deriveState(mark));
    refreshCorrections(mark);
}

/** The changes each mark explains, one per effect (see effectKey). */
const markFixes = new WeakMap<HTMLElement, Map<string, Change>>();

// The sheet can show a provisional reading of the marking. Keep its changes
// separate so reviewing or canceling a draft cannot alter the field's record.
const markDraftFixes = new WeakMap<HTMLElement, readonly Change[]>();

function changesInCategory(
    mark: HTMLElement,
    changes: readonly Change[],
): readonly Change[] {
    const category = markOptions.get(mark)?.correctionCategory;
    if (!category) return changes;
    return changes.flatMap((change) => {
        const add = (change.add ?? []).filter(
            (ref) => ref.categoryId === category,
        );
        const remove = (change.remove ?? []).filter(
            (ref) => ref.categoryId === category,
        );
        return add.length || remove.length ? [{ ...change, add, remove }] : [];
    });
}

function draftFixesOf(mark: HTMLElement): readonly Change[] | undefined {
    const fixes = markDraftFixes.get(mark);
    return fixes && changesInCategory(mark, fixes);
}

export function setStatusMarkDraft(
    mark: HTMLElement,
    fixes: readonly Change[] | undefined,
): void {
    if (!markOptions.has(mark) || markDraftFixes.get(mark) === fixes) return;
    if (fixes) markDraftFixes.set(mark, fixes);
    else markDraftFixes.delete(mark);
    applyVisualState(mark, deriveState(mark));

    refreshCorrections(mark);
}

function hasAttention(mark: HTMLElement, target?: string): boolean {
    return (
        panelFindings(mark, target).length > 0 ||
        (target === undefined && visibleError(mark) !== undefined)
    );
}

function panelFindings(mark: HTMLElement, target?: string) {
    const findings = visibleFindings(mark);
    return target === undefined
        ? findings
        : findings.filter(({ id }) => id === target);
}

function matchesCorrectionTarget(
    mark: HTMLElement,
    key: string,
    target?: string,
): boolean {
    if (target === undefined) return true;
    const group = markGroups.get(mark)?.get(key);
    return !!group && 'entry:' + group.id === target;
}

function correctionSnapshot(mark: HTMLElement): ReadonlySet<string> {
    const target = markToolsTarget.get(mark);
    return new Set(
        [...(markFixes.get(mark)?.keys() ?? [])].filter((key) =>
            matchesCorrectionTarget(mark, key, target),
        ),
    );
}

function refreshCorrections(mark: HTMLElement): void {
    if (!popoverOpen(mark)) return;
    const tools = markToolsContent.get(mark);
    const attention = tools?.querySelector<HTMLElement>(
        '[data-tools-panel="attention"]',
    );
    const corrections = tools?.querySelector<HTMLElement>(
        '[data-tools-panel="corrections"]',
    );
    if (!tools || !corrections) return;
    const focused = mark.ownerDocument.activeElement;
    if (hasAttention(mark) !== !!attention) {
        dismissStaleStatusMarkPopover(mark);
        attention?.replaceChildren();
        return;
    }
    if (attention?.contains(focused) || corrections.contains(focused)) {
        tools
            .querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
            ?.focus({ preventScroll: true });
    }
    attention?.replaceChildren(attentionContent(mark));
    corrections.replaceChildren(correctionsContent(mark));
    refreshStatusMarkPopover(mark);
}

function visibleError(mark: HTMLElement): string | undefined {
    return markDraftFixes.has(mark) ? undefined : markErrors.get(mark);
}

/**
 * For a mark whose field holds several markings, the marking each of its
 * changes was made to, by the change's key in {@link markFixes}.
 */
interface StatusGroupLabel {
    id: string;
    label?: string;
}

const markGroups = new WeakMap<HTMLElement, Map<string, StatusGroupLabel>>();

/**
 * The changes, by effect, that have actually been shown to the user (tooltip
 * presented, not just hovered-through). The effect is the identity: a second
 * rule making a change already shown says nothing new, and a change to another
 * concept is new whichever rule made it.
 */
const markAcknowledged = new WeakMap<HTMLElement, Set<string>>();

/**
 * The changes, by effect, that were actually behind the tooltip content the
 * last time it was built. The tooltip's own hover-intent delay means content
 * built at mouseenter can predate a mid-dwell reprocess; acknowledging must
 * credit only what this snapshot says was shown, never the live set, or a
 * change that arrived after the hover started and was never rendered gets
 * marked seen anyway.
 */
const markContentSnapshot = new WeakMap<HTMLElement, ReadonlySet<string>>();

/** A field's host-fed Favorites content inside its branding popover. */
export interface StatusMarkFavorites {
    element: HTMLElement;
    targets?: () => MarkingToolsTargets | undefined;
    /** Available saved markings and scoped scheme presets. */
    count: () => number;
    open: () => void;
    close: () => void;
    /** Its own asynchronous application still owns the dialog's completion. */
    isApplying: () => boolean;
}

const markFavorites = new WeakMap<HTMLElement, StatusMarkFavorites>();

/** The open Tools session still owned by a pending Favorite application. */
export function statusMarkFavoriteApplyOwner(
    mark: HTMLElement | null | undefined,
): HTMLElement | undefined {
    return mark && markFavorites.get(mark)?.isApplying() && popoverOpen(mark)
        ? markToolsContent.get(mark)
        : undefined;
}

/** Attach whole-marking actions to a field's existing branding entry point. */
export function setStatusMarkFavorites(
    wrap: HTMLElement,
    favorites: StatusMarkFavorites | null,
): void {
    const mark = statusMarkOf(wrap);
    if (!mark) return;
    if (favorites) markFavorites.set(mark, favorites);
    else markFavorites.delete(mark);
    applyVisualState(mark, deriveState(mark));
}

/** Reposition after asynchronous Favorites content or a tab changes size. */
export function refreshStatusMarkPopover(mark: HTMLElement): void {
    if (!popoverOpen(mark)) return;
    const tools = markToolsContent.get(mark);
    if (tools)
        updateMarkingToolsCounts(tools, markFavorites.get(mark)?.count() ?? 0);
    repositionTooltip(mark, markRoot.get(mark), popoverPlacement(mark));
    guardPopover(mark);
}

const ENHANCED_LABEL = 'Enhanced by EzClassify';

/** Adopt the mark stylesheet once per root (see adoptStylesOnce). */
function injectStyles(root: HTMLElement | undefined): void {
    adoptStylesOnce(statusMarkCss, root);
}

/**
 * Build the inline brand glyph around its bracket bounds. Its decorative
 * sparkle overhangs the slot and shares the color and status treatment of the
 * brackets and bars.
 */
function buildMarkSvg(): string {
    return (
        '<svg viewBox="11 11 42 42" aria-hidden="true" focusable="false">' +
        '<path d="M20 14 H14 V50 H20" stroke="currentColor" stroke-width="6" fill="none" stroke-linecap="square" stroke-linejoin="miter"/>' +
        '<path d="M44 14 H50 V50 H44" stroke="currentColor" stroke-width="6" fill="none" stroke-linecap="square" stroke-linejoin="miter"/>' +
        '<rect x="23" y="22" width="18" height="4" fill="currentColor"/>' +
        '<rect x="23" y="30" width="18" height="4" fill="currentColor"/>' +
        '<rect x="23" y="38" width="18" height="4" fill="currentColor"/>' +
        '<g transform="translate(59.5 4.5) scale(1.25)"><path class="ez-status-mark__sparkle" d="M0 -9 L1.8 -1.8 L9 0 L1.8 1.8 L0 9 L-1.8 1.8 L-9 0 L-1.8 -1.8 Z" fill="currentColor"/></g>' +
        '</svg>'
    );
}

/** Derive the mark's current state from its fixes and acknowledgment set. */
function deriveState(mark: HTMLElement): MarkState {
    const draft = draftFixesOf(mark);
    if (draft) return draft.length ? 'unseen' : 'quiet';
    if (markErrors.has(mark) || findingError(mark) !== undefined)
        return 'error';
    const fixes = markFixes.get(mark);
    if (!fixes || fixes.size === 0) return 'quiet';
    const acknowledged = markAcknowledged.get(mark);
    const allSeen =
        !!acknowledged &&
        [...fixes.keys()].every((key) => acknowledged.has(key));
    return allSeen ? 'seen' : 'unseen';
}

/** Apply the visual/a11y consequences of a state to the mark element. */
function applyVisualState(mark: HTMLElement, state: MarkState): void {
    // `--quiet` has no CSS rule of its own today (quiet is just the base
    // `.ez-status-mark` look, opacity 0.75 and a muted color); it's kept as
    // an explicit state marker on the element so a consumer overriding this
    // stylesheet, or a test, has something to select without inferring
    // "quiet" from the absence of the other two classes.
    mark.classList.toggle('ez-status-mark--quiet', state === 'quiet');
    mark.classList.toggle('ez-status-mark--unseen', state === 'unseen');
    mark.classList.toggle('ez-status-mark--seen', state === 'seen');
    mark.classList.toggle('ez-status-mark--error', state === 'error');

    if (markOptions.get(mark)?.tools) {
        mark.title = t(
            markFavorites.has(mark)
                ? 'tools.openHint'
                : 'tools.correctionsHint',
        ).replace(
            '{shortcut}',
            `${isMacPlatform() ? 'Cmd' : 'Ctrl'}+Shift+Enter`,
        );
    }
    const active = state !== 'quiet' || markOptions.get(mark)?.tools === true;
    // Without field tools, quiet is decorative; an active mark carries an explanation, so it
    // becomes keyboard-reachable (focus previews the list) and reads as the
    // button that discloses it. A disclosure button's expanded state is what
    // its press controls, so a hover or focus preview leaves it collapsed and
    // the first Enter reads as expanding it.
    mark.tabIndex = active ? 0 : -1;
    if (active) {
        mark.setAttribute('aria-expanded', String(markPinned.has(mark)));
    } else {
        mark.removeAttribute('aria-expanded');
        mark.removeAttribute('aria-controls');
    }

    const count = linesOf(mark).length;
    const unseen = linesOf(mark, true).length;
    const errors =
        Number(visibleError(mark) !== undefined) +
        visibleFindings(mark).reduce(
            (sum, { report }) => sum + report.messages.length,
            0,
        );
    // Unresolved errors remain counted until the next successful judgment.
    const badge = errors + unseen;
    const countEl = mark.querySelector<HTMLElement>('.ez-status-mark__count');
    if (countEl) countEl.textContent = badge ? String(badge) : '';
    const review =
        unseen && !markDraftFixes.has(mark) ? t('mark.notReviewed') : '';
    const fixed = count > 0 ? ` ${changesLabel(count)}${review}.` : '';
    const error = visibleError(mark) ?? findingError(mark);
    const errorCount =
        errors > 1
            ? ` ${t('tools.errorCount').replace('{count}', String(errors))}.`
            : '';
    mark.setAttribute(
        'aria-label',
        error !== undefined
            ? `${ENHANCED_LABEL}. ${error}${errorCount}${fixed}`
            : active
              ? `${ENHANCED_LABEL}.${fixed}`
              : ENHANCED_LABEL,
    );
}

/** "3 changes made by marking rules". */
function changesLabel(count: number): string {
    return count === 1
        ? t('mark.changesOne')
        : fill(t('mark.changesMany'), { count: String(count) });
}

/** The options each mark was mounted with. */
const markOptions = new WeakMap<HTMLElement, StatusMarkOptions>();

/**
 * The lines the mark's list shows, each once, with the rule that made it: two
 * changes that read the same are one line.
 */
function linesOf(
    mark: HTMLElement,
    unseenOnly = false,
    target?: string,
): { text: string; rule: string; group?: StatusGroupLabel }[] {
    const words = markOptions.get(mark)?.words;
    const groups = markGroups.get(mark);
    const seen = new Set<string>();
    const lines: { text: string; rule: string; group?: StatusGroupLabel }[] =
        [];
    const draft = draftFixesOf(mark);
    const fixes = draft?.map((change) => [effectKey(change), change] as const);
    for (const [key, change] of fixes ?? markFixes.get(mark) ?? []) {
        if (!matchesCorrectionTarget(mark, key, target)) continue;
        if (unseenOnly && !draft && markAcknowledged.get(mark)?.has(key))
            continue;
        const group = draft ? undefined : groups?.get(key);
        for (const text of changeLines(change, words)) {
            const once = `${group?.id ?? ''}\u0000${text}`;
            if (seen.has(once)) continue;
            seen.add(once);
            lines.push({ text, rule: change.ruleId, group });
        }
    }
    return lines;
}

/** The tooltip root each mark shows its applied-changes popover in. */
const markRoot = new WeakMap<HTMLElement, HTMLElement | undefined>();
/** Marks whose popover the user pressed open, as opposed to hovered. */
const markPinned = new WeakSet<HTMLElement>();
/** Removes the listeners that dismiss a mark's open popover. */
const markDismissers = new WeakMap<HTMLElement, () => void>();
/** Retain outgoing chrome ownership until its focusout has settled. */
const markToolsContent = new WeakMap<HTMLElement, HTMLElement>();
/** The selected paragraph in the currently displayed tools. */
const markToolsTarget = new WeakMap<HTMLElement, string>();

/** Whether focus belongs to a marking's branding button or tools dialog. */
export function statusMarkOwnsNode(
    mark: HTMLElement | null | undefined,
    node: Node,
): boolean {
    const popupId = mark?.getAttribute('aria-describedby');
    return !!(
        mark?.contains(node) ||
        (mark && markToolsContent.get(mark)?.contains(node)) ||
        (popupId && document.getElementById(popupId)?.contains(node))
    );
}

/** The field a mark belongs to: the library wrapper around it. */
function fieldOf(mark: HTMLElement): HTMLElement {
    // The suite frame (field-chrome.ts) is the box every control draws, the
    // pickers and DecisionFlow included; the text fields' wraps hold theirs.
    return (
        mark.closest<HTMLElement>(
            '.ez-field-frame, .marking-field-wrap, .marked-input-wrap, .marked-textarea-wrap, .tag-input-wrap',
        ) ??
        mark.parentElement ??
        mark
    );
}

/** The field's visible error lists: inside it, or right after it. */
function errorListsOf(field: HTMLElement): HTMLElement[] {
    return [
        ...(field.parentElement?.querySelectorAll<HTMLElement>(
            '.ez-validation-errors',
        ) ?? []),
    ].filter(
        (list) =>
            !list.hidden &&
            (field.contains(list) || list.previousElementSibling === field),
    );
}

/** Interactive tools anchor to the field's current editing or painted box. */
function popoverPlacement(mark: HTMLElement): TooltipPlacement {
    const field = fieldOf(mark);
    const tools = markOptions.get(mark)?.tools;
    const surface = tools
        ? ([
              ...field.querySelectorAll<HTMLElement>(
                  ':scope > .marked-input-display, :scope > .marked-textarea-display, :scope > .marking-field-display, :scope > .marking-field-host',
              ),
          ].find((layer) => layer.getClientRects().length > 0) ?? field)
        : field;
    return {
        clearOf: tools ? surface : [field, ...errorListsOf(field)],
        preferNearTarget: field.classList.contains('marked-textarea-wrap'),
        followViewport: mark.closest('.ez-composer__sheet-tools') !== null,
    };
}

/**
 * Close the mark's applied-changes popover if it is the one showing. The
 * popover describes the field's value when it opened; once that value changes
 * or the user moves on it is stale, and on a touch screen nothing else ever
 * closes it.
 */
export function dismissStatusMarkPopover(mark: HTMLElement): void {
    collapse(mark);
    const tipId = mark.getAttribute('aria-describedby');
    if (!tipId) return;
    const tip = document.getElementById(tipId);
    if (tip?.classList.contains('ez-tooltip')) hideTooltip(markRoot.get(mark));
}

function dismissStaleStatusMarkPopover(mark: HTMLElement): void {
    const focused = mark.ownerDocument.activeElement;
    const returnFocus =
        popoverOpen(mark) && markToolsContent.get(mark)?.contains(focused);
    dismissStatusMarkPopover(mark);
    if (returnFocus) mark.focus({ preventScroll: true });
}

/**
 * The list the mark's press opened is no longer open: the tooltip hid (a second
 * press, Escape, a blur, a scroll) or another target took it. The mark is no
 * longer pinned, so a later hover preview closes on leave, and it reads
 * collapsed.
 */
function collapse(mark: HTMLElement): void {
    markToolsTarget.delete(mark);
    markFavorites.get(mark)?.close();
    markPinned.delete(mark);
    markDismissers.get(mark)?.();
    markDismissers.delete(mark);
    if (mark.hasAttribute('aria-expanded')) {
        mark.setAttribute('aria-expanded', 'false');
    }
    mark.removeAttribute('aria-controls');
}

/** The mark's press opened its list: it reads expanded and names the list. */
function expand(mark: HTMLElement): void {
    markPinned.add(mark);
    mark.setAttribute('aria-expanded', 'true');
    const tipId = mark.getAttribute('aria-describedby');
    if (tipId) mark.setAttribute('aria-controls', tipId);
}

/** Whether `mark`'s applied-changes popover is the one showing. */
function popoverOpen(mark: HTMLElement): boolean {
    const tipId = mark.getAttribute('aria-describedby');
    const tip = tipId ? document.getElementById(tipId) : null;
    return !!tip && !tip.hidden && tip.classList.contains('ez-tooltip');
}

/**
 * The popover just opened on `mark`, placed clear of the field and its error
 * list (see popoverPlacement). A passive explanation closes when no space
 * clears them; explicit tools retain their reachable viewport fallback. It
 * closes when focus or a press goes outside its focus domain. Tools own their
 * button and dialog; returning to the field leaves that domain and resumes
 * editing.
 */
function guardPopover(mark: HTMLElement): void {
    const tipId = mark.getAttribute('aria-describedby');
    const tip = tipId ? document.getElementById(tipId) : null;
    if (!tip) return;
    const field = fieldOf(mark);
    const a = tip.getBoundingClientRect();
    // Passive explanations must stay clear of the field and its errors.
    // Explicit tools use the viewport fallback when a tall control leaves
    // no exterior space; returning to that control closes the dialog.
    if (!markOptions.get(mark)?.tools) {
        for (const list of [field, ...errorListsOf(field)]) {
            const b = list.getBoundingClientRect();
            const overlaps =
                a.left < b.right &&
                b.left < a.right &&
                a.top < b.bottom &&
                b.top < a.bottom;
            if (overlaps) {
                dismissStatusMarkPopover(mark);
                return;
            }
        }
    }
    markDismissers.get(mark)?.();
    const outside = (event: Event) => {
        const target = event.target as Node | null;
        const owner = markOptions.get(mark)?.tools ? mark : field;
        if (target && (owner.contains(target) || tip.contains(target))) return;
        dismissStatusMarkPopover(mark);
    };
    const doc = mark.ownerDocument;
    doc.addEventListener('focusin', outside, true);
    doc.addEventListener('pointerdown', outside, true);
    markDismissers.set(mark, () => {
        doc.removeEventListener('focusin', outside, true);
        doc.removeEventListener('pointerdown', outside, true);
    });
}

/**
 * Record that the fixes captured in the mark's content snapshot have been shown
 * to the user (the tooltip actually presented past its hover-intent delay, or
 * focus). Deliberately acknowledges the snapshot, not the live fix set: a
 * reprocess mid-dwell can add a fix after the tooltip content was already
 * built, and that fix was never rendered, so it must stay unseen regardless of
 * what's in `markFixes` by the time this fires. Marking acknowledgment only
 * means something while fixes exist; a quiet mark has nothing to acknowledge.
 */
function acknowledgeMark(mark: HTMLElement): void {
    if (markDraftFixes.has(mark)) return;
    const fixes = markFixes.get(mark);
    if (!fixes || fixes.size === 0) return;
    const shown = markContentSnapshot.get(mark);
    let acknowledged = markAcknowledged.get(mark);
    if (!acknowledged) {
        acknowledged = new Set();
        markAcknowledged.set(mark, acknowledged);
    }
    for (const key of shown ?? fixes.keys()) {
        if (fixes.has(key)) acknowledged.add(key);
    }
    applyVisualState(mark, deriveState(mark));
}

/**
 * Mount the field's single status mark inside `wrap` (a positioned wrapper
 * element), or return the one already there. Idempotent: calling it after a
 * render pass that wiped the wrap recreates the mark; calling it when the mark
 * exists returns it unchanged, so a field can never accumulate a stack of
 * indicators.
 *
 * @param wrap - Positioned wrapper the mark anchors to (one mark per wrap)
 * @param opts - Shape, style/tooltip root, and tooltip guard
 * @returns The mark element
 */
export function ensureStatusMark(
    wrap: HTMLElement,
    opts: StatusMarkOptions,
): HTMLElement {
    const existing = statusMarkOf(wrap);
    if (existing) return existing;

    injectStyles(opts.root);
    if (opts.tools) adoptStylesOnce(statusMarkCss, document.body);

    const mark = document.createElement('button');
    mark.type = 'button';
    mark.className = `ez-status-mark ez-status-mark--${opts.shape} ez-status-mark--quiet`;
    mark.tabIndex = -1;
    mark.setAttribute('aria-label', ENHANCED_LABEL);
    mark.innerHTML = buildMarkSvg();
    // The count leads the icon. The mark sits at the trailing end of its
    // row, so the icon stays where it is when the count goes away on the
    // first look at the list, rather than sliding out from under the pointer.
    const count = document.createElement('span');
    count.className = 'ez-status-mark__count';
    count.setAttribute('aria-hidden', 'true');
    mark.prepend(count);
    markFixes.set(mark, new Map());
    markAcknowledged.set(mark, new Set());
    markOptions.set(mark, opts);

    if (opts.tools) {
        mark.classList.add('ez-status-mark--tools');
        mark.setAttribute('aria-haspopup', 'dialog');
        mark.setAttribute(
            'aria-keyshortcuts',
            'Control+Shift+Enter Meta+Shift+Enter',
        );
        applyVisualState(mark, 'quiet');
    }

    const content = (): Node | string | undefined => {
        const error = visibleError(mark);
        const fixes = markFixes.get(mark);
        if (opts.tools) {
            const favorites = markFavorites.get(mark);
            const targets = favorites?.targets?.();
            if (targets) markToolsTarget.set(mark, targets.selected);
            else markToolsTarget.delete(mark);
            const target = markToolsTarget.get(mark);
            const attention = hasAttention(mark)
                ? attentionContent(mark)
                : undefined;
            const showCorrections =
                markDraftFixes.has(mark) ||
                linesOf(mark, true, target).length > 0;
            const preferAttention =
                (target === undefined && error !== undefined) ||
                panelFindings(mark, target).some(
                    ({ report }) => report.messages.length > 0,
                ) ||
                (!showCorrections && hasAttention(mark, target));
            const acknowledgeCorrections = () => {
                markContentSnapshot.set(mark, correctionSnapshot(mark));
                acknowledgeMark(mark);
            };
            markContentSnapshot.set(
                mark,
                !preferAttention && (showCorrections || !favorites)
                    ? correctionSnapshot(mark)
                    : new Set(),
            );
            const tools = buildMarkingTools({
                attention,
                preferAttention,
                fieldNotice: target === undefined ? undefined : error,
                targets: targets && {
                    ...targets,
                    select: (value) => {
                        if (favorites?.isApplying()) return;
                        markToolsTarget.set(mark, value);
                        targets.select(value);
                        refreshCorrections(mark);
                        if (
                            tools.querySelector(
                                '[data-tools-tab="corrections"][aria-selected="true"]',
                            )
                        )
                            acknowledgeCorrections();
                    },
                },
                corrections: correctionsContent(mark),
                favorites: favorites?.element,
                favoritesCount: favorites?.count() ?? 0,
                showCorrections,
                onCorrectionsViewed: acknowledgeCorrections,
                onResize: () => refreshStatusMarkPopover(mark),
                onClose: () => {
                    dismissStatusMarkPopover(mark);
                    mark.focus();
                },
                onExit: (backward) => {
                    dismissStatusMarkPopover(mark);
                    const clear = mark
                        .closest('.ez-field-chrome')
                        ?.querySelector<HTMLButtonElement>('.ez-clear-button');
                    if (backward || !clear || clear.disabled) mark.focus();
                    else clear.focus();
                },
            });
            markToolsContent.set(mark, tools);
            return tools;
        }
        // The opt-out hides the fix explanation, never the error.
        if (!fixes || fixes.size === 0 || !explainsFixes()) return error;
        // Snapshot exactly which fixes are behind this content build so
        // acknowledgeMark can credit only what actually got shown, not
        // whatever the fix set grows to before the tooltip fires.
        markContentSnapshot.set(mark, new Set(fixes.keys()));
        return changeList(mark, error, opts.undoLastEdit?.() ?? null);
    };
    const explainsFixes = () => opts.shouldShowTooltip?.() ?? true;
    // The error is not an optional helper: the tooltip opt-out hides the fix
    // explanation, never the reason the field is invalid.
    const mayShow = () =>
        opts.tools === true ||
        markErrors.has(mark) ||
        (explainsFixes() && (markFixes.get(mark)?.size ?? 0) > 0);
    const shown = () => {
        acknowledgeMark(mark);
        if (opts.tools) markFavorites.get(mark)?.open();
        if (opts.tools) {
            const id = mark.getAttribute('aria-describedby');
            const tip = id ? document.getElementById(id) : null;
            tip?.setAttribute('role', 'dialog');
            tip?.setAttribute('aria-label', t('tools.sections'));
            // Opening Favorites can insert its loading row synchronously.
            // Position that content before deciding whether it clears the field.
            refreshStatusMarkPopover(mark);
        } else guardPopover(mark);
    };

    // Keep the pointer press from blurring the field before its tools can
    // suspend the composer and move focus into the selected tab.
    mark.addEventListener('mousedown', (e) => e.preventDefault());
    // A press (tap, click, Enter, Space) opens the list, or closes the one
    // it opened. It must not submit a form or reach the field's own click
    // handling (focus-the-filter, open the editor).
    mark.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (markPinned.has(mark) && popoverOpen(mark)) {
            dismissStatusMarkPopover(mark);
            if (opts.tools) mark.focus();
            return;
        }
        // The sheet owns the editing focus and can keep its draft open
        // while its borrowed tools button presents the dialog.
        if (opts.tools && !mark.closest('.ez-composer__sheet-tools'))
            opts.onToolsOpen?.();
        const text = opts.tools || mayShow() ? content() : undefined;
        if (!text) return;
        showTooltip(
            mark,
            text,
            opts.root,
            {
                ...popoverPlacement(mark),
                pointerOpening: opts.tools && e.detail > 0,
            },
            () => collapse(mark),
        );
        expand(mark);
        shown();
        if (opts.tools && popoverOpen(mark)) focusMarkingTools(mark);
    });
    mark.addEventListener('keydown', (e) => {
        if (
            e.key === 'ArrowDown' &&
            opts.tools &&
            !e.altKey &&
            !e.ctrlKey &&
            !e.metaKey &&
            !e.shiftKey &&
            !e.isComposing &&
            e.keyCode !== 229
        ) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        // The list the press opened sits outside the field, so Tab takes the
        // keyboard into it when it holds the undo.
        if (e.key === 'Tab' && !e.shiftKey && popoverOpen(mark)) {
            const tipId = mark.getAttribute('aria-describedby');
            const undo = tipId
                ? document
                      .getElementById(tipId)
                      ?.querySelector<HTMLElement>(
                          '[role=tab][aria-selected=true], .ez-status-list__undo',
                      )
                : null;
            if (undo) {
                e.preventDefault();
                undo.focus();
            }
            return;
        }
        if (e.key !== 'Escape' || !popoverOpen(mark)) return;
        // Closing the list is all Escape does here: the field must not also
        // take it as a cancel.
        e.preventDefault();
        e.stopPropagation();
        dismissStatusMarkPopover(mark);
    });

    attachTooltip(
        mark,
        content,
        opts.root,
        // A dialog opens by an explicit press, so hovering while typing
        // cannot put a second interactive surface behind the composer.
        () => !opts.tools && mayShow(),
        // Acknowledgment happens when the tooltip actually presents, not on a
        // pointer merely passing through; attachTooltip's own hover-intent
        // delay already filters that out before this fires.
        shown,
        undefined,
        () => popoverPlacement(mark),
        () => markPinned.has(mark) && popoverOpen(mark),
    );
    markRoot.set(mark, opts.root);

    wrap.appendChild(mark);
    statusMarks.set(wrap, mark);
    if (opts.tools)
        bindMarkingToolsShortcut(opts.keyboardRoot ?? fieldOf(mark));
    return mark;
}

/**
 * Update the wrap's status mark to reflect the changes EzClassify made to the
 * field's current value. An empty set returns the mark to quiet and forgets
 * what was previously shown, so a later change starts unseen again. A set that
 * includes any change not yet shown to the user (re)arms unseen; if every
 * current change has already been shown, the mark reads seen.
 *
 * Each change to the marking appears once, however many readings or rules made
 * it: two rules that add the same concept are one line, in the words of the
 * first change listed. A field passes what {@link explainedChanges} gives for
 * its applied fixes and what it holds, so the facts a rule filled in are
 * explained too. Proposed fixes must never be passed.
 *
 * @param wrap - The wrapper the mark was mounted on via {@link ensureStatusMark}
 * @param fixes - The changes behind the field's current value
 */
export function setStatusMarkFixes(
    wrap: HTMLElement,
    fixes: readonly Change[],
): void {
    setMarkChanges(wrap, [{ changes: fixes }]);
}

/** The changes made to one of the markings a field holds. */
export interface StatusMarkGroup {
    entryId: string;
    /** The marking as the field now writes it in its text. */
    marking: string;
    /** What {@link explainedChanges} gives for that marking. */
    changes: readonly Change[];
}

/**
 * {@link setStatusMarkFixes} for a field that holds several markings, such as a
 * MarkedTextArea: the mark is still the field's one mark and counts every
 * change, and its list puts each marking's changes under a small heading that
 * names the marking, in the order given. A marking with no changes gets no
 * heading, and a list with changes to one marking only needs none.
 *
 * @param wrap - The wrapper the mark was mounted on via {@link ensureStatusMark}
 * @param groups - Each marking with its changes, in the order of the text
 */
export function setStatusMarkGroups(
    wrap: HTMLElement,
    groups: readonly StatusMarkGroup[],
): void {
    const changed = groups.filter((group) => group.changes.length > 0);
    setMarkChanges(
        wrap,
        changed.map(({ entryId, marking, changes }) => ({
            group: {
                id: entryId,
                label: changed.length > 1 ? marking : undefined,
            },
            changes,
        })),
    );
}

function setMarkChanges(
    wrap: HTMLElement,
    groups: readonly { group?: StatusGroupLabel; changes: readonly Change[] }[],
): void {
    const mark = statusMarkOf(wrap);
    if (!mark) return;
    // An ordinary value change invalidates its explanation. A Favorite's
    // own projection must let that application perform its normal handoff.
    if (!statusMarkFavoriteApplyOwner(mark))
        dismissStaleStatusMarkPopover(mark);

    // A change is known by what it did, within its marking: the same change
    // made to two markings is two changes.
    const changes = new Map<string, Change>();
    const labels = new Map<string, StatusGroupLabel>();
    for (const { group, changes: list } of groups) {
        for (const change of changesInCategory(mark, list)) {
            const effect = effectKey(change);
            const key =
                group === undefined
                    ? effect
                    : JSON.stringify(['marking', group.id, effect]);
            if (changes.has(key)) continue;
            changes.set(key, change);
            if (group) labels.set(key, group);
        }
    }
    markFixes.set(mark, changes);
    markGroups.set(mark, labels);
    // Prune acknowledgment for any change that is no longer shown, not only
    // when the set goes fully empty, so a change that drops out and comes
    // back later is unseen again. This also covers the clean-reprocess case
    // (every change drops out, so acknowledged empties).
    const acknowledged = markAcknowledged.get(mark);
    if (acknowledged) {
        for (const key of acknowledged) {
            if (!changes.has(key)) acknowledged.delete(key);
        }
    }

    applyVisualState(mark, deriveState(mark));
}

function attentionContent(mark: HTMLElement): HTMLElement {
    const target = markToolsTarget.get(mark);
    const findings = panelFindings(mark, target);
    const content = mark.ownerDocument.createElement('div');
    findings.forEach((finding, index) => {
        if (finding.heading && target === undefined) {
            const label = mark.ownerDocument.createElement('div');
            label.className = 'ez-status-list__marking';
            label.textContent = finding.heading;
            content.appendChild(label);
        }
        const list = new RuleErrorList(mark.ownerDocument, undefined, {
            remediesOnly: true,
            fixesHeading: t('tools.quickFixes'),
            showRuleNames: true,
        });
        list.element.removeAttribute('aria-live');
        list.update(
            finding.report,
            finding.apply
                ? (fix, pointerType) => {
                      if (
                          mark.matches(':disabled') ||
                          !popoverOpen(mark) ||
                          !markToolsContent.get(mark)?.contains(list.element)
                      )
                          return;
                      const current = panelFindings(
                          mark,
                          markToolsTarget.get(mark),
                      )[index];
                      const live = current?.report.fixes.find(
                          (item) => item.fix.rendered === fix.rendered,
                      );
                      if (!current?.apply || current.id !== finding.id || !live)
                          return;
                      dismissStatusMarkPopover(mark);
                      mark.focus({ preventScroll: true });
                      list.element.remove();
                      current.apply(live.fix, pointerType);
                  }
                : null,
        );
        content.appendChild(list.element);
    });
    const error = target === undefined ? visibleError(mark) : undefined;
    if (error !== undefined) {
        const reason = mark.ownerDocument.createElement('div');
        reason.className = 'ez-status-list__error';
        reason.textContent = error;
        content.prepend(reason);
    }
    if (!content.hasChildNodes())
        content.textContent = t('tools.emptyAttention');
    return content;
}

function correctionsContent(mark: HTMLElement): HTMLElement {
    const opts = markOptions.get(mark);
    const draft = draftFixesOf(mark);
    const target = markToolsTarget.get(mark);
    const count =
        (target === undefined ? draft?.length : undefined) ??
        correctionSnapshot(mark).size;
    if (count > 0)
        return changeList(
            mark,
            undefined,
            draft || target !== undefined
                ? null
                : (opts?.undoLastEdit?.() ?? null),
            target,
        );
    const empty = mark.ownerDocument.createElement('div');
    empty.textContent = t('tools.emptyCorrections');
    return empty;
}

/**
 * The list the mark opens: what is wrong with the field, if anything, then a
 * heading with the number of changes, each change with the rule that made it
 * under it, and the undo of the author's last edit while there is one.
 */
function changeList(
    mark: HTMLElement,
    error: string | undefined,
    undo: (() => void) | null,
    target?: string,
): HTMLElement {
    const list = document.createElement('div');
    list.className = 'ez-status-list';
    if (error !== undefined) {
        const reason = document.createElement('div');
        reason.className = 'ez-status-list__error';
        reason.textContent = error;
        list.appendChild(reason);
    }
    const lines = linesOf(mark, false, target);
    const heading = document.createElement('div');
    heading.className = 'ez-tooltip__header';
    heading.textContent = changesLabel(lines.length);
    list.appendChild(heading);
    let items: HTMLUListElement | null = null;
    let group: StatusGroupLabel | undefined;
    for (const line of lines) {
        // A field of several markings lists each marking's changes under the
        // marking, as its text now writes it.
        if (!items || line.group?.id !== group?.id) {
            group = line.group;
            if (target === undefined && group?.label !== undefined) {
                const name = document.createElement('div');
                name.className = 'ez-status-list__marking';
                name.textContent = group.label;
                list.appendChild(name);
            }
            items = document.createElement('ul');
            items.className = 'ez-status-list__changes';
            list.appendChild(items);
        }
        const item = document.createElement('li');
        item.className = 'ez-status-list__change';
        const text = document.createElement('div');
        text.className = 'ez-status-list__text';
        text.textContent = line.text;
        item.appendChild(text);
        const rule = ruleAttribution(mark.ownerDocument, line.rule);
        if (rule) item.appendChild(rule);
        items.appendChild(item);
    }
    if (undo) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ez-status-list__undo';
        button.textContent = t('mark.undoLastEdit');
        const description = document.createElement('div');
        description.className = 'ez-status-list__undo-description';
        description.id = `ez-undo-${Math.random().toString(36).slice(2, 10)}`;
        description.textContent = t('mark.undoLastEditDescription');
        button.setAttribute('aria-describedby', description.id);
        // A press here must not blur the field and commit its draft.
        button.addEventListener('mousedown', (e) => e.preventDefault());
        button.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dismissStatusMarkPopover(mark);
            undo();
        });
        list.append(button, description);
    }
    return list;
}

/**
 * Set or clear the error the wrap's status mark reports. While one is set the
 * mark reads as an error, whatever fixes it also explains, and its popover and
 * accessible label lead with the message. Clearing it returns the mark to the
 * state its fixes give it.
 *
 * Use it for a fact about the whole field that no marking chip can carry, such
 * as text the field could not check. A rule error belongs to the marking it
 * breaks, never here.
 *
 * @param wrap - The wrapper the mark was mounted on via {@link ensureStatusMark}
 * @param message - What is wrong, or `null` to clear it
 */
export function setStatusMarkError(
    wrap: HTMLElement,
    message: string | null,
): void {
    const mark = statusMarkOf(wrap);
    if (!mark) return;
    if ((markErrors.get(mark) ?? null) === message) return;
    // The popover describes the error it opened with, except while its own
    // Favorite application is completing the associated value.
    if (!statusMarkFavoriteApplyOwner(mark))
        dismissStaleStatusMarkPopover(mark);
    if (message === null) markErrors.delete(mark);
    else markErrors.set(mark, message);
    applyVisualState(mark, deriveState(mark));
}
