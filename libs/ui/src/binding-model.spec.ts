import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    classify,
    describeCollection,
    isMarkingHost,
    isStandalonePart,
    listsBuckets,
    partWholeOf,
    placeNestedRoot,
} from './binding-model';

let root: HTMLDivElement;

beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
});

afterEach(() => {
    root.remove();
});

function el(id: string): HTMLElement {
    const found = root.querySelector<HTMLElement>(`#${id}`);
    if (!found) throw new Error(`no #${id}`);
    return found;
}

describe('classify: a part whose whole is not on the page', () => {
    it.each([
        '<input id="p" data-ezclassify-marking data-ezclassify-role="part">',
        '<input id="p" data-ezclassify-controller="marking" data-ezclassify-role="part">',
        '<input id="p" data-ezclassify-controller="tags" data-ezclassify-role="part">',
        '<input id="p" data-ezclassify-controller="marked-input" data-ezclassify-role="part">',
        '<code id="p" data-ezclassify-controller="text" data-ezclassify-role="part"></code>',
    ])('reads %s as a part that contributes to nothing', (markup) => {
        root.innerHTML = markup;

        const node = classify(el('p'), root);

        expect(node).toMatchObject({
            kind: 'part',
            id: 'p',
            contributes: false,
        });
        expect(node.wholeId).toBeUndefined();
        expect(node.error).toBeUndefined();
        expect(isStandalonePart(el('p'))).toBe(true);
    });

    it('lets structure name the whole when there is one', () => {
        root.innerHTML = `
            <input id="doc" data-ezclassify-marking>
            <input id="p" data-ezclassify-marking data-ezclassify-part-of="doc" data-ezclassify-role="part">`;

        expect(classify(el('p'), root)).toMatchObject({
            kind: 'part',
            wholeId: 'doc',
            contributes: true,
        });
        expect(isStandalonePart(el('p'))).toBe(false);
    });

    it('reads any other role as no role', () => {
        root.innerHTML =
            '<input id="p" data-ezclassify-marking data-ezclassify-role="whole">';

        expect(classify(el('p'), root)).toMatchObject({
            kind: 'whole',
            contributes: true,
        });
    });

    it.each([
        [
            'the whole its container names',
            '<form data-ezclassify-whole="p"><input id="p" data-ezclassify-marking data-ezclassify-role="part"></form>',
        ],
        [
            'a member of a collection',
            '<div data-ezclassify-collection="f"></div><input id="p" data-ezclassify-marking data-ezclassify-member-of="f" data-ezclassify-role="part">',
        ],
        [
            'a body editor that is a marking',
            '<textarea id="p" data-ezclassify-controller="marked-textarea" data-ezclassify-marking data-ezclassify-role="part"></textarea>',
        ],
        [
            'a body editor',
            '<textarea id="p" data-ezclassify-controller="marked-textarea" data-ezclassify-role="part"></textarea>',
        ],
        [
            'a member of a collection it sits in',
            '<div data-ezclassify-collection="c"><input id="p" data-ezclassify-marking data-ezclassify-role="part"></div>',
        ],
        [
            'a hidden input',
            '<input id="p" type="hidden" data-ezclassify-marking data-ezclassify-role="part">',
        ],
    ])('refuses the part role on %s', (_what, markup) => {
        root.innerHTML = markup;

        expect(classify(el('p'), root).error?.code).toBe('part-role-refused');
    });

    it('refuses a part of one, which is itself a part', () => {
        root.innerHTML = `
            <input id="p" data-ezclassify-marking data-ezclassify-role="part">
            <input id="c" data-ezclassify-marking data-ezclassify-part-of="p">`;

        expect(classify(el('c'), root).error?.code).toBe('part-of-not-whole');
    });

    it.each(['bound-to', 'facet-of', 'source'])(
        'refuses a %s view of one',
        (attr) => {
            root.innerHTML = `
                <input id="p" data-ezclassify-marking data-ezclassify-role="part">
                <input id="v" data-ezclassify-${attr}="p">`;

            expect(classify(el('v'), root).error?.code).toBe(
                'view-of-standalone-part',
            );
        },
    );
});

