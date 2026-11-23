import type { HTMLAttributes } from 'react';

/** Props for a banner inside an `<EzClassify>` root. */
export interface EzClassifyBannerProps extends HTMLAttributes<HTMLDivElement> {
    /** Show a named marking instead of an aggregate. */
    source?: string;
    /** Show a named collection or whole's rollup. Defaults to the page. */
    aggregate?: string;
    /** Accessible label prefix for this banner. */
    label?: string;
    /** Disable live announcements for this banner. */
    noLive?: boolean;
}

export function EzClassifyBanner({
    source,
    aggregate,
    label,
    noLive,
    ...attributes
}: EzClassifyBannerProps) {
    return (
        <div
            {...attributes}
            data-ezclassify-controller="banner"
            data-ezclassify-source={source}
            data-ezclassify-aggregate={aggregate ?? (source ? undefined : '')}
            data-ezclassify-banner-label={label}
            data-ezclassify-banner-no-live={noLive ? '' : undefined}
        />
    );
}
