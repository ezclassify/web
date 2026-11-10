/**
 * How one element reads in the marking tree.
 *
 * A page is a tree of collections, wholes and parts, and the DOM spells it:
 *
 * - The instance root is the page collection. A `data-ezclassify-collection`
 *   container is a collection inside it; the wholes and collections it contains
 *   are its members by nesting. `data-ezclassify-member-of` names a collection
 *   for a whole or collection that does not sit inside it.
 * - A marking host inside a `data-ezclassify-whole` container is a part of that
 *   container's whole, except the host whose DOM id the container names, which
 *   is the whole. `data-ezclassify-part-of` makes a host a part of the named
 *   whole from anywhere else.
 * - A marking host in no `whole` container and with no `part-of` is a whole, a
 *   member of its nearest collection.
 * - A view (`source`, `aggregate`, `bound-to`, `facet-of`, `translate`) shows a
 *   marking or a level and never contributes to one.
 * - Nothing inside a `data-ezclassify-ignore` subtree is read. A marked element
 *   there is a host error.
 *
 * The classifier reads structure and element attributes only. It never reads a
 * marking's text, and where the markup contradicts itself it reports a host
 * error rather than guessing. A host error leaves the element unenhanced and
 * makes every level above it incomplete: an unread marking is never treated as
 * an absent one.
 */

/** Presence: this element is a marking; its DOM id is the marking id. */
export const MARKING_ATTR = 'data-ezclassify-marking';
/** On a container: the hosts inside are parts of the named whole. */
export const WHOLE_ATTR = 'data-ezclassify-whole';
/** On a host: it is a part of the named whole. */
export const PART_OF_ATTR = 'data-ezclassify-part-of';
/** On a container: a collection, identified by the attribute's value. */
export const COLLECTION_ATTR = 'data-ezclassify-collection';
/** On a whole or collection: a member of the named collection. */
export const MEMBER_OF_ATTR = 'data-ezclassify-member-of';
/** On a container: nothing inside is read. */
export const IGNORE_ATTR = 'data-ezclassify-ignore';
/** On a host: processed and validated, but kept out of every roll-up. */
export const NO_ROLLUP_ATTR = 'data-ezclassify-no-rollup';
/** Inherited: the key of the Context a host is read in. */
export const CONTEXT_ATTR = 'data-ezclassify-context';
/** Inherited: the Context-local scheme selector a host is read in. */
export const SCHEME_ATTR = 'data-ezclassify-scheme';
/** The controller a host mounts. */
export const CONTROLLER_ATTR = 'data-ezclassify-controller';

/** Attributes that make an element a view. A view never contributes. */
export const VIEW_ATTRS = [
    'data-ezclassify-bound-to',
    'data-ezclassify-facet-of',
    'data-ezclassify-source',
    'data-ezclassify-aggregate',
    'data-ezclassify-translate',
] as const;

/**
 * Attributes whose change re-derives the subtree they sit on: each one moves a
 * host between levels, Contexts or buckets, or in or out of the tree.
 */
export const STRUCTURAL_ATTRS = [
    WHOLE_ATTR,
    PART_OF_ATTR,
    COLLECTION_ATTR,
    MEMBER_OF_ATTR,
    CONTEXT_ATTR,
    SCHEME_ATTR,
    IGNORE_ATTR,
    NO_ROLLUP_ATTR,
] as const;

/**
 * Controllers that hold a marking of their own when no view attribute points
 * them at another one.
 */
const MARKING_CONTROLLERS: ReadonlySet<string> = new Set([
    'text',
    'marked-input',
    'marking',
    'tags',
]);

/**
 * The controller whose markings are the portions it reads from its text, not
 * the element itself (unless the element is also declared a marking).
 */
const BODY_CONTROLLER = 'marked-textarea';

/** Where an element sits in the marking tree. */
export type BindingKind = 'part' | 'whole' | 'collection' | 'view' | 'ignored';

