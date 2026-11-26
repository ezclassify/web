/**
 * The rule-error surface every form field shares: the errors the engine
 * reports, under the field, then the ways to fix the marking as one list of
 * one-click buttons.
 *
 * The engine owns remedies. It reports a failure as a `ValidationError` and
 * each way to make the whole marking valid as a `Fix` in `proposedFixes`: the
 * marking that results, which of the author's concepts it keeps, what it adds
 * and what it removes, and a message that says so. A fix answers every error on
 * the list, so the errors and the fixes are two lists, and two fixes that end
 * in the same marking are offered once. The button reads the fix's own message;
 * pressing it states the kept and added concepts as the author's marking, in
 * one write. This module never works out a remedy of its own, so a field shows
 * a button exactly when the engine proposed one.
 *
 * The engine's warnings for the value follow the errors. A warning is something
 * the author should know that does not make the marking wrong, such as a part
 * that could not be compared with its whole, so it reads in the warning color,
 * never counts as an error and never offers a fix.
 *
 * Errors sit directly under the field and start at its left edge. A form field
 * is where a marking is judged; read-only surfaces such as the status banner do
 * not carry this list.
 */
import type {
    Assertion,
    Fix,
    ValidationError,
    Warning,
} from '@ezclassify/types';
import { t } from '../i18n';
import { adoptStylesOnce } from '../styles/adopt';
import ruleErrorsCss from './rule-errors.css?inline';

/** One fix the user can apply, with the words its button carries. */
export interface RuleErrorFix {
    readonly fix: Fix;
    readonly label: string;
}

/**
 * What a field shows for its value: the engine errors, the warnings, then the
 * fix paths.
 */
export interface RuleErrorReport {
    /** One message per engine error, in the engine's order. */
    readonly messages: readonly string[];
    /** Adapter errors, with rule identifiers for the details view. */
    readonly errors?: readonly ValidationError[];
    /** Each distinct way to a valid marking. */
    readonly fixes: readonly RuleErrorFix[];
    /** One message per engine warning, in the engine's order. */
    readonly warnings: readonly string[];
}

/** A report with nothing in it, for a value that breaks no rule. */
export const NO_RULE_ERRORS: RuleErrorReport = {
    messages: [],
    fixes: [],
    warnings: [],
};

/**
 * The library-owned wrappers a field paints inside. An error placed after the
 * wrapper follows the visible field wherever the host page puts it, which a
 * sibling of the (possibly empty) mount container does not.
 */
const FIELD_WRAPPERS =
    '.marking-field-wrap, .marked-input-wrap, .marked-textarea-wrap';

/**
 * A fix's button text: its message as an action, without the sentence's closing
 * period.
 */
export function fixButtonLabel(fix: Fix): string {
    return fix.message.trim().replace(/\.$/, '');
}

/**
 * The field's report: the engine errors, the warnings, then the ways to fix the
 * marking, each resulting marking once.
 *
 * @param errors - `ProcessResult.errors` for the field's current value
 * @param proposedFixes - `ProcessResult.proposedFixes` from the same result
 * @param warnings - `ProcessResult.warnings` from the same result
 * @returns The messages, warnings and fixes, all in the engine's order
 */
export function ruleErrorsFrom(
    errors: readonly ValidationError[],
    proposedFixes: readonly Fix[],
    warnings: readonly Warning[] = [],
): RuleErrorReport {
    const warned = [...new Set(warnings.map((warning) => warning.message))];
    if (errors.length === 0 && warned.length === 0) return NO_RULE_ERRORS;
    // Fixes answer errors; with none listed there is nothing to fix.
    const seen = new Set<string>();
    const fixes: RuleErrorFix[] = [];
    for (const fix of errors.length > 0 ? proposedFixes : []) {
        if (seen.has(fix.rendered)) continue;
        seen.add(fix.rendered);
        fixes.push({ fix, label: fixButtonLabel(fix) });
    }
    return {
        messages: errors.map((error) => error.message),
        ...(errors.length ? { errors } : {}),
        fixes,
        warnings: warned,
    };
}

/**
 * The report for a value the field could not read at all: the runtime (or the
 * connection to it) failed instead of answering. The field still mounts and
 * shows what it typed; this puts the one failed-check wording where its errors
 * go. The client's own error string is never shown.
 */
export function readFailureReport(): RuleErrorReport {
    return { messages: [t('composer.unverified')], fixes: [], warnings: [] };
}

/**
 * The author's marking once a fix is applied: the concepts it keeps and the
 * ones it adds, stated by the author. The caller stores them in one write and
 * lets the engine work out everything it derives from them. Repeated kept
 * references expand once, retaining every matching current value.
 *
 * @param fix - The fix the user pressed
 * @param current - The facts the proposed remedy was offered for; kept capture
 *   values stay intact
 * @returns A new assertion set
 */
