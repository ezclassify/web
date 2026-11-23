import type { Assertion, Fix } from '@ezclassify/types';
import { createClearButton } from './clear-button';
import { mountNativeFieldDefaults } from './field-chrome';
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
    setStatusMarkFindings,
    setStatusMarkFixes,
    type StatusMarkOptions,
    type StatusMarkFinding,
} from './status-mark';

/** Shared feedback and actions for fields with different marking storage. */
export abstract class FieldComponentBase {
    protected fieldFavorites: FavoritesPanel | null = null;
    protected ruleErrorList: RuleErrorList | null = null;
    private feedbackStatus: HTMLElement | null = null;
    private findings: readonly StatusMarkFinding[] = [];
    private inlineReport = false;
    private releaseNativeFieldDefaults: (() => void) | null = null;

    protected styleNativeField(host: HTMLElement): void {
        this.releaseNativeFieldDefaults?.();
        this.releaseNativeFieldDefaults = mountNativeFieldDefaults(host);
    }

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
        setStatusMarkFindings(status, this.findings);
        this.fieldFavorites = ensureMarkingFavorites(status, favorites());
        return mark;
    }

    protected destroyFieldTools(): void {
        this.releaseNativeFieldDefaults?.();
        this.releaseNativeFieldDefaults = null;
        this.fieldFavorites?.destroy();
        this.fieldFavorites = null;
        this.feedbackStatus = null;
        this.findings = [];
    }

    protected createFieldClear(
        options: Parameters<typeof createClearButton>[0],
    ) {
        return createClearButton({
            ...options,
            clear: () => {
                this.ruleErrorList?.update(NO_RULE_ERRORS, null);
                this.setFieldFindings([]);
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
        const hasMessages =
            report.messages.length > 0 || report.warnings.length > 0;
        this.setFieldFindings(
            hasMessages || (apply && report.fixes.length)
                ? [
                      {
                          report,
                          apply: apply
                              ? (fix, pointerType) => {
                                    apply(fix);
                                    focus(pointerType);
                                }
                              : undefined,
                      },
                  ]
                : [],
        );
        this.showInlineReport(owner, report, place);
    }

    protected showInlineReport(
        owner: Document,
        report: RuleErrorReport,
        place: (element: HTMLElement) => void,
    ): void {
        if (!report.messages.length && !report.warnings.length) {
            this.ruleErrorList?.update(NO_RULE_ERRORS, null);
            return;
        }
        if (!this.ruleErrorList) {
            this.ruleErrorList = new RuleErrorList(owner);
            this.ruleErrorList.element.classList.add(
                'ez-validation-errors--inline',
            );
        }
        this.ruleErrorList.setSuppressed(this.inlineReport);
        place(this.ruleErrorList.element);
        this.ruleErrorList.update({ ...report, fixes: [] }, null);
    }

    protected setFieldFindings(findings: readonly StatusMarkFinding[]): void {
        this.findings = findings;
        if (this.feedbackStatus)
            setStatusMarkFindings(this.feedbackStatus, findings);
    }

    protected suppressFieldReport(inField: boolean): void {
        this.inlineReport = inField;
        this.ruleErrorList?.setSuppressed(inField);
    }

    protected removeRuleErrors(): void {
        this.ruleErrorList?.remove();
        this.ruleErrorList = null;
        this.setFieldFindings([]);
    }

    /** Translate the Runtime's proposed edit once, preserving retained values. */
    protected fixedAssertions(
        fix: Fix,
        current: readonly Assertion[],
    ): Assertion[] {
        return fixAssertions(fix, current);
    }
}