/** Why an element's markup cannot be read as written. */
export type HostErrorCode =
    /** A marked element inside a `data-ezclassify-ignore` subtree. */
    | 'marked-in-ignore'
    /** A `whole` container with an empty value. */
    | 'whole-unnamed'
    /** A `whole` container names no element on the page. */
    | 'whole-missing'
    /** A `whole` container inside another one. */
    | 'whole-nested'
    /** A collection with an empty value. */
    | 'collection-unnamed'
    /** A collection inside a `whole` container. */
    | 'collection-in-whole'
    /** A collection declared on a marking host. */
    | 'collection-on-marking'
    /** A `part-of` naming another whole than its enclosing container's. */
    | 'part-of-disagrees'
    /** A `part-of` naming a collection or another part. */
    | 'part-of-not-whole'
    /** A `part-of` naming a whole read in another Context or scheme. */
    | 'part-of-across-contexts'
    /** A `part-of` on an element that holds no marking. */
    | 'part-of-not-marking'
    /** A `member-of` naming no collection on the page. */
    | 'member-of-unknown'
    /** A `member-of` on a part; a part belongs to its whole. */
    | 'member-of-on-part'
    /** A `member-of` naming the collection itself or one inside it. */
    | 'member-of-cycle'
    /** `no-rollup` on a part. */
    | 'no-rollup-on-part'
    /** `no-rollup` on a whole that has parts. */
    | 'no-rollup-on-whole-with-parts'
    /** A view attribute and `data-ezclassify-marking` on one element. */
    | 'marking-on-view'
    /** A nested library instance mounted inside a `whole` container. */
    | 'nested-root-in-whole'
    /** A marking host that resolves no Context. */
    | 'context-unresolved'
    /**
     * A translated view the runtime cannot show: on a form control or a
     * controller host, or with no crosswalk to translate through.
     */
    | 'translate-refused'
    /** Two marking hosts with one id in different Contexts. */
    | 'duplicate-marking-id';

/** A host error: the element stays unenhanced and its levels incomplete. */
export interface HostError {
    code: HostErrorCode;
    /** What is wrong, for the developer reading the console or the event. */
    message: string;
    /** The element whose markup is refused. */
    element: HTMLElement;
}

/** An element's place in the marking tree. */
export interface BindingNode {
    kind: BindingKind;
    /**
     * The marking id of a part or whole, the collection id of a collection;
     * null otherwise, and for a host that has no DOM id yet.
     */
    id: string | null;
    /**
     * For a part: the whole it is a part of. For a body editor that is not a
     * marking itself: the whole its portions are parts of, when it has one.
     */
    wholeId?: string;
    /**
     * For a whole or a collection: the collection it is a member of, null for
     * the page.
     */
    collectionId?: string | null;
    /**
     * The Context key the element names, inherited from the nearest ancestor
     * that sets one; null when none does, so the instance's default applies. A
     * level view (`aggregate`) reads only its own attribute.
     */
    contextKey: string | null;
    /** The Context-local scheme selector, inherited the same way. */
    schemeSelector: string | null;
    /** Whether the element's marking feeds the levels above it. */
    contributes: boolean;
    /** Present when the markup is refused. */
    error?: HostError;
}

/**
 * Whether a presence attribute is set. React writes boolean attributes as
 * `"true"`, and a framework that writes `false` writes `"false"`, which reads
 * as absent.
 *
 * @param el - Element to read
 * @param attr - Attribute name
 * @returns True when the attribute is present and not `"false"`
 */
export function isPresent(el: Element, attr: string): boolean {
    const v = el.getAttribute(attr);
    return v !== null && v.trim().toLowerCase() !== 'false';
}

/** The trimmed value of an attribute, or null when absent or empty. */
function valueOf(el: Element, attr: string): string | null {
    const v = el.getAttribute(attr)?.trim();
    return v ? v : null;
}

/**
 * The nearest element from `el` up to and including `boundary` that carries
 * `attr` (as a presence attribute). Null when none does, or when `el` is not
 * inside `boundary`.
 */
function closestPresent(
    el: Element | null,
    attr: string,
    boundary: Element,
): HTMLElement | null {
    if (!el || !boundary.contains(el)) return null;
    for (let at: Element | null = el; at; at = at.parentElement) {
        if (isPresent(at, attr)) return at as HTMLElement;
        if (at === boundary) break;
    }
    return null;
}

/**
 * The value of `attr` on the nearest element from `el` up that sets it,
 * crossing the instance root: the default Context is markup on an outer
 * element.
 */
function inherited(el: Element, attr: string): string | null {
    const at = el.closest(`[${attr}]`);
    return at ? valueOf(at, attr) : null;
}

