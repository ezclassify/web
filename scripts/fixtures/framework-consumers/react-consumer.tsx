import {
    ContextReference,
    ContextReferenceTab,
    EzClassifyProvider,
    ReactEzClassifyStore,
    useEzClassifyFacet,
} from '@ezclassify/react';
import type { ReactNode, ComponentProps } from 'react';
const props: ComponentProps<typeof ContextReference> = {
    placement: 'left',
    open: true,
    size: '24rem',
    offset: { top: '1rem' },
    tabs: ['custom'],
    theme: 'dark',
    colorScheme: 'auto',
    tabLabels: { custom: 'Custom' },
    tabIcons: { custom: 'tag' },
};
const rendered: ReactNode = (
    <ContextReference {...props}>
        <ContextReference.Tab id="custom" label="Custom" icon="tag" order={2}>
            <span>Slot body</span>
        </ContextReference.Tab>
    </ContextReference>
);
function OwnedStore({ store }: { store: ReactEzClassifyStore }) {
    return <EzClassifyProvider store={store}>{rendered}</EzClassifyProvider>;
}
function Facet() {
    const facet = useEzClassifyFacet('document', 'level');
    return <span>{facet.rendered}</span>;
}
// @ts-expect-error A tab label remains required.
const missingLabel = <ContextReferenceTab />;
// @ts-expect-error A tab label remains a string.
const wrongLabel = <ContextReferenceTab label={1} />;
// @ts-expect-error Placement is a closed public union.
const wrongPlacement = <ContextReference placement="diagonal" />;
// @ts-expect-error Open remains boolean.
const wrongOpen = <ContextReference open="yes" />;
void [OwnedStore, Facet, missingLabel, wrongLabel, wrongPlacement, wrongOpen];
