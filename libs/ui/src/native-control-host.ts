import { getMountHost } from './mount-host-registry';

export function isNativeSingleSelect(
    host: HTMLElement | null | undefined,
): host is HTMLSelectElement {
    return (
        host instanceof HTMLSelectElement &&
        !host.multiple &&
        host.getAttribute('data-ezclassify-select-mode') !== 'cards'
    );
}

const generatedChoices = new WeakSet<HTMLInputElement>();

export function markGeneratedChoiceValue(input: HTMLInputElement): void {
    generatedChoices.add(input);
}

/** Keep the authored fallback out of native form submission while enhanced. */
export function suspendNativeChoiceFallback(
    container: HTMLElement,
): () => void {
    const host = getMountHost(container);
    if (!(host instanceof HTMLFieldSetElement)) return () => {};
    const choices = Array.from(
        host.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
            'input[type="checkbox"]:not([disabled]), input[type="radio"]:not([disabled]), select:not([disabled])',
        ),
    );
    const hidden = host.querySelector<HTMLInputElement>('input[type="hidden"]');
    for (const choice of choices) choice.disabled = true;
    return () => {
        for (const choice of choices) choice.disabled = false;
        if (hidden && generatedChoices.has(hidden)) hidden.remove();
    };
}
