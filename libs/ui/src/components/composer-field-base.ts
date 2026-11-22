import { ComponentBase } from './component-base';
import { ComposerController } from './composer/composer-controller';
import { ComposerView } from './composer/composer-view';
import type { SchemeMetaView } from '@ezclassify/types';
import { teardownAfterWrite } from './teardown-write';

type ComposerShape = ConstructorParameters<
    typeof ComposerController
>[0]['shape'];
type FieldViewOptions = Omit<
    ConstructorParameters<typeof ComposerView>[0],
    | 'controller'
    | 'committedValidity'
    | 'describeConcept'
    | 'onPlacement'
    | 'textToolsEdges'
>;

/** Controller lifecycle shared by editors that compose a whole marking. */
export abstract class ComposerFieldBase extends ComponentBase {
    protected controller!: ComposerController;
    protected view!: ComposerView;

    protected override resolveDefaultFormatId(meta: SchemeMetaView): string {
        return meta.defaultWholeRenderFormat ?? meta.defaultRenderFormat ?? '';
    }

    /** Fields supply their DOM anchors and any display-specific interaction. */
    protected mountComposer(
        shape: ComposerShape,
        options: FieldViewOptions,
        noteAnchor: HTMLElement,
    ): void {
        this.controller = new ComposerController({
            port: this.composerPort(shape),
            shape,
            announce: (text) => this.view?.announce(text),
        });
        this.view = new ComposerView({
            ...options,
            controller: this.controller,
            committedValidity: () => this.valueValidationMessage,
            describeConcept: this.shouldShowTooltip()
                ? (conceptId, categoryId) =>
                      this.getConceptHint(conceptId, categoryId)?.title
                : undefined,
            onPlacement: (open) => this.setReportInField(open),
            textToolsEdges: () => true,
        });
        this.container.appendChild(this.view.announcer);
        noteAnchor.insertAdjacentElement('afterend', this.view.note);
    }

    protected focusComposerTools(button: HTMLElement | null): void {
        button?.focus();
        this.view?.suspendForTools();
    }

    protected override onRuleErrorsChanged(): void {
        this.view?.refreshValidity();
    }

    /** Recheck a dirty draft when a part of its whole changes. */
    override refreshParts(): void {
        super.refreshParts();
        if (this.coversParts && !this._destroyed)
            void this.controller?.refreshContext();
    }

    protected destroyComposerAfterWrite(teardown: () => void): void {
        teardownAfterWrite(
            this,
            this.controller?.isDirty() ? () => this.controller.commit() : null,
            () => {
                this.destroyClearButton();
                this.removeRuleErrors();
                this._destroyed = true;
                if (!this.view) return;
                this.view.destroy();
                this.controller.dispose();
                teardown();
            },
        );
    }
}
