/**
 * Constructable-stylesheet adoption for every stylesheet this library applies
 * at runtime.
 *
 * A CSSStyleSheet built with replaceSync and attached through
 * adoptedStyleSheets creates no inline style element, allowing stylesheet
 * adoption under style-src 'self'.
 *
 * Adoption targets a document or shadow root, not an arbitrary element. A
 * container supplies its root node; light-DOM styles apply document-wide.
 *
 * - One sheet is built per distinct CSS text per document and shared by every
 *   root that adopts it. Adoption is reference counted per root, so the
 *   twentieth component to adopt the same sheet costs a counter increment and
 *   the last one to release it is the one that detaches it.
 *
 * There is deliberately no `<style>` fallback for browsers without
 * constructable stylesheets. A fallback would quietly put the inline stylesheet
 * back and quietly reintroduce the CSP requirement, so an unsupported browser
 * gets a thrown error at first use instead.
 */

/** A root that can own adopted stylesheets. */
type StyleRoot = Document | ShadowRoot;

/** Handle returned by {@link adoptStyles}; release it during teardown. */
export interface AdoptedStyles {
    /** The shared sheet this handle holds a reference to. */
    readonly sheet: CSSStyleSheet;
    /**
     * Drop this handle's reference. The sheet leaves the root's
     * `adoptedStyleSheets` when the last handle for that root is released.
     * Calling it more than once is a no-op.
     */
    release(): void;
}

/** Minimum browser versions for `new CSSStyleSheet()` + `adoptedStyleSheets`. */
const SUPPORT_MESSAGE =
    '@ezclassify/ui requires constructable stylesheets ' +
    '(new CSSStyleSheet() with adoptedStyleSheets): Chrome 73+, Edge 79+, ' +
    'Firefox 101+, Safari 16.4+. The library does not fall back to inline ' +
    'style elements, because that would silently require ' +
    "style-src 'unsafe-inline' in the host's Content Security Policy.";

/** One sheet per CSS text per document. */
const sheetsByDocument = new WeakMap<Document, Map<string, CSSStyleSheet>>();

/** CSS text behind each sheet this module built, for {@link adoptedStyleTexts}. */
const cssBySheet = new WeakMap<CSSStyleSheet, string>();

/** Live reference counts per root, so the last release detaches the sheet. */
const countsByRoot = new WeakMap<StyleRoot, Map<CSSStyleSheet, number>>();

/** Sheets adopted permanently by {@link adoptStylesOnce}, per root. */
const permanentByRoot = new WeakMap<StyleRoot, Set<CSSStyleSheet>>();

/** True when the current environment can construct and adopt stylesheets. */
export function supportsAdoptedStyleSheets(): boolean {
    return (
        typeof CSSStyleSheet !== 'undefined' &&
        typeof CSSStyleSheet.prototype.replaceSync === 'function' &&
        typeof Document !== 'undefined' &&
        'adoptedStyleSheets' in Document.prototype
    );
}

function assertSupported(): void {
    if (!supportsAdoptedStyleSheets()) throw new Error(SUPPORT_MESSAGE);
}

function isStyleRoot(node: Node | null | undefined): node is StyleRoot {
    return (
        !!node &&
        (node.nodeType === Node.DOCUMENT_NODE ||
            (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE &&
                'adoptedStyleSheets' in node))
    );
}

/**
 * Resolve the document or shadow root that should own the sheet.
 *
 * A detached element has no usable root node, so it falls back to its owner
 * document: the element is about to be attached there, and the rules are
 * document wide either way. The same fallback covers a host that hands us
 * something element-shaped but not a live node.
 */
function resolveStyleRoot(target?: Node | null): StyleRoot {
    if (!target) return document;
    if (isStyleRoot(target)) return target;
    if (typeof target.getRootNode === 'function') {
        const root = target.getRootNode();
        if (isStyleRoot(root)) return root;
    }
    return target.ownerDocument ?? document;
}

function documentOf(root: StyleRoot): Document {
    return root.nodeType === Node.DOCUMENT_NODE
        ? (root as Document)
        : ((root as ShadowRoot).ownerDocument ?? document);
}

/**
 * Build (or reuse) the sheet for this CSS text in this document.
 *
 * The sheet is constructed with the owning document's own `CSSStyleSheet`, so a
 * shadow root living in another document (an iframe, a print view) adopts a
 * sheet that document will accept.
 */
