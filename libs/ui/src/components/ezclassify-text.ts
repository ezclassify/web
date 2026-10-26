/**
 * EzClassifyText: a visible-marking controller.
 *
 * Mounts on any element whose textContent IS the rendered marking, a scanner
 * card, a wrapped span, a code block, etc. The component reads textContent,
 * runs it through the engine, contributes the resulting assertions to the
 * page-aggregate store, and applies validation CSS classes to the host element.
 * It never reflows surrounding DOM (no error siblings, no innerHTML mutation),
 * consumer chooses tooltip/sidebar/summary UX.
 *
 * Imperative consumers that mutate textContent themselves call refresh() to
 * re-process. The component deliberately does not install a MutationObserver
 * (scan-and-wrap-page use case wraps hundreds of spans; one observer per span
 * would be a lot of churn).
 */

import type { Assertion, ValidationError } from '@ezclassify/types';
import type {
    ComponentInstance,
    ComponentOptions,
    ComponentEngineSource,
    ComponentSchemeEngine,
} from './component-base-readonly';
import {
    isAddressableSchemeEngine,
    resolveContextSource,
    resolveProfile,
    resolveSchemeEngine,
} from './component-base-readonly';
import textCss from './ezclassify-text.css?inline';
import { adoptStyles, type AdoptedStyles } from '../styles/adopt';

const EZCLASSIFY_TEXT_CSS: string = textCss;

/** Caller-facing options for EzClassifyText. */
export interface EzClassifyTextOptions extends Omit<
    ComponentOptions,
    'onChange'
> {
    /**
     * Notified after every read: initial mount, refresh(), setValue(),
     * setAssertions(), and destroy(). Errors come from the engine's validate
     * result and are empty when the marking is valid or empty.
     */
    onChange?: (
        assertions: Assertion[],
        rendered: string,
        errors: ValidationError[],
    ) => void;

    /**
     * When true, skip the default aria-live="polite" that the component sets on
     * the host element. Set this for scan-and-wrap use cases where many
     * instances run in the background; without it, AT will announce every
     * classification change as the scan proceeds, which is noisy and unhelpful
     * to users.
     */
    noLive?: boolean;
}

type AnyOnChange = (
    assertions: Assertion[],
    rendered: string,
    errors?: ValidationError[],
) => void;

/**
 * Visible-element marking controller. The host element's `textContent` IS the
 * marking; this component contributes its parsed assertions to the page
 * aggregate and flags the host with `.ez-text--valid` / `.ez-text--invalid`.
 */
export class EzClassifyText implements ComponentInstance {
    private engine!: ComponentSchemeEngine;
    private schemeAddressing = false;
    private host!: HTMLElement;
    private options: EzClassifyTextOptions = {};
    private formatId!: string;
    private schemeId!: string;
    private roleContext: { role: 'whole' | 'part' } | undefined;
    private assertions: Assertion[] = [];
    private rendered = '';
    private valid = true;
    private errors: ValidationError[] = [];
    private adoptedStyle: AdoptedStyles | null = null;
    private destroyed = false;

    async init(
        container: HTMLDivElement,
        engineOrContext?: ComponentEngineSource | null,
        options?: ComponentOptions,
    ): Promise<void> {
        this.engine = resolveSchemeEngine(
            container,
            engineOrContext,
            'EzClassifyText',
        );
        this.schemeAddressing =
            resolveContextSource(container, engineOrContext) === null &&
            isAddressableSchemeEngine(this.engine);
        this.host = container;
        this.options = (options ?? {}) as EzClassifyTextOptions;
        this.schemeId = resolveProfile(
            container,
            this.engine,
            options,
            this.schemeAddressing,
        );

        const role = container.getAttribute('data-ezclassify-role');
        if (role === 'whole' || role === 'part') this.roleContext = { role };

        const schemeMeta = this.schemeAddressing
            ? this.engine.getSchemeMeta(this.schemeId)
            : this.engine.getSchemeMeta();
        if (options?.formatId) {
            this.formatId = options.formatId;
        } else if (
            role === 'part' ||
            (role !== 'whole' && options?.holdsPart)
        ) {
            this.formatId =
                schemeMeta.defaultPartRenderFormat ??
                schemeMeta.defaultRenderFormat ??
                '';
        } else if (role === 'whole') {
            this.formatId =
                schemeMeta.defaultWholeRenderFormat ??
                schemeMeta.defaultRenderFormat ??
                '';
        } else {
            this.formatId = schemeMeta.defaultRenderFormat ?? '';
        }

        container.setAttribute('data-ezclassify', '');

        // For source-bound usage the host's textContent changes on every store update.
        // aria-live="polite" on the host announces those changes to AT users.
        // Suppressed by noLive: true (scan-and-wrap callers should set this to avoid AT
        // announcing every background classification change across hundreds of spans) or
        // when the host already carries an explicit aria-live value the consumer set.
        if (!this.options.noLive && !container.hasAttribute('aria-live')) {
            container.setAttribute('aria-live', 'polite');
        }

        this.injectStyles();

        const initial = options?.initialValue ?? this.readHostText();
        await this.readMarking(initial);
    }

