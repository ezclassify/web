/**
 * `<ez-context-reference>`: the Angular binding for the vanilla
 * context-reference drawer.
 *
 * Thin glue, not a re-implementation. The component stamps the
 * `data-ezclassify-*` attributes and `--ez-context-ref-*` CSS variables the
 * vanilla controller reads (mapped by the shared
 * `contextReferenceHostAttributes`) onto its own host element, and projects its
 * content with `<ng-content>`. The ambient `[ezClassify]` scanner enhances the
 * host; the vanilla controller does all the work: deriving built-in tabs from
 * the loaded context and hoisting custom tabs.
 *
 * A custom tab is `<ez-context-reference-tab label="...">`, whose host carries
 * the `data-ezclassify-tab` marker the controller scans for on a direct child.
 * `<ng-content>` IS that child DOM; there is no projection runtime.
 *
 * ```html
 * <ez-context-reference placement="left" [open]="true">
 *     <ez-context-reference-tab id="developers" label="Developers">
 *         <app-developer-panel></app-developer-panel>
 *     </ez-context-reference-tab>
 * </ez-context-reference>
 * ```
 *
 * Presentation inputs are read once at init, matching the declarative,
 * mount-time contract of the vanilla controller.
 */

import {
    Component,
    ChangeDetectionStrategy,
    ElementRef,
    Input,
    OnInit,
    Renderer2,
    RendererStyleFlags2,
    inject,
} from '@angular/core';
import {
    contextReferenceHostAttributes,
    type ContextReferenceOffsets,
    type ContextReferencePlacement,
} from '@ezclassify/ui';

/** The docked reference drawer. Use inside an `[ezClassify]` scope. */
@Component({
    selector: 'ez-context-reference',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `<ng-content></ng-content>`,
})
export class EzContextReferenceComponent implements OnInit {
    /** Docking edge. Default: `right`. */
    @Input() placement?: ContextReferencePlacement;
    /** Panel size (width when left/right, height when top/bottom). */
    @Input() size?: string;
    /** Per-side viewport offsets. */
    @Input() offset?: ContextReferenceOffsets;
    /** Start opened. Default: closed. */
    @Input() open = false;
    /** Ordered tab id allowlist (order + suppression; presentation only). */
    @Input() tabs?: string[] | string;
    /** Named preset theme slug. */
    @Input() theme?: string;
    /** Force a color scheme regardless of host theme. */
    @Input() colorScheme?: 'auto' | 'light' | 'dark';
    /** Per-tab label overrides keyed by tab id. */
    @Input() tabLabels?: Record<string, string>;
    /** Per-tab icon overrides keyed by tab id. */
    @Input() tabIcons?: Record<string, string>;

    private readonly el = inject(ElementRef<HTMLElement>);
    private readonly renderer = inject(Renderer2);

    ngOnInit(): void {
        const host = this.el.nativeElement;
        const { attributes, style } = contextReferenceHostAttributes({
            placement: this.placement,
            size: this.size,
            offset: this.offset,
            open: this.open,
            tabs: this.tabs,
            theme: this.theme,
            colorScheme: this.colorScheme,
            tabLabels: this.tabLabels,
            tabIcons: this.tabIcons,
        });
        for (const [name, value] of Object.entries(attributes)) {
            this.renderer.setAttribute(host, name, value);
        }
        for (const [name, value] of Object.entries(style)) {
            this.renderer.setStyle(
                host,
                name,
                value,
                RendererStyleFlags2.DashCase,
            );
        }
    }
}