describe('listsBuckets', () => {
    it.each([
        [
            '<div id="v" data-ezclassify-controller="banner" data-ezclassify-aggregate></div>',
            true,
        ],
        [
            '<div id="v" data-ezclassify-controller="banner" data-ezclassify-aggregate="doc"></div>',
            true,
        ],
        [
            '<code id="v" data-ezclassify-controller="text" data-ezclassify-aggregate></code>',
            false,
        ],
        ['<input id="v" type="hidden" data-ezclassify-aggregate>', false],
        [
            '<div id="v" data-ezclassify-controller="banner" data-ezclassify-source="doc"></div>',
            false,
        ],
        [
            '<div id="v" data-ezclassify-controller="banner" data-ezclassify-aggregate data-ezclassify-translate="x"></div>',
            false,
        ],
        [
            '<div id="v" data-ezclassify-controller="banner" data-ezclassify-aggregate data-ezclassify-scheme="tier"></div>',
            false,
        ],
    ])('reads %s as %s', (markup, expected) => {
        root.innerHTML = markup;

        expect(listsBuckets(el('v'))).toBe(expected);
    });
});

describe('classify: wholes and parts', () => {
    it('reads the hosts in a whole container as parts of the whole it names', () => {
        root.innerHTML = `
            <form data-ezclassify-whole="doc">
                <input id="doc" data-ezclassify-controller="marking">
                <input id="p1" data-ezclassify-controller="marking">
                <input id="p2" data-ezclassify-controller="tags">
                <input id="p3" type="hidden" data-ezclassify-marking>
            </form>`;
        expect(classify(el('doc'), root)).toMatchObject({
            kind: 'whole',
            id: 'doc',
            collectionId: null,
            contributes: true,
        });
        for (const id of ['p1', 'p2', 'p3'])
            expect(classify(el(id), root)).toMatchObject({
                kind: 'part',
                id,
                wholeId: 'doc',
                contributes: true,
            });
    });

    it('reads a host in no whole container as a whole of the page', () => {
        root.innerHTML = `<input id="a" data-ezclassify-controller="marking">`;
        expect(classify(el('a'), root)).toMatchObject({
            kind: 'whole',
            collectionId: null,
        });
    });

    it('reads part-of as a part from outside the whole container', () => {
        root.innerHTML = `
            <input id="doc" data-ezclassify-controller="marking">
            <input id="p" data-ezclassify-marking data-ezclassify-part-of="doc">`;
        expect(classify(el('p'), root)).toMatchObject({
            kind: 'part',
            wholeId: 'doc',
        });
    });

    it('routes a body editor in a whole container to that whole without making it a marking', () => {
        root.innerHTML = `
            <form data-ezclassify-whole="doc">
                <input id="doc" data-ezclassify-controller="marking">
                <textarea id="body" data-ezclassify-controller="marked-textarea"></textarea>
            </form>`;
        expect(classify(el('body'), root)).toMatchObject({
            kind: 'view',
            wholeId: 'doc',
            contributes: false,
        });
    });

    it('reads data-ezclassify-marking="false" as no marking', () => {
        root.innerHTML = `<input id="a" data-ezclassify-marking="false">`;
        expect(isMarkingHost(el('a'))).toBe(false);
    });
});

describe('classify: views never contribute', () => {
    it.each([
        ['source', 'data-ezclassify-source="doc"'],
        ['aggregate', 'data-ezclassify-aggregate'],
        ['bound-to', 'data-ezclassify-bound-to="doc"'],
        [
            'facet-of',
            'data-ezclassify-facet-of="doc" data-ezclassify-category="c"',
        ],
        ['translate', 'data-ezclassify-translate="cw"'],
    ])('a %s view inside a whole container is a view', (_name, attrs) => {
        root.innerHTML = `
            <form data-ezclassify-whole="doc">
                <input id="doc" data-ezclassify-controller="marking">
                <input id="v" type="hidden" ${attrs}>
            </form>`;
        const node = classify(el('v'), root);
        expect(node.kind).toBe('view');
        expect(node.contributes).toBe(false);
        expect(node.error).toBeUndefined();
    });

    it('a marking controller pointed at another marking is a view', () => {
        root.innerHTML = `
            <input id="doc" data-ezclassify-controller="marking">
            <input id="v" data-ezclassify-controller="tags" data-ezclassify-bound-to="doc">`;
        expect(classify(el('v'), root).kind).toBe('view');
    });

    it('refuses a view that also declares itself a marking', () => {
        root.innerHTML = `<input id="v" type="hidden" data-ezclassify-aggregate data-ezclassify-marking>`;
        expect(classify(el('v'), root).error?.code).toBe('marking-on-view');
    });

    it('a level view reads only its own Context and scheme', () => {
        root.innerHTML = `
            <div data-ezclassify-context="capco" data-ezclassify-scheme="tier">
                <div id="page" data-ezclassify-aggregate></div>
                <div id="cui" data-ezclassify-aggregate data-ezclassify-context="cui"></div>
                <input id="m" data-ezclassify-controller="marking">
            </div>`;
        expect(classify(el('page'), root)).toMatchObject({
            contextKey: null,
            schemeSelector: null,
        });
        expect(classify(el('cui'), root)).toMatchObject({
            contextKey: 'cui',
            schemeSelector: null,
        });
        expect(classify(el('m'), root)).toMatchObject({
            contextKey: 'capco',
            schemeSelector: 'tier',
        });
    });
});

