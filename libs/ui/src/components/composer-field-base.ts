import { ComponentBase } from './component-base';
import { ComposerController } from './composer/composer-controller';
import { ComposerView } from './composer/composer-view';
import type { SchemeMetaView } from '@ezclassify/types';
import { teardownAfterWrite } from './teardown-write';
import { t } from '../i18n';

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
            fieldNotice: () =>
                this.valueNotShared ? this.notSharedNotice() : null,
            textToolsEdges: () => true,
        });
        this.container.appendChild(this.view.announcer);
        noteAnchor.insertAdjacentElement('afterend', this.view.note);
        this.controller.subscribe((snapshot) =>
            this.reportUnverified(snapshot.unverified),
        );
    }

    /**
     * The open list covers the note under the field: say there, too, that the
     * value has not reached the page, and announce it while the list holds the
     * field's report.
     */
    protected override onUnverifiedChanged(): void {
        const wasShared = !this.notSharedShown;
        this.notSharedShown = this.valueNotShared;
        super.onUnverifiedChanged();
        if (!this.view) return;
        this.view.refreshValidity();
        if (wasShared && this.notSharedShown && this.controller.isOpen)
            this.view.announce(this.notSharedNotice());
    }

    private notSharedShown = false;

    /** Leaving the field commits the value it holds, which sends it again. */
    protected override shareRetryHint(): string | null {
        return t('share.retryLeave');
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
                this.setShareFailed(false);
                this.reportUnverified(false);
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