    /**
     * Re-read textContent from the host and re-process. Use when the consumer
     * has imperatively mutated the host's contents and wants the contribution
     * to refresh. Framework consumers go through their normal binding helper
     * and don't need this.
     */
    async refresh(): Promise<void> {
        if (this.destroyed) return;
        await this.readMarking(this.readHostText());
    }

    /**
     * Parse `value` via the engine and replace the stored assertions with the
     * result. Does not mutate host textContent; the text component is a
     * producer; visible text is owned by the consumer.
     */
    async setValue(value: string): Promise<void> {
        if (this.destroyed) return;
        await this.readMarking(value);
    }

    /**
     * Replace the stored assertions and re-render without reprocessing (no
     * inference, no constraint repair). The new rendered string flows out via
     * onChange.
     */
    setAssertions(assertions: Assertion[]): void {
        if (this.destroyed) return;
        this.assertions = [...assertions];
        const result = this.callRender(this.assertions, {
            format: this.formatId,
        });
        if ('rendered' in result) {
            this.rendered = result.rendered;
            this.applyValidationClasses();
            this.emitChange();
        } else {
            result.then(
                (r) => {
                    if (this.destroyed) return;
                    this.rendered = r.rendered;
                    this.applyValidationClasses();
                    this.emitChange();
                },
                (err) => {
                    console.error(
                        '[EzClassifyText] render failed:',
                        err,
                        'assertions:',
                        assertions,
                        'format:',
                        this.formatId,
                    );
                    this.emitChange();
                },
            );
        }
    }

    getAssertions(): Assertion[] {
        return [...this.assertions];
    }

    getRendered(): string {
        return this.rendered;
    }

    /**
     * No-op: validation feedback is via CSS classes on the host, not a separate
     * error surface. Errors are emitted through onChange.
     */
    updateValidationErrors(_errors: ValidationError[]): void {
        /* intentionally empty */
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.host.classList.remove('ez-text--valid', 'ez-text--invalid');
        this.host.removeAttribute('aria-invalid');
        this.host.removeAttribute('data-ezclassify');
        this.assertions = [];
        this.rendered = '';
        this.errors = [];
        this.valid = true;
        // Clear any consumer-wired error target and remove the aria-errormessage
        // reference before teardown so AT doesn't announce stale error text on
        // elements that are about to be unmounted.
        this.applyErrorMessage();
        // Final empty publish so any aggregate that was holding this contribution
        // drops it on the floor. The framework runtime also empties the store
        // for this id during its own teardown, but standalone consumers rely
        // on this hook.
        this.emitChange();
        if (this.adoptedStyle) {
            this.adoptedStyle.release();
            this.adoptedStyle = null;
        }
    }

    private readHostText(): string {
        return (this.host.textContent ?? '').trim();
    }