export function fixAssertions(
    fix: Fix,
    current: readonly Assertion[],
): Assertion[] {
    const stated = (ref: Fix['keeps'][number], value?: string): Assertion => ({
        conceptId: ref.conceptId,
        categoryId: ref.categoryId,
        ...(value !== undefined ? { value } : {}),
        confidence: 'certain',
        source: 'user',
    });
    const expanded = new Set<string>();
    return [
        ...fix.keeps.flatMap((ref) => {
            const key = JSON.stringify([ref.categoryId, ref.conceptId]);
            if (expanded.has(key)) return [];
            expanded.add(key);
            const kept = current.filter(
                (assertion) =>
                    assertion.conceptId === ref.conceptId &&
                    assertion.categoryId === ref.categoryId,
            );
            return kept.length > 0
                ? kept.map((assertion) => stated(ref, assertion.value))
                : [stated(ref)];
        }),
        ...fix.adds.map((ref) => stated(ref)),
    ];
}

/** The field's inline chrome follows its keyboard hint and its findings. */
const FIELD_CHROME = ':scope > .ez-field-chrome';

/**
 * Put the error list directly under the field the user sees. Inside the marked
 * text it shares the footer with the keyboard hint. In other owned wrappers it
 * goes before the field's chrome. Without a wrapper, or a wrapper with no
 * chrome, it follows the wrapper (or the mount container that holds the field).
 * TagInput keeps it inside its owned mount, after the chip editor and its
 * chrome.
 */
export function placeUnderField(
    list: HTMLElement,
    host: Element | null,
    mount: Element,
): void {
    // TagInput owns the chip editor in its mount. Keep its findings in that
    // same region, after the editor, without including the host form's label.
    if (mount.getAttribute('data-ezclassify-mount') === 'tags') {
        if (mount.lastElementChild !== list) mount.appendChild(list);
        return;
    }
    const wrapper = host?.closest(FIELD_WRAPPERS) ?? null;
    const footer = wrapper?.querySelector(':scope > .ez-marked-field-footer');
    if (footer) {
        if (footer.firstElementChild !== list) footer.prepend(list);
        return;
    }
    const chrome = wrapper?.querySelector(FIELD_CHROME) ?? null;
    if (wrapper && chrome) {
        if (chrome.previousElementSibling === list) return;
        wrapper.insertBefore(list, chrome);
        return;
    }
    const anchor = wrapper ?? mount;
    if (anchor.nextElementSibling === list) return;
    anchor.insertAdjacentElement('afterend', list);
}

let nextHeadingId = 0;

/**
 * Render a scheme rule identifier. Internal adapter errors have no rule to look
 * up.
 */
export function ruleAttribution(
    doc: Document,
    rule: string | undefined,
): HTMLElement | null {
    if (!rule || rule.startsWith('_')) return null;
    const name = doc.createElement('div');
    name.className = 'ez-status-list__rule';
    name.textContent = t('mark.rule').replace('{rule}', () => rule);
    return name;
}

/** Build the shared engine-proposed Ways to Fix heading and action group. */
export function buildRuleFixes(
    doc: Document,
    fixes: readonly RuleErrorFix[],
    onApply: (fix: Fix, pointerType?: string) => void,
    returnFocus?: (pointerType?: string) => void,
    headingText = t('fix.heading'),
): HTMLElement {
    adoptStylesOnce(ruleErrorsCss, doc);
    const heading = doc.createElement('div');
    heading.className = 'ez-validation-errors__fixes-heading';
    heading.id = `ez-fix-heading-${++nextHeadingId}`;
    heading.textContent = headingText;
    const group = doc.createElement('div');
    group.className = 'ez-validation-errors__fixes';
    group.appendChild(heading);
    for (const { fix, label } of fixes) {
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = 'ez-validation-errors__fix';
        button.textContent = label;
        let pointerType = 'keyboard';
        button.addEventListener('pointerdown', (event) => {
            pointerType = event.pointerType;
        });
        button.addEventListener('pointercancel', () => {
            pointerType = 'keyboard';
        });
        button.addEventListener('keydown', () => {
            pointerType = 'keyboard';
        });
        // A pointer press leaves focus where it was, so pressing a fix
        // never blurs the field it corrects.
        button.addEventListener('mousedown', (event) => event.preventDefault());
        button.addEventListener('click', (event) => {
            event.preventDefault();
            const activation = event.detail === 0 ? 'keyboard' : pointerType;
            pointerType = 'keyboard';
            onApply(fix, activation);
            // The pressed button disappears. Keep the activation type so a
            // pointer repair can retain its place without opening the editor.
            returnFocus?.(activation);
        });
        group.appendChild(button);
    }
    group.setAttribute('role', 'group');
    group.setAttribute('aria-labelledby', heading.id);
    return group;
}