/** The first view attribute an element carries, or null. */
export function viewAttrOf(el: Element): string | null {
    for (const attr of VIEW_ATTRS) if (el.hasAttribute(attr)) return attr;
    return null;
}

/**
 * Whether an element holds a marking of its own: it says so with
 * `data-ezclassify-marking`, or it mounts a marking controller that no view
 * attribute points at another marking.
 *
 * @param el - Element to read
 * @returns True for a marking host
 */
export function isMarkingHost(el: Element): boolean {
    if (viewAttrOf(el)) return false;
    return isPresent(el, MARKING_ATTR) || isMarkingController(el);
}

/**
 * Whether an element mounts a controller that holds a marking of its own
 * (`text`, `marked-input`, `marking`, `tags`) and no view attribute points it
 * at another marking.
 *
 * @param el - Element to read
 * @returns True for a marking controller standing on its own
 */
export function isMarkingController(el: Element): boolean {
    const controller = el.getAttribute(CONTROLLER_ATTR);
    return (
        controller !== null &&
        MARKING_CONTROLLERS.has(controller) &&
        !viewAttrOf(el)
    );
}

/** A body editor whose portions are its markings. */
function isBodyEditor(el: Element): boolean {
    return (
        el.getAttribute(CONTROLLER_ATTR) === BODY_CONTROLLER &&
        !isMarkingHost(el) &&
        !viewAttrOf(el)
    );
}

/** The collection element with the given id inside `root`, or null. */
function collectionNamed(root: HTMLElement, id: string): HTMLElement | null {
    for (const el of Array.from(
        root.querySelectorAll<HTMLElement>(`[${COLLECTION_ATTR}]`),
    ))
        if (valueOf(el, COLLECTION_ATTR) === id) return el;
    if (valueOf(root, COLLECTION_ATTR) === id) return root;
    return null;
}

/** Whether any element on the page declares a part of `wholeId`. */
function hasParts(root: HTMLElement, wholeId: string): boolean {
    for (const attr of [WHOLE_ATTR, PART_OF_ATTR])
        for (const el of Array.from(root.querySelectorAll(`[${attr}]`)))
            if (valueOf(el, attr) === wholeId) return true;
    return false;
}

/** Build a host error for `el`. */
function hostError(
    el: HTMLElement,
    code: HostErrorCode,
    message: string,
): HostError {
    return { code, message: `[ezclassify] ${message}`, element: el };
}

/** A short description of an element for an error message. */
function describe(el: HTMLElement): string {
    const tag = el.tagName.toLowerCase();
    if (el.id) return `<${tag} id="${el.id}">`;
    const controller = el.getAttribute(CONTROLLER_ATTR);
    return controller
        ? `<${tag} ${CONTROLLER_ATTR}="${controller}">`
        : `<${tag}>`;
}

/**
 * The nearest collection a whole or collection at `from` is a member of by
 * nesting, inside `root`; null for the page.
 */
function nestingCollection(from: Element | null, root: HTMLElement) {
    const at = closestPresent(from, COLLECTION_ATTR, root);
    return at ? valueOf(at, COLLECTION_ATTR) : null;
}

/** The Context and scheme selector an element is read in. */
function bucketOf(el: HTMLElement): {
    contextKey: string | null;
    schemeSelector: string | null;
} {
    // A level view filters buckets only by its own attributes, so a default
    // Context on an outer element cannot hide another Context's bucket.
    if (el.hasAttribute('data-ezclassify-aggregate'))
        return {
            contextKey: valueOf(el, CONTEXT_ATTR),
            schemeSelector: valueOf(el, SCHEME_ATTR),
        };
    return {
        contextKey: inherited(el, CONTEXT_ATTR),
        schemeSelector: inherited(el, SCHEME_ATTR),
    };
}

/**
 * The whole an element inside a `whole` container or carrying `part-of` is a
 * part of, with the refusals that apply to a part.
 */
