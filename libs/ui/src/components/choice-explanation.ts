import { t } from '../i18n';

/** Presents a Runtime explanation without letting an older request replace it. */
export class ChoiceExplanation {
    readonly element: HTMLDivElement;
    private reasons = new Map<string, string>();
    private input = '';
    private active: { id: string } | null = null;

    constructor(document: Document, className: string) {
        this.element = document.createElement('div');
        this.element.className = className;
        this.element.setAttribute('role', 'status');
        this.element.hidden = true;
    }

    get target(): string | null {
        return this.active?.id ?? null;
    }

    /** Dismiss the explanation and invalidate any pending presentation. */
    hide(): void {
        this.active = null;
        this.element.hidden = true;
        this.element.textContent = '';
    }

    /** A new Runtime request context invalidates the cache and open report. */
    resetIfChanged(input: string): void {
        if (this.input === input) return;
        this.input = input;
        this.reasons.clear();
        this.hide();
    }

    /** Explain a blocked option using the host's canonical Runtime request. */
    async show(
        input: () => string,
        id: string,
        label: string,
        lookup: () => string | Promise<string>,
    ): Promise<void> {
        const facts = input();
        this.resetIfChanged(facts);
        const active = { id };
        this.active = active;
        this.element.hidden = false;

        const show = (reason: string) => {
            this.element.textContent = `${label} is not available: ${reason}`;
        };
        const known = this.reasons.get(id);
        if (known !== undefined) {
            show(known);
            return;
        }

        this.element.textContent = '';
        let reason: string;
        try {
            reason = await lookup();
        } catch {
            reason = t('composer.unavailable');
        }

        if (this.active !== active || input() !== facts) return;
        this.reasons.set(id, reason);
        show(reason);
    }
}