function sheetFor(root: StyleRoot, css: string): CSSStyleSheet {
    const doc = documentOf(root);
    let byCss = sheetsByDocument.get(doc);
    if (!byCss) {
        byCss = new Map<string, CSSStyleSheet>();
        sheetsByDocument.set(doc, byCss);
    }
    const cached = byCss.get(css);
    if (cached) return cached;
    const Ctor = doc.defaultView?.CSSStyleSheet ?? CSSStyleSheet;
    const sheet = new Ctor();
    sheet.replaceSync(css);
    byCss.set(css, sheet);
    cssBySheet.set(sheet, css);
    return sheet;
}

function attach(root: StyleRoot, sheet: CSSStyleSheet): void {
    if (root.adoptedStyleSheets.includes(sheet)) return;
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
}

function detach(root: StyleRoot, sheet: CSSStyleSheet): void {
    if (!root.adoptedStyleSheets.includes(sheet)) return;
    root.adoptedStyleSheets = root.adoptedStyleSheets.filter(
        (s) => s !== sheet,
    );
}

/**
 * Adopt `css` onto the root that owns `target`, and return a handle whose
 * `release()` reverses exactly this adoption.
 *
 * @param css - Stylesheet text, normally an `?inline` CSS import
 * @param target - Element, document, or shadow root naming the root to adopt
 *   onto. Defaults to the global document.
 * @throws When the browser has no constructable stylesheets
 */
export function adoptStyles(css: string, target?: Node | null): AdoptedStyles {
    assertSupported();
    const root = resolveStyleRoot(target);
    const sheet = sheetFor(root, css);

    let counts = countsByRoot.get(root);
    if (!counts) {
        counts = new Map<CSSStyleSheet, number>();
        countsByRoot.set(root, counts);
    }
    counts.set(sheet, (counts.get(sheet) ?? 0) + 1);
    attach(root, sheet);

    let released = false;
    return {
        sheet,
        release(): void {
            if (released) return;
            released = true;
            const live = countsByRoot.get(root);
            const remaining = (live?.get(sheet) ?? 0) - 1;
            if (remaining > 0) {
                live?.set(sheet, remaining);
                return;
            }
            live?.delete(sheet);
            if (permanentByRoot.get(root)?.has(sheet)) return;
            detach(root, sheet);
        },
    };
}

/**
 * Adopt `css` onto the root that owns `target` for the lifetime of that root.
 *
 * The stylesheet's lifetime follows the root, unlike a page-level `<style>`
 * element that nothing tears down. Repeat calls with the same CSS and root do
 * nothing.
 *
 * @param css - Stylesheet text, normally an `?inline` CSS import
 * @param target - Element, document, or shadow root naming the root to adopt
 *   onto. Defaults to the global document.
 * @throws When the browser has no constructable stylesheets
 */
export function adoptStylesOnce(css: string, target?: Node | null): void {
    assertSupported();
    const root = resolveStyleRoot(target);
    const sheet = sheetFor(root, css);
    let permanent = permanentByRoot.get(root);
    if (!permanent) {
        permanent = new Set<CSSStyleSheet>();
        permanentByRoot.set(root, permanent);
    }
    if (permanent.has(sheet)) return;
    permanent.add(sheet);
    attach(root, sheet);
}

/**
 * The CSS texts this module currently has adopted on the root that owns
 * `target`, in adoption order. Diagnostic helper; sheets a host adopted on its
 * own are not listed.
 */
export function adoptedStyleTexts(target?: Node | null): string[] {
    if (!supportsAdoptedStyleSheets()) return [];
    const root = resolveStyleRoot(target);
    const texts: string[] = [];
    for (const sheet of root.adoptedStyleSheets) {
        const css = cssBySheet.get(sheet);
        if (css !== undefined) texts.push(css);
    }
    return texts;
}

/**
 * Whether `css` is currently adopted on the root that owns `target`. Test and
 * diagnostic helper; components should hold their handle instead.
 */
export function hasAdoptedStyles(css: string, target?: Node | null): boolean {
    if (!supportsAdoptedStyleSheets()) return false;
    const root = resolveStyleRoot(target);
    const sheet = sheetsByDocument.get(documentOf(root))?.get(css);
    return !!sheet && root.adoptedStyleSheets.includes(sheet);
}