function placeAsPart(
    el: HTMLElement,
    root: HTMLElement,
    bucket: { contextKey: string | null; schemeSelector: string | null },
): { wholeId?: string; isWhole?: boolean; error?: HostError } {
    const partOf = valueOf(el, PART_OF_ATTR);
    const container = closestPresent(el, WHOLE_ATTR, root);
    let wholeId: string | undefined;
    if (container) {
        if (closestPresent(container.parentElement, WHOLE_ATTR, root))
            return {
                error: hostError(
                    el,
                    'whole-nested',
                    `${describe(container)} declares ${WHOLE_ATTR} inside another ${WHOLE_ATTR} container. A whole's parts cannot hold parts of their own.`,
                ),
            };
        const named = valueOf(container, WHOLE_ATTR);
        if (!named)
            return {
                error: hostError(
                    el,
                    'whole-unnamed',
                    `${describe(container)} declares ${WHOLE_ATTR} without naming its whole.`,
                ),
            };
        if (!el.ownerDocument.getElementById(named))
            return {
                error: hostError(
                    el,
                    'whole-missing',
                    `${describe(container)} names the whole "${named}", and no element has that id.`,
                ),
            };
        const between = closestPresent(el, COLLECTION_ATTR, container);
        if (between)
            return {
                error: hostError(
                    el,
                    'collection-in-whole',
                    `${describe(between)} declares a collection inside the ${WHOLE_ATTR} container of "${named}". A whole holds parts, not collections.`,
                ),
            };
        if (el.id === named) {
            if (partOf)
                return {
                    error: hostError(
                        el,
                        'part-of-disagrees',
                        `${describe(el)} is the whole its container names, and it also declares ${PART_OF_ATTR}="${partOf}".`,
                    ),
                };
            return { isWhole: true };
        }
        if (partOf && partOf !== named)
            return {
                error: hostError(
                    el,
                    'part-of-disagrees',
                    `${describe(el)} declares ${PART_OF_ATTR}="${partOf}" inside the ${WHOLE_ATTR} container of "${named}".`,
                ),
            };
        wholeId = named;
    } else if (partOf) {
        wholeId = partOf;
    } else {
        return {};
    }

    if (collectionNamed(root, wholeId))
        return {
            error: hostError(
                el,
                'part-of-not-whole',
                `${describe(el)} is a part of "${wholeId}", which is a collection. A part belongs to a whole; use ${MEMBER_OF_ATTR} for a whole in a collection.`,
            ),
        };
    const target = el.ownerDocument.getElementById(wholeId);
    if (target && root.contains(target)) {
        const targetContainer = closestPresent(target, WHOLE_ATTR, root);
        const targetIsPart =
            valueOf(target, PART_OF_ATTR) !== null ||
            (targetContainer !== null &&
                valueOf(targetContainer, WHOLE_ATTR) !== target.id);
        if (targetIsPart)
            return {
                error: hostError(
                    el,
                    'part-of-not-whole',
                    `${describe(el)} is a part of "${wholeId}", which is itself a part.`,
                ),
            };
        const targetBucket = bucketOf(target);
        if (
            targetBucket.contextKey !== bucket.contextKey ||
            targetBucket.schemeSelector !== bucket.schemeSelector
        )
            return {
                error: hostError(
                    el,
                    'part-of-across-contexts',
                    `${describe(el)} is a part of "${wholeId}", which is read in another Context or scheme. A part and its whole share one.`,
                ),
            };
    }
    return { wholeId };
}

/**
 * Where an element sits in the marking tree.
 *
 * A bare collection container (no controller, marking or view attribute) reads
 * as `collection`; for an element that carries a collection and a view, read
 * its collection with {@link describeCollection}.
 *
 * @param el - Element to classify
 * @param root - The instance root, the page collection
 * @returns The element's node; `error` is set when the markup is refused
 */