/**
 * The rendered list. One instance per field; `update` replaces its content each
 * time the engine reports on the field's value.
 */
export class RuleErrorList {
    readonly element: HTMLDivElement;
    /** What the list shows now, so an unchanged report is not re-announced. */
    private shown = '';
    /** Whether the last report had anything to show. */
    private hasContent = false;
    /**
     * Set while the field's own editor is open: its list carries the same
     * report, so the field shows one list, not two.
     */
    private suppressed = false;
    private currentFixes: readonly RuleErrorFix[] = [];
    private currentApply: ((fix: Fix, pointerType?: string) => void) | null =
        null;

    /**
     * @param doc - The document the field lives in
     * @param returnFocus - Restores focus after the pressed button leaves with
     *   its errors. The pointer type keeps a completed repair from reopening an
     *   editor the user had not entered.
     */
    constructor(
        doc: Document,
        private readonly returnFocus?: (pointerType?: string) => void,
        private readonly options?: {
            remediesOnly?: boolean;
            fixesHeading?: string;
            showRuleNames?: boolean;
            beforeReplace?: () => void;
        },
    ) {
        this.element = doc.createElement('div');
        this.element.className = 'ez-validation-errors';
        this.element.setAttribute('aria-live', 'polite');
        this.element.setAttribute('data-ezclassify', '');
        this.element.hidden = true;
        adoptStylesOnce(ruleErrorsCss, doc);
    }

    /**
     * Show this report. Pass `null` for `onApply` when the owner cannot change
     * its value, and the list shows messages without buttons.
     */
    update(
        report: RuleErrorReport,
        onApply: ((fix: Fix, pointerType?: string) => void) | null,
    ): void {
        this.currentFixes = report.fixes;
        this.currentApply = onApply;
        this.element.toggleAttribute(
            'data-has-errors',
            report.messages.length > 0,
        );
        const shown = JSON.stringify([
            onApply !== null,
            report.messages,
            report.warnings,
            this.options?.showRuleNames &&
                report.errors?.map((error) => error.constraintId),
            // The marking each button writes, not only its words: two
            // results can word the same change over different values.
            report.fixes.map((f) => [f.label, f.fix.rendered]),
        ]);
        const showFixes =
            onApply !== null &&
            report.fixes.length > 0 &&
            (this.options?.remediesOnly || report.messages.length > 0);
        this.hasContent =
            report.messages.length > 0 ||
            report.warnings.length > 0 ||
            Boolean(showFixes);
        const changed = shown !== this.shown;
        if (changed) this.options?.beforeReplace?.();
        this.element.hidden = this.suppressed || !this.hasContent;
        // Rebuilding identical content would make a screen reader announce
        // the same errors again on every keystroke that leaves them standing.
        if (!changed) return;
        this.shown = shown;
        const doc = this.element.ownerDocument;
        const row = (
            text: string,
            warning: boolean,
            ruleId?: string,
        ): HTMLElement => {
            const item = doc.createElement('div');
            item.className = warning
                ? 'ez-validation-errors__item ez-validation-errors__item--warning'
                : 'ez-validation-errors__item';
            const message = doc.createElement('span');
            message.className = 'ez-validation-errors__message';
            message.textContent = text;
            item.appendChild(message);
            const rule = ruleAttribution(doc, ruleId);
            if (rule) item.appendChild(rule);
            return item;
        };
        const rules = this.options?.showRuleNames
            ? [...(report.errors ?? [])]
            : [];
        const children: HTMLElement[] = [
            ...report.messages.map((text) => {
                const i = rules.findIndex((error) => error.message === text);
                const rule = i < 0 ? undefined : rules.splice(i, 1)[0];
                return row(text, false, rule?.constraintId);
            }),
            ...report.warnings.map((text) => row(text, true)),
        ];
        if (showFixes) {
            // Without a heading the buttons read as one per error, or as a
            // list to work through; each is a way to fix the marking.
            children.push(
                buildRuleFixes(
                    doc,
                    report.fixes,
                    (previous, pointerType) => {
                        const current = this.currentFixes.find(
                            ({ fix }) => fix.rendered === previous.rendered,
                        );
                        if (current)
                            this.currentApply?.(current.fix, pointerType);
                    },
                    this.returnFocus,
                    this.options?.fixesHeading,
                ),
            );
        }
        this.element.replaceChildren(...children);
    }

    /**
     * Hide the list while the field carries the same report itself (an open
     * editor's list, a compact control's error count), and show it again, with
     * whatever it last reported, when the field stops carrying it.
     */
    setSuppressed(suppressed: boolean): void {
        this.suppressed = suppressed;
        this.element.hidden = suppressed || !this.hasContent;
    }

    /** Take the list out of the document. */
    remove(): void {
        this.element.remove();
    }
}