describe('classify: collections', () => {
    it('places wholes in their nearest collection by nesting', () => {
        root.innerHTML = `
            <section id="A" data-ezclassify-collection="folderA">
                <article data-ezclassify-whole="memo1">
                    <input id="memo1" data-ezclassify-controller="marking">
                    <input id="p" data-ezclassify-controller="marking">
                </article>
                <input id="memo2" data-ezclassify-controller="marking">
                <section id="B" data-ezclassify-collection="folderB">
                    <input id="memo3" data-ezclassify-controller="marking">
                </section>
            </section>`;
        expect(classify(el('memo1'), root).collectionId).toBe('folderA');
        expect(classify(el('memo2'), root).collectionId).toBe('folderA');
        expect(classify(el('memo3'), root).collectionId).toBe('folderB');
        expect(classify(el('p'), root).collectionId).toBeUndefined();
        expect(classify(el('A'), root)).toMatchObject({
            kind: 'collection',
            id: 'folderA',
            collectionId: null,
        });
        expect(describeCollection(el('B'), root)).toMatchObject({
            id: 'folderB',
            collectionId: 'folderA',
        });
    });

    it('places a whole in the collection member-of names', () => {
        root.innerHTML = `
            <section data-ezclassify-collection="folderA"></section>
            <input id="m" data-ezclassify-controller="marking" data-ezclassify-member-of="folderA">`;
        expect(classify(el('m'), root)).toMatchObject({
            kind: 'whole',
            collectionId: 'folderA',
        });
    });

    it('refuses a member-of naming no collection', () => {
        root.innerHTML = `<input id="m" data-ezclassify-controller="marking" data-ezclassify-member-of="nowhere">`;
        expect(classify(el('m'), root).error?.code).toBe('member-of-unknown');
    });

    it('refuses a member-of on a part', () => {
        root.innerHTML = `
            <section data-ezclassify-collection="folderA"></section>
            <input id="doc" data-ezclassify-controller="marking">
            <input id="p" data-ezclassify-marking data-ezclassify-part-of="doc" data-ezclassify-member-of="folderA">`;
        expect(classify(el('p'), root).error?.code).toBe('member-of-on-part');
    });

    it('refuses a collection inside a whole container, and the hosts it holds', () => {
        root.innerHTML = `
            <form data-ezclassify-whole="doc">
                <input id="doc" data-ezclassify-controller="marking">
                <section id="c" data-ezclassify-collection="inner">
                    <input id="p" data-ezclassify-controller="marking">
                </section>
            </form>`;
        expect(describeCollection(el('c'), root)?.error?.code).toBe(
            'collection-in-whole',
        );
        expect(classify(el('p'), root).error?.code).toBe('collection-in-whole');
    });

    it('refuses a collection with no id', () => {
        root.innerHTML = `<section id="c" data-ezclassify-collection></section>`;
        expect(describeCollection(el('c'), root)?.error?.code).toBe(
            'collection-unnamed',
        );
    });

    it('refuses a collection member-of itself or a collection inside it', () => {
        root.innerHTML = `
            <section id="c" data-ezclassify-collection="outer" data-ezclassify-member-of="inner">
                <section data-ezclassify-collection="inner"></section>
            </section>`;
        expect(describeCollection(el('c'), root)?.error?.code).toBe(
            'member-of-cycle',
        );
    });

    it('stops at the instance root: a collection above it is not in this tree', () => {
        root.innerHTML = `<div id="inner"><input id="m" data-ezclassify-controller="marking"></div>`;
        root.setAttribute('data-ezclassify-collection', 'outside');
        const inner = el('inner');
        expect(classify(el('m'), inner).collectionId).toBeNull();
        root.removeAttribute('data-ezclassify-collection');
    });
});