export function classify(el: HTMLElement, root: HTMLElement): BindingNode {
    const bucket = bucketOf(el);
    const base = { id: null, contributes: false, ...bucket };

    const ignored = closestPresent(el, IGNORE_ATTR, root);
    if (ignored) {
        const onlyIgnore =
            ignored === el &&
            Array.from(el.attributes).every(
                (a) =>
                    !a.name.startsWith('data-ezclassify-') ||
                    a.name === IGNORE_ATTR,
            );
        return onlyIgnore
            ? { ...base, kind: 'ignored' }
            : {
                  ...base,
                  kind: 'ignored',
                  error: hostError(
                      el,
                      'marked-in-ignore',
                      `${describe(el)} is marked inside a ${IGNORE_ATTR} region, where nothing is read. Move it out of the region or remove its markup.`,
                  ),
              };
    }

    const view = viewAttrOf(el);
    if (view) {
        if (isPresent(el, MARKING_ATTR))
            return {
                ...base,
                kind: 'view',
                error: hostError(
                    el,
                    'marking-on-view',
                    `${describe(el)} declares ${MARKING_ATTR} and ${view}. A view shows a marking; it is not one.`,
                ),
            };
        return { ...base, kind: 'view' };
    }

    if (isMarkingHost(el)) return classifyHost(el, root, bucket);

    if (isBodyEditor(el)) {
        const placed = placeAsPart(el, root, bucket);
        if (placed.error) return { ...base, kind: 'view', error: placed.error };
        return {
            ...base,
            kind: 'view',
            wholeId: placed.wholeId,
            collectionId: placed.wholeId
                ? undefined
                : nestingCollection(el, root),
        };
    }

    if (valueOf(el, PART_OF_ATTR))
        return {
            ...base,
            kind: 'view',
            error: hostError(
                el,
                'part-of-not-marking',
                `${describe(el)} declares ${PART_OF_ATTR} but holds no marking. Add ${MARKING_ATTR} or a marking controller.`,
            ),
        };

    if (el.hasAttribute(COLLECTION_ATTR) && !el.hasAttribute(CONTROLLER_ATTR)) {
        const collection = describeCollection(el, root);
        if (collection) return collection;
    }

    return { ...base, kind: 'view' };
}

/** Classify a marking host: a part, or a whole in a collection. */
function classifyHost(
    el: HTMLElement,
    root: HTMLElement,
    bucket: { contextKey: string | null; schemeSelector: string | null },
): BindingNode {
    const base = { id: el.id || null, contributes: false, ...bucket };
    if (el.hasAttribute(COLLECTION_ATTR))
        return {
            ...base,
            kind: 'whole',
            error: hostError(
                el,
                'collection-on-marking',
                `${describe(el)} is a marking and declares ${COLLECTION_ATTR}. Put the collection on a container.`,
            ),
        };
    const placed = placeAsPart(el, root, bucket);
    const noRollup = isPresent(el, NO_ROLLUP_ATTR);
    const memberOf = valueOf(el, MEMBER_OF_ATTR);

    if (placed.wholeId !== undefined || placed.error) {
        if (placed.error) return { ...base, kind: 'part', error: placed.error };
        if (memberOf)
            return {
                ...base,
                kind: 'part',
                wholeId: placed.wholeId,
                error: hostError(
                    el,
                    'member-of-on-part',
                    `${describe(el)} is a part of "${placed.wholeId}" and declares ${MEMBER_OF_ATTR}="${memberOf}". A part belongs to its whole.`,
                ),
            };
        if (noRollup)
            return {
                ...base,
                kind: 'part',
                wholeId: placed.wholeId,
                error: hostError(
                    el,
                    'no-rollup-on-part',
                    `${describe(el)} is a part of "${placed.wholeId}" and declares ${NO_ROLLUP_ATTR}. A part always counts toward its whole.`,
                ),
            };
        return {
            ...base,
            kind: 'part',
            wholeId: placed.wholeId,
            contributes: true,
        };
    }

    if (noRollup && el.id && hasParts(root, el.id))
        return {
            ...base,
            kind: 'whole',
            error: hostError(
                el,
                'no-rollup-on-whole-with-parts',
                `${describe(el)} has parts and declares ${NO_ROLLUP_ATTR}. A whole with parts always counts toward its collection.`,
            ),
        };

    let collectionId: string | null;
    if (memberOf) {
        if (!collectionNamed(root, memberOf))
            return {
                ...base,
                kind: 'whole',
                error: hostError(
                    el,
                    'member-of-unknown',
                    `${describe(el)} declares ${MEMBER_OF_ATTR}="${memberOf}", and no ${COLLECTION_ATTR} has that id.`,
                ),
            };
        collectionId = memberOf;
    } else {
        // The whole host inside its own container is a member of the
        // container's collection.
        collectionId = nestingCollection(el, root);
    }
    return { ...base, kind: 'whole', collectionId, contributes: !noRollup };
}

