import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

/** A banner inside an `[ezClassify]` root. Defaults to the page rollup. */
@Component({
    selector: 'ez-classify-banner',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: '',
    host: {
        'data-ezclassify-controller': 'banner',
        '[attr.data-ezclassify-source]': 'source',
        '[attr.data-ezclassify-aggregate]': "aggregate ?? (source ? null : '')",
        '[attr.data-ezclassify-banner-label]': 'label',
        '[attr.data-ezclassify-banner-no-live]': "noLive ? '' : null",
    },
})
export class EzClassifyBannerComponent {
    /** Show a named marking instead of an aggregate. */
    @Input() source?: string;
    /** Show a named collection or whole's rollup. Defaults to the page. */
    @Input() aggregate?: string;
    /** Accessible label prefix for this banner. */
    @Input() label?: string;
    /** Disable live announcements for this banner. */
    @Input() noLive = false;
}
