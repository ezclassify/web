import type { Assertion, Fix } from '@ezclassify/types';
import { t } from '../i18n';
import { createFieldAction, type ClearActionOptions } from './clear-button';
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
    /** See {@link setShareFailed}. */
    private shareFailed = false;
    /** The last report the field showed, to show again when that changes. */
    private lastFieldReport: Parameters<
        FieldComponentBase['updateFieldReport']
    > | null = null;
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

    protected createFieldClear(options: ClearActionOptions) {
        return createFieldAction({
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
        this.lastFieldReport = [owner, report, place, focus, apply];
        report = this.withShareFailure(report);
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

    /**
     * Tell the field whether its value could be shared with the rest of the
     * page: the runtime calls this when the store rejected the field's last
     * publish (true) and when a later publish for it landed (false). While it
     * is true the field reports itself unverified, the way a failed check of
     * its text does, and says so under the field: the banner, rollups and
     * hidden fields still show the value it had before. The value the user
     * entered stays.
     *
     * @param failed - Whether the field's last publish was rejected
     * @internal
     */
    setShareFailed(failed: boolean): void {
        if (this.shareFailed === failed) return;
        this.shareFailed = failed;
        const last = this.lastFieldReport;
        if (last) this.updateFieldReport(...last);
        this.onUnverifiedChanged();
    }

    /**
     * The user committed the value the field holds. A value the store rejected
     * is published again here, so the user can retry without changing it. Each
     * field family sends its value its own way.
     */
    protected shareAgain(): void {}

    /** Whether the store rejected the field's last publish. */
    protected get valueNotShared(): boolean {
        return this.shareFailed;
    }

    /**
     * Report the field's unverified state on its host again, after one of its
     * causes changed. Each field family combines its own causes.
     */
    protected onUnverifiedChanged(): void {}

    /** A report with the unverified notice added while the value is not shared. */
    private withShareFailure(report: RuleErrorReport): RuleErrorReport {
        const notice = this.notSharedNotice();
        if (!this.shareFailed || report.messages.includes(notice))
            return report;
        return { ...report, messages: [...report.messages, notice] };
    }

    /**
     * What the field says while its value has not reached the rest of the page:
     * that the entry is kept, then how to try again where the field has a way
     * to.
     */
    protected notSharedNotice(): string {
        return [t('share.notShared'), this.shareRetryHint()]
            .filter(Boolean)
            .join(' ');
    }

    /**
     * How the user sends a value the store rejected again, or null when the
     * field has no single action for it.
     */
    protected shareRetryHint(): string | null {
        return null;
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