/**
 * The collection an element declares with `data-ezclassify-collection`, or null
 * when it declares none.
 *
 * @param el - Element carrying the collection attribute
 * @param root - The instance root, the page collection
 * @returns The collection node; `error` is set when the markup is refused
 */
export function describeCollection(
    el: HTMLElement,
    root: HTMLElement,
): BindingNode | null {
    if (!el.hasAttribute(COLLECTION_ATTR)) return null;
    const base = {
        kind: 'collection' as const,
        contributes: false,
        contextKey: inherited(el, CONTEXT_ATTR),
        schemeSelector: inherited(el, SCHEME_ATTR),
    };
    const id = valueOf(el, COLLECTION_ATTR);
    if (!id)
        return {
            ...base,
            id: null,
            error: hostError(
                el,
                'collection-unnamed',
                `${describe(el)} declares ${COLLECTION_ATTR} without an id. Write ${COLLECTION_ATTR}="<id>".`,
            ),
        };
    if (closestPresent(el, IGNORE_ATTR, root))
        return {
            ...base,
            id,
            error: hostError(
                el,
                'marked-in-ignore',
                `Collection "${id}" is declared inside a ${IGNORE_ATTR} region, where nothing is read.`,
            ),
        };
    if (closestPresent(el, WHOLE_ATTR, root))
        return {
            ...base,
            id,
            error: hostError(
                el,
                'collection-in-whole',
                `Collection "${id}" is declared inside a ${WHOLE_ATTR} container. A whole holds parts, not collections.`,
            ),
        };
    const memberOf = valueOf(el, MEMBER_OF_ATTR);
    if (memberOf) {
        const target = collectionNamed(root, memberOf);
        if (!target)
            return {
                ...base,
                id,
                error: hostError(
                    el,
                    'member-of-unknown',
                    `Collection "${id}" declares ${MEMBER_OF_ATTR}="${memberOf}", and no ${COLLECTION_ATTR} has that id.`,
                ),
            };
        if (el.contains(target))
            return {
                ...base,
                id,
                error: hostError(
                    el,
                    'member-of-cycle',
                    `Collection "${id}" declares ${MEMBER_OF_ATTR}="${memberOf}", which is itself or inside it.`,
                ),
            };
        return { ...base, id, collectionId: memberOf };
    }
    return {
        ...base,
        id,
        collectionId: nestingCollection(el.parentElement, root),
    };
}

/**
 * Where a nested library instance mounted at `childRoot` contributes inside its
 * parent instance's tree: the parent's nearest collection, or the page.
 *
 * @param childRoot - The nested instance's root element
 * @param parentRoot - The enclosing instance's root element
 * @returns The collection id (null for the page), or a host error when the
 *   nested root sits inside a `whole` container
 */
export function placeNestedRoot(
    childRoot: HTMLElement,
    parentRoot: HTMLElement,
): { collectionId: string | null; error?: HostError } {
    const container = closestPresent(
        childRoot.parentElement,
        WHOLE_ATTR,
        parentRoot,
    );
    if (container)
        return {
            collectionId: null,
            error: hostError(
                childRoot,
                'nested-root-in-whole',
                `A nested EzClassify instance is mounted inside the ${WHOLE_ATTR} container of "${valueOf(container, WHOLE_ATTR) ?? ''}". Mount it outside the whole, or let the enclosing instance read those fields.`,
            ),
        };
    return {
        collectionId: nestingCollection(childRoot.parentElement, parentRoot),
    };
}

/**
 * The whole the marking a host holds is a part of, read from structure:
 * `part-of`, or the enclosing `whole` container when the host is not the whole
 * it names. Null for a whole, a view and a host error alike; the classifier is
 * what refuses contradictory markup.
 *
 * @param el - A marking host or a body editor
 * @returns The whole's id, or null
 */
export function partWholeOf(el: Element): string | null {
    if (!isMarkingHost(el) && !isBodyEditor(el)) return null;
    const partOf = valueOf(el, PART_OF_ATTR);
    if (partOf) return partOf;
    const container = el.closest(`[${WHOLE_ATTR}]`);
    if (!container || !isPresent(container, WHOLE_ATTR)) return null;
    const named = valueOf(container, WHOLE_ATTR);
    return named && named !== el.id ? named : null;
}
