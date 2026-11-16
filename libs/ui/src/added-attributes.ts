/**
 * The attributes `EzClassifyUI.add` writes onto an element the page did not
 * mark up, and the record `remove` uses to take them off again.
 *
 * `add` speaks the attribute vocabulary: a key is the attribute's name after
 * `data-ezclassify-`, in camelCase (`partOf` is `data-ezclassify-part-of`), so
 * a script and the markup it stands in for use one set of names.
 */

import { CONTROLLER_ATTR } from './binding-model';
import { CONTROLLER_NAMES, type ControllerName } from './element-scanner';

/**
 * Attributes for `EzClassifyUI.add`, keyed by name after `data-ezclassify-` in
 * camelCase: `{ partOf: 'document' }` writes
 * `data-ezclassify-part-of="document"`. `true` writes a presence-only
 * attribute, such as `{ noRollup: true }`.
 */
export type EzClassifyAttributes = Readonly<Record<string, string | true>>;

/**
 * What `add` wrote on one element: each attribute name with the value the page
 * had there before, or `null` when the page had none.
 */
export type AddedAttributes = Map<string, string | null>;

/**
 * Attributes the runtime stamps itself. Writing one from a script would forge
 * runtime state, so `add` refuses them.
 */
const RUNTIME_ATTRS: ReadonlySet<string> = new Set([
    CONTROLLER_ATTR,
    'data-ezclassify-mount',
    'data-ezclassify-mount-root',
    'data-ezclassify-error',
    'data-ezclassify-invalid',
    'data-ezclassify-incomplete',
    'data-ezclassify-entry-conflict',
    'data-ezclassify-powered',
]);

const CAMEL_KEY = /^[a-z][a-zA-Z0-9]*$/;
const CONTROLLER_NAME_SET: ReadonlySet<string> = new Set(CONTROLLER_NAMES);

/**
 * The attribute an `add` key names.
 *
 * @param key - A camelCase key such as `partOf`
 * @returns The attribute name, such as `data-ezclassify-part-of`
 * @throws TypeError when the key is not camelCase or names an attribute the
 *   runtime owns
 */
function attributeName(key: string): string {
    if (!CAMEL_KEY.test(key))
        throw new TypeError(
            `[ezclassify] add() takes attribute keys in camelCase, as in { partOf: 'document' }; "${key}" is not one.`,
        );
    const name = `data-ezclassify-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
    if (RUNTIME_ATTRS.has(name))
        throw new TypeError(
            name === CONTROLLER_ATTR
                ? '[ezclassify] add() takes the controller as its second argument, not as an attribute.'
                : `[ezclassify] ${name} is written by the runtime; add() does not set it.`,
        );
    return name;
}

/**
 * Check what an `add` call asks for before anything is written, so a refused
 * call leaves the element as it was.
 *
 * @param controller - The controller name
 * @param attributes - The extra attributes, if any
 * @returns Each attribute name with the value to write
 * @throws TypeError when the controller is unknown or an attribute is refused
 */
export function resolveAddedAttributes(
    controller: ControllerName,
    attributes: EzClassifyAttributes | undefined,
): Map<string, string> {
    if (!CONTROLLER_NAME_SET.has(controller))
        throw new TypeError(
            `[ezclassify] add() names the controller "${String(controller)}", which is not one of: ${CONTROLLER_NAMES.join(', ')}.`,
        );
    const resolved = new Map<string, string>([[CONTROLLER_ATTR, controller]]);
    for (const [key, value] of Object.entries(attributes ?? {})) {
        if (value !== true && typeof value !== 'string')
            throw new TypeError(
                `[ezclassify] add() takes a string, or true for a presence-only attribute, for "${key}".`,
            );
        resolved.set(attributeName(key), value === true ? '' : value);
    }
    return resolved;
}

/**
 * Write `attributes` onto `el`, recording the value each one replaced. An
 * attribute already in `record` keeps the value recorded first, which is the
 * page's own.
 *
 * @param el - The element
 * @param attributes - Attribute names with the values to write
 * @param record - What earlier writes on `el` replaced; extended in place
 */
export function writeAddedAttributes(
    el: HTMLElement,
    attributes: ReadonlyMap<string, string>,
    record: AddedAttributes,
): void {
    for (const [name, value] of attributes) {
        if (!record.has(name)) record.set(name, el.getAttribute(name));
        el.setAttribute(name, value);
    }
}

/**
 * Put back what `record` says `add` replaced: an attribute the page had gets
 * its value back, one it did not have is removed.
 *
 * @param el - The element
 * @param record - What `add` replaced on `el`
 */
export function restoreAddedAttributes(
    el: HTMLElement,
    record: AddedAttributes,
): void {
    for (const [name, previous] of record) {
        if (previous === null) el.removeAttribute(name);
        else el.setAttribute(name, previous);
    }
}