describe('classify: whole container refusals', () => {
    it('refuses a whole container naming no element', () => {
        root.innerHTML = `
            <form data-ezclassify-whole="missing">
                <input id="p" data-ezclassify-controller="marking">
            </form>`;
        expect(classify(el('p'), root).error?.code).toBe('whole-missing');
    });

    it('refuses nested whole containers', () => {
        root.innerHTML = `
            <form data-ezclassify-whole="doc">
                <input id="doc" data-ezclassify-controller="marking">
                <div data-ezclassify-whole="sub">
                    <input id="sub" data-ezclassify-controller="marking">
                    <input id="p" data-ezclassify-controller="marking">
                </div>
            </form>`;
        expect(classify(el('p'), root).error?.code).toBe('whole-nested');
        expect(classify(el('sub'), root).error?.code).toBe('whole-nested');
    });

    it('refuses a whole container with an empty name', () => {
        root.innerHTML = `
            <form data-ezclassify-whole="">
                <input id="p" data-ezclassify-controller="marking">
            </form>`;
        expect(classify(el('p'), root).error?.code).toBe('whole-unnamed');
    });
});

describe('classify: part-of refusals', () => {
    it('refuses a part-of that disagrees with the enclosing whole', () => {
        root.innerHTML = `
            <input id="other" data-ezclassify-controller="marking">
            <form data-ezclassify-whole="doc">
                <input id="doc" data-ezclassify-controller="marking">
                <input id="p" data-ezclassify-controller="marking" data-ezclassify-part-of="other">
            </form>`;
        expect(classify(el('p'), root).error?.code).toBe('part-of-disagrees');
    });

    it('accepts a part-of that agrees with the enclosing whole', () => {
        root.innerHTML = `
            <form data-ezclassify-whole="doc">
                <input id="doc" data-ezclassify-controller="marking">
                <input id="p" data-ezclassify-controller="marking" data-ezclassify-part-of="doc">
            </form>`;
        expect(classify(el('p'), root)).toMatchObject({
            kind: 'part',
            wholeId: 'doc',
        });
        expect(classify(el('p'), root).error).toBeUndefined();
    });

    it('refuses a part-of naming a collection', () => {
        root.innerHTML = `
            <section data-ezclassify-collection="folderA"></section>
            <input id="p" data-ezclassify-marking data-ezclassify-part-of="folderA">`;
        expect(classify(el('p'), root).error?.code).toBe('part-of-not-whole');
    });

    it('refuses a part-of naming another part', () => {
        root.innerHTML = `
            <input id="doc" data-ezclassify-controller="marking">
            <input id="p1" data-ezclassify-marking data-ezclassify-part-of="doc">
            <input id="p2" data-ezclassify-marking data-ezclassify-part-of="p1">`;
        expect(classify(el('p2'), root).error?.code).toBe('part-of-not-whole');
    });

    it('refuses a part-of across Contexts', () => {
        root.innerHTML = `
            <div data-ezclassify-context="capco"><input id="doc" data-ezclassify-controller="marking"></div>
            <div data-ezclassify-context="cui"><input id="p" data-ezclassify-marking data-ezclassify-part-of="doc"></div>`;
        expect(classify(el('p'), root).error?.code).toBe(
            'part-of-across-contexts',
        );
    });

    it('refuses a part-of across schemes of one Context', () => {
        root.innerHTML = `
            <input id="doc" data-ezclassify-controller="marking">
            <div data-ezclassify-scheme="tier"><input id="p" data-ezclassify-marking data-ezclassify-part-of="doc"></div>`;
        expect(classify(el('p'), root).error?.code).toBe(
            'part-of-across-contexts',
        );
    });

    it('refuses part-of on an element that holds no marking', () => {
        root.innerHTML = `<input id="p" data-ezclassify-part-of="doc">`;
        expect(classify(el('p'), root).error?.code).toBe('part-of-not-marking');
    });
});

