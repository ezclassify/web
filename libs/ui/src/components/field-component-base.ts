import type { Assertion, Fix } from '@ezclassify/types';
import { createClearButton } from './clear-button';
import {
    ensureMarkingFavorites,
    type FavoritesPanel,
    type FavoritesPanelHost,
} from './favorites-panel';
import {
    fixAssertions,
    NO_RULE_ERRORS,
    RuleErrorList,
    type RuleErrorReport,
} from './rule-errors';
import {
    ensureStatusMark,
    setStatusMarkError,
    setStatusMarkFixes,
    type StatusMarkOptions,
} from './status-mark';

/** Shared feedback and actions for fields with different marking storage. */
export abstract class FieldComponentBase {
    protected fieldFavorites: FavoritesPanel | null = null;
    protected ruleErrorList: RuleErrorList | null = null;
    private feedbackStatus: HTMLElement | null = null;
    private inlineReport = false;

    protected mountFieldTools(
        status: HTMLElement,
        options: Omit<StatusMarkOptions, 'shape' | 'tools'>,
        favorites: () => FavoritesPanelHost,
    ): HTMLElement {
        this.feedbackStatus = status;
        const mark = ensureStatusMark(status, {
            ...options,
            shape: 'chrome',
            tools: true,
        });
        this.fieldFavorites = ensureMarkingFavorites(status, favorites());
        return mark;
    }

    protected destroyFieldTools(): void {
        this.fieldFavorites?.destroy();
        this.fieldFavorites = null;
        this.feedbackStatus = null;
    }

    protected createFieldClear(
        options: Parameters<typeof createClearButton>[0],
    ) {
        return createClearButton({
            ...options,
            clear: () => {
                this.ruleErrorList?.update(NO_RULE_ERRORS, null);
                if (this.feedbackStatus) {
                    setStatusMarkFixes(this.feedbackStatus, []);
                    setStatusMarkError(this.feedbackStatus, null);
                }
                return options.clear();
            },
        });
    }

    protected updateFieldReport(
        owner: Document,
        report: RuleErrorReport,
        place: (element: HTMLElement) => void,
        focus: (pointerType?: string) => void,
        apply: ((fix: Fix) => void) | null,
    ): void {
        if (!report.messages.length && !report.warnings.length) {
            this.ruleErrorList?.update(NO_RULE_ERRORS, null);
            return;
        }
        this.ruleErrorList ??= new RuleErrorList(owner, focus);
        this.ruleErrorList.setSuppressed(this.inlineReport);
        place(this.ruleErrorList.element);
        this.ruleErrorList.update(report, apply);
    }

    protected suppressFieldReport(inField: boolean): void {
        this.inlineReport = inField;
        this.ruleErrorList?.setSuppressed(inField);
    }

    protected removeRuleErrors(): void {
        this.ruleErrorList?.remove();
        this.ruleErrorList = null;
    }

    /** Translate the Runtime's proposed edit once, preserving retained values. */
    protected fixedAssertions(
        fix: Fix,
        current: readonly Assertion[],
    ): Assertion[] {
        return fixAssertions(fix, current);
    }
}
