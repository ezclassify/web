import { defineComponent, h } from 'vue';
import type { SlottedComponent } from './component-type';

const bannerProps = {
    source: String,
    aggregate: String,
    label: String,
    noLive: Boolean,
} as const;

/** A banner inside an `<EzClassify>` root. Defaults to the page rollup. */
export const EzClassifyBanner: SlottedComponent<typeof bannerProps> =
    defineComponent({
        name: 'EzClassifyBanner',
        props: bannerProps,
        setup(props) {
            return () =>
                h('div', {
                    'data-ezclassify-controller': 'banner',
                    'data-ezclassify-source': props.source,
                    'data-ezclassify-aggregate':
                        props.aggregate ?? (props.source ? undefined : ''),
                    'data-ezclassify-banner-label': props.label,
                    'data-ezclassify-banner-no-live': props.noLive
                        ? ''
                        : undefined,
                });
        },
    });