    private async readMarking(text: string): Promise<void> {
        if (!text) {
            this.assertions = [];
            this.rendered = '';
            this.valid = true;
            this.errors = [];
            this.host.textContent = '';
            this.applyValidationClasses();
            this.emitChange();
            return;
        }
        try {
            const result = await Promise.resolve(
                this.callValidate(
                    text,
                    this.formatId ? { outputFormat: this.formatId } : undefined,
                ),
            );
            if (this.destroyed) return;
            this.assertions = result.assertions ?? [];
            this.rendered = result.rendered ?? '';
            this.valid = result.valid !== false;
            this.errors = result.errors ?? [];
        } catch (err) {
            // Engine errors are treated as a hard-invalid marking: keep the prior
            // assertions empty so we don't leak stale state into the aggregate,
            // surface the error message via onChange.
            console.error(
                '[EzClassifyText] validate failed:',
                err,
                'text:',
                text,
                'format:',
                this.formatId,
            );
            this.assertions = [];
            this.rendered = '';
            this.valid = false;
            this.errors = [
                {
                    constraintId: '_process',
                    message: String((err as Error)?.message ?? err),
                } as ValidationError,
            ];
        }
        this.host.textContent = this.rendered;
        this.applyValidationClasses();
        this.emitChange();
    }

    private applyValidationClasses(): void {
        // Empty text contributes nothing and has no validation state worth
        // flagging visually. This is also the destroy-time path.
        if (!this.rendered && this.assertions.length === 0) {
            this.host.classList.remove('ez-text--valid', 'ez-text--invalid');
            this.host.removeAttribute('aria-invalid');
            this.applyErrorMessage();
            return;
        }
        if (this.valid) {
            this.host.classList.add('ez-text--valid');
            this.host.classList.remove('ez-text--invalid');
            this.host.removeAttribute('aria-invalid');
        } else {
            this.host.classList.add('ez-text--invalid');
            this.host.classList.remove('ez-text--valid');
            this.host.setAttribute('aria-invalid', 'true');
        }
        this.applyErrorMessage();
    }

    /**
     * Wire or clear aria-errormessage based on current validity state.
     *
     * Consumers opt into this by placing a data-ezclassify-error-target="<id>"
     * attribute on the host element, pointing to a container they control. When
     * the marking is invalid the component writes the error text there and adds
     * aria-errormessage to the host so AT can read the description. When the
     * marking becomes valid (or empty, or on destroy) both are cleared.
     *
     * No-ops silently when the target attribute is absent or points to an
     * element that doesn't exist in the document yet; the convention is opt-in
     * and non-breaking for hosts that don't participate.
     */
    private applyErrorMessage(): void {
        const targetId = this.host.getAttribute('data-ezclassify-error-target');
        if (!targetId) return;
        const doc = this.host.ownerDocument ?? document;
        const target = doc.getElementById(targetId);
        if (!target) return;
        if (!this.valid && this.errors.length > 0) {
            target.textContent = this.errors.map((e) => e.message).join('; ');
            this.host.setAttribute('aria-errormessage', targetId);
        } else {
            target.textContent = '';
            this.host.removeAttribute('aria-errormessage');
        }
    }

    /**
     * Engine.validate with the host's role, addressed to this host's scheme
     * where it can be. The host displays a marking and corrects nothing, so it
     * asks the reader's call.
     */
    private callValidate(input: string, options?: { outputFormat?: string }) {
        const merged = this.roleContext
            ? { ...options, context: this.roleContext }
            : options;
        if (this.schemeAddressing && isAddressableSchemeEngine(this.engine)) {
            return this.engine.validate(input, this.schemeId, merged);
        }
        return this.engine.validate(input, merged);
    }

    private callRender(assertions: Assertion[], options?: { format?: string }) {
        const format = options?.format;
        if (this.schemeAddressing) {
            return this.engine.render(assertions, format, this.schemeId);
        }
        return this.engine.render(assertions, format);
    }

    private emitChange(): void {
        const cb = this.options.onChange as AnyOnChange | undefined;
        cb?.(this.getAssertions(), this.rendered, this.errors);
    }

    private injectStyles(): void {
        if (this.options.injectStyles === false) return;
        const root = (this.options.root ??
            this.host.ownerDocument?.head ??
            document.head) as HTMLElement;
        // Reference counted: every controller under the root holds its own
        // handle, and the sheet detaches when the last one is released.
        this.adoptedStyle = adoptStyles(EZCLASSIFY_TEXT_CSS, root);
    }
}
