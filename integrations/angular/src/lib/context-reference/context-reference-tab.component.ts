/**
 * `<ez-context-reference-tab>`: a declarative custom tab for
 * `<ez-context-reference>`.
 *
 * Stamps the `data-ezclassify-tab` marker attributes the vanilla controller
 * scans for onto its host element, and projects its content with
 * `<ng-content>`. The controller hoists this host element into the tab strip
 * and adopts its projected content as the tab's panel.
 */

import {
    Component,
    ChangeDetectionStrategy,
    ElementRef,
    Input,
    OnInit,
    Renderer2,
    inject,
} from '@angular/core';
import { contextReferenceTabAttributes } from '@ezclassify/ui';

/** A custom tab hoisted beside the built-in reference tabs. */
@Component({
    selector: 'ez-context-reference-tab',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `<ng-content></ng-content>`,
})
export class EzContextReferenceTabComponent implements OnInit {
    /** Stable tab id, referenced by the parent's `tabs` allowlist. */
    @Input() id?: string;
    /** Tab strip label. */
    @Input() label = '';
    /** Optional short icon/emoji shown before the label. */
    @Input() icon?: string;
    /** Sort key among custom tabs. */
    @Input() order?: number;

    private readonly el = inject(ElementRef<HTMLElement>);
    private readonly renderer = inject(Renderer2);

    ngOnInit(): void {
        const host = this.el.nativeElement;
        const attributes = contextReferenceTabAttributes({
            id: this.id,
            label: this.label,
            icon: this.icon,
            order: this.order,
        });
        for (const [name, value] of Object.entries(attributes)) {
            this.renderer.setAttribute(host, name, value);
        }
    }
}
