/**
 * Jsdom shim for constructable stylesheets.
 *
 * `@ezclassify/ui` applies every runtime stylesheet through `new
 * CSSStyleSheet()` and `adoptedStyleSheets` so a host page never needs
 * `style-src 'unsafe-inline'`. jsdom implements neither `replaceSync` nor
 * `adoptedStyleSheets` (checked against jsdom 26), and the library throws
 * rather than falling back to a `<style>` element, so the unit tiers install
 * this shim.
 *
 * It is a bookkeeping shim, not a CSS engine: it records the text handed to
 * `replaceSync` and keeps the adopted list per root. jsdom's `getComputedStyle`
 * never applied an injected `<style>` element's rules either (see the notes in
 * `libs/ui/src/styles.spec.ts`), so no cascade behavior is lost.
 */

interface ShimmedSheet extends CSSStyleSheet {
    __ezCssText?: string;
}

if (
    typeof CSSStyleSheet !== 'undefined' &&
    typeof CSSStyleSheet.prototype.replaceSync !== 'function'
) {
    CSSStyleSheet.prototype.replaceSync = function (this: ShimmedSheet, text) {
        this.__ezCssText = text;
    };
    CSSStyleSheet.prototype.replace = function (this: ShimmedSheet, text) {
        this.replaceSync(text);
        return Promise.resolve(this);
    };
}

function defineAdoptedStyleSheets(proto: object | undefined): void {
    if (!proto || 'adoptedStyleSheets' in proto) return;
    const lists = new WeakMap<object, readonly CSSStyleSheet[]>();
    Object.defineProperty(proto, 'adoptedStyleSheets', {
        configurable: true,
        get(this: object): readonly CSSStyleSheet[] {
            return lists.get(this) ?? [];
        },
        set(this: object, value: readonly CSSStyleSheet[]) {
            lists.set(this, Object.freeze([...value]));
        },
    });
}

if (typeof Document !== 'undefined') {
    defineAdoptedStyleSheets(Document.prototype);
}
if (typeof ShadowRoot !== 'undefined') {
    defineAdoptedStyleSheets(ShadowRoot.prototype);
}