describe('classify: no-rollup', () => {
    it('keeps a whole with no parts out of the roll-up', () => {
        root.innerHTML = `<select id="f" data-ezclassify-marking data-ezclassify-no-rollup></select>`;
        expect(classify(el('f'), root)).toMatchObject({
            kind: 'whole',
            contributes: false,
        });
        expect(classify(el('f'), root).error).toBeUndefined();
    });

    it('refuses no-rollup on a part', () => {
        root.innerHTML = `
            <form data-ezclassify-whole="doc">
                <input id="doc" data-ezclassify-controller="marking">
                <input id="p" data-ezclassify-controller="marking" data-ezclassify-no-rollup>
            </form>`;
        expect(classify(el('p'), root).error?.code).toBe('no-rollup-on-part');
    });

    it('refuses no-rollup on a whole with parts', () => {
        root.innerHTML = `
            <input id="doc" data-ezclassify-controller="marking" data-ezclassify-no-rollup>
            <input id="p" data-ezclassify-marking data-ezclassify-part-of="doc">`;
        expect(classify(el('doc'), root).error?.code).toBe(
            'no-rollup-on-whole-with-parts',
        );
    });
});

describe('classify: ignore', () => {
    it('reads an ignore region as ignored and refuses a marked element inside it', () => {
        root.innerHTML = `
            <ul id="refs" data-ezclassify-ignore>
                <li>Source: Report 12</li>
                <li><input id="m" data-ezclassify-controller="marking"></li>
            </ul>`;
        expect(classify(el('refs'), root)).toMatchObject({ kind: 'ignored' });
        expect(classify(el('refs'), root).error).toBeUndefined();
        const node = classify(el('m'), root);
        expect(node.kind).toBe('ignored');
        expect(node.contributes).toBe(false);
        expect(node.error?.code).toBe('marked-in-ignore');
    });

    it('refuses a view inside an ignore region', () => {
        root.innerHTML = `<div data-ezclassify-ignore><div id="v" data-ezclassify-aggregate></div></div>`;
        expect(classify(el('v'), root).error?.code).toBe('marked-in-ignore');
    });

    it('refuses a collection inside an ignore region', () => {
        root.innerHTML = `<div data-ezclassify-ignore><section id="c" data-ezclassify-collection="a"></section></div>`;
        expect(describeCollection(el('c'), root)?.error?.code).toBe(
            'marked-in-ignore',
        );
    });

    it('reads data-ezclassify-ignore="false" as no region', () => {
        root.innerHTML = `<div data-ezclassify-ignore="false"><input id="m" data-ezclassify-controller="marking"></div>`;
        expect(classify(el('m'), root).kind).toBe('whole');
    });
});

describe('placeNestedRoot', () => {
    it("places a nested root in the parent's nearest collection", () => {
        root.innerHTML = `<section data-ezclassify-collection="folderA"><div id="child"></div></section>`;
        expect(placeNestedRoot(el('child'), root)).toEqual({
            collectionId: 'folderA',
        });
    });

    it('places a nested root outside any collection in the page', () => {
        root.innerHTML = `<div id="child"></div>`;
        expect(placeNestedRoot(el('child'), root)).toEqual({
            collectionId: null,
        });
    });

    it('refuses a nested root inside a whole container', () => {
        root.innerHTML = `
            <form data-ezclassify-whole="doc">
                <input id="doc" data-ezclassify-controller="marking">
                <div id="child"></div>
            </form>`;
        expect(placeNestedRoot(el('child'), root).error?.code).toBe(
            'nested-root-in-whole',
        );
    });
});

describe('partWholeOf', () => {
    it('reads the whole of a part from structure or part-of, and none for a whole or a view', () => {
        root.innerHTML = `
            <form data-ezclassify-whole="doc">
                <input id="doc" data-ezclassify-controller="marking">
                <input id="p" data-ezclassify-controller="marking">
                <div id="banner" data-ezclassify-controller="banner" data-ezclassify-aggregate="doc"></div>
            </form>
            <input id="q" data-ezclassify-marking data-ezclassify-part-of="doc">`;
        expect(partWholeOf(el('p'))).toBe('doc');
        expect(partWholeOf(el('q'))).toBe('doc');
        expect(partWholeOf(el('doc'))).toBeNull();
        expect(partWholeOf(el('banner'))).toBeNull();
    });
});
