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
    if (!(host instanceof HTMLFieldSetElement) || nativeChoiceGroup(host))
        return () => {};
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

/** A standalone, named checkbox group is itself a successful form field. */
export function nativeChoiceGroup(
    host: HTMLElement,
): { name: string; inputs: HTMLInputElement[] } | undefined {
    if (
        !(host instanceof HTMLFieldSetElement) ||
        !host.matches(
            'fieldset[data-ezclassify-controller="selector"], fieldset[data-ezclassify-controller="checklist"]',
        ) ||
        !host.hasAttribute('data-ezclassify-category') ||
        host.hasAttribute('data-ezclassify-bound-to') ||
        host.hasAttribute('data-ezclassify-facet-of') ||
        host.querySelector('input[type="hidden"]')
    )
        return undefined;

    const inputs = Array.from(
        host.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name]'),
    );
    const name = inputs[0]?.name;
    return name && inputs.every((input) => input.name === name)
        ? { name, inputs }
        : undefined;
}

/** Reflect Runtime-selected concepts in the original form's checkbox group. */
export function writeNativeChoiceGroup(
    host: HTMLElement,
    group: NonNullable<ReturnType<typeof nativeChoiceGroup>>,
    selected: ReadonlySet<string>,
): void {
    const represented = new Set<string>();
    let changed = false;
    for (const input of group.inputs) {
        const checked = selected.has(input.value);
        changed ||= input.checked !== checked;
        input.checked = checked;
        if (!input.disabled) represented.add(input.value);
    }
    for (const value of selected) {
        if (represented.has(value)) continue;
        const label = host.ownerDocument.createElement('label');
        const input = host.ownerDocument.createElement('input');
        input.type = 'checkbox';
        input.name = group.name;
        input.value = value;
        input.checked = true;
        label.append(input, ' ', value);
        host.append(label);
        group.inputs.push(input);
        changed = true;
    }
    if (changed) host.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Remember the native values left in the form when an enhancement is remounted. */
const lastNativeFacetValues = new WeakMap<HTMLElement, string[]>();

export function readNativeFacetSelection(
    host: HTMLElement,
    hasMarking: boolean,
): string[] | undefined {
    if (host.matches(':disabled')) return undefined;

    let values: string[];
    let defaults: string[];
    if (isNativeSingleSelect(host)) {
        const options = Array.from(host.options).filter(
            (option) => !option.matches(':disabled'),
        );
        values = options
            .filter((option) => option.selected)
            .map((option) => option.value);
        defaults = options
            .filter((option) => option.defaultSelected)
            .map((option) => option.value);
        if (!defaults.length && options[0]) defaults = [options[0].value];
    } else if (host instanceof HTMLFieldSetElement) {
        const inputs = Array.from(
            host.querySelectorAll<HTMLInputElement>(
                'input[type="checkbox"]:not(:disabled), input[type="radio"]:not(:disabled)',
            ),
        );
        if (!inputs.length) return undefined;
        values = inputs
            .filter((input) => input.checked)
            .map((input) => input.value);
        defaults = inputs
            .filter((input) => input.defaultChecked)
            .map((input) => input.value);
    } else {
        return undefined;
    }

    const conceptIds = [...new Set(values.filter(Boolean))];
    const previous = lastNativeFacetValues.get(host);
    lastNativeFacetValues.set(host, conceptIds);
    const baseline = previous ?? (hasMarking ? defaults.filter(Boolean) : []);
    return conceptIds.length !== baseline.length ||
        conceptIds.some((value, index) => value !== baseline[index])
        ? conceptIds
        : undefined;
}
