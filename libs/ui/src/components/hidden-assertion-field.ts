/**
 * Headless component that carries a set of assertions with no UI. Participates
 * in rollup and parent-child validation through the standard ComponentInstance
 * interface. Intended for programmatic producers (scanners, bulk importers,
 * marked-text components) that need to feed assertions into the forms layer
 * without rendering an editable widget.
 */

import type { Assertion, ValidationError } from '@ezclassify/types';
import type {
    ComponentInstance,
    ComponentOptions,
    ComponentEngineSource,
    ComponentSchemeEngine,
} from './component-base-readonly';
import { resolveProfile, resolveSchemeEngine } from './component-base-readonly';
import { renderViewRefused } from '../render-refusal';

/**
 * Hidden data-only field: stores assertions, emits change events, contributes
 * to rollup. No visible UI.
 */
export class HiddenAssertionField implements ComponentInstance {
    private engine!: ComponentSchemeEngine;
    private container!: HTMLDivElement;
    private options: ComponentOptions = {};
    private formatId!: string;
    private schemeId!: string;
    private assertions: Assertion[] = [];
    private rendered = '';

    async init(
        container: HTMLDivElement,
        engineOrContext?: ComponentEngineSource | null,
        options?: ComponentOptions,
    ): Promise<void> {
        const resolved = resolveSchemeEngine(
            engineOrContext,
            'HiddenAssertionField',
        );
        this.engine = resolved;
        this.container = container;
        this.options = options ?? {};
        this.schemeId = resolveProfile(resolved);
        const scheme = resolved.getScheme();
        this.formatId =
            options?.formatId ??
            (options?.holdsPart ? scheme.defaultPartRenderFormat : undefined) ??
            scheme.defaultRenderFormat ??
            '';

        container.setAttribute('data-ezclassify', '');
        container.style.display = 'none';

        if (options?.initialValue) {
            const result = await Promise.resolve(
                this.callValidate(options.initialValue, {
                    outputFormat: this.formatId,
                }),
            );
            this.assertions = result.assertions;
            this.rendered = result.rendered;
        }
    }

    getAssertions(): Assertion[] {
        return [...this.assertions];
    }

    /**
     * Replace the stored assertions and re-render via the engine. Does not
     * reprocess (no inference or constraint repair).
     */
    setAssertions(assertions: Assertion[]): void {
        this.assertions = [...assertions];
        const result = this.callRender(this.assertions, {
            format: this.formatId,
        });
        // A refused write is the engine's marker, never the field's value.
        if ('rendered' in result) {
            if (!renderViewRefused(result)) this.rendered = result.rendered;
            this.emitChange();
        } else {
            result.then(
                (r) => {
                    if (!renderViewRefused(r)) this.rendered = r.rendered;
                    this.emitChange();
                },
                (err) => {
                    console.error(
                        '[HiddenAssertionField] render failed:',
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

    /**
     * Parse a marking string via the engine and replace the stored assertions
     * with the result.
     */
    async setValue(value: string): Promise<void> {
        if (!value) {
            this.assertions = [];
            this.rendered = '';
            this.emitChange();
            return;
        }
        const result = await Promise.resolve(
            this.callValidate(value, { outputFormat: this.formatId }),
        );
        this.assertions = result.assertions;
        this.rendered = result.rendered;
        this.emitChange();
    }

    /**
     * Engine.validate. The field holds a marking for its owner and corrects
     * nothing, so it asks the reader's call.
     */
    private callValidate(input: string, options?: { outputFormat?: string }) {
        return this.engine.validate(input, options);
    }

    private callRender(assertions: Assertion[], options?: { format?: string }) {
        const format = options?.format;
        return this.engine.render(assertions, format);
    }

    getRendered(): string {
        return this.rendered;
    }

    updateValidationErrors(_errors: ValidationError[]): void {
        /* Hidden field: validation errors are consumed by the owning component, not rendered here. */
    }

    destroy(): void {
        this.container.innerHTML = '';
    }

    private emitChange(): void {
        this.options.onChange?.(this.getAssertions(), this.rendered);
    }
}
