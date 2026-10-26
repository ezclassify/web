/**
 * Every marking host is seeded once, by the step that mounts it: a host with no
 * controller as it registers, a controller once its init has resolved. The
 * initial sweep and a later mount take the same path, so no host is read twice
 * for its served value and none is left unread.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { EzClassifyUI } from './ezclassify-ui';
import { VanillaEzClassifyStore } from './store/ezclassify-store';
import { loadMultiScopeRegression } from '../test-fixtures/load-multi-scope-regression';

const FORM = `<form id="root">
    <input id="document" value="SCHOOL STAFF" data-ezclassify-controller="marking">
    <input id="attachment" value="STUDENTS" data-ezclassify-controller="marking" data-ezclassify-part-of="document">
    <input id="summary" value="DISTRICT COORDINATORS" data-ezclassify-controller="tags" data-ezclassify-part-of="document">
    <input id="title" value="(ST) Title" data-ezclassify-controller="marked-input" data-ezclassify-part-of="document">
    <textarea id="body" data-ezclassify-controller="marked-textarea" data-ezclassify-part-of="document">(SS) First.
(ST) Second.</textarea>
    <input type="hidden" id="appendix" value="STUDENTS" data-ezclassify-rendered data-ezclassify-part-of="document">
    <input type="hidden" id="cover" value="SCHOOL STAFF" data-ezclassify-rendered>
    <div data-ezclassify-controller="banner" data-ezclassify-source="document"></div>
    <div data-ezclassify-controller="banner" data-ezclassify-aggregate="document"></div>
</form>`;

let ui: EzClassifyUI | undefined;
afterEach(() => {
    ui?.destroy();
    ui = undefined;
    document.body.innerHTML = '';
});

/** A store that counts the seeds it is sent, and the reads it sends. */
function countingStore() {
    const engine = loadMultiScopeRegression();
    let reads = 0;
    const counted = new Proxy(engine, {
        get(target, key, receiver) {
            const value = Reflect.get(target, key, receiver);
            if (typeof value !== 'function') return value;
            if (key === 'process')
                return (...args: unknown[]) => {
                    reads++;
                    return Reflect.apply(value, target, args);
                };
            return value.bind(target);
        },
    });
    const store = new VanillaEzClassifyStore(counted);
    const seeds = new Map<string, number>();
    const count = (id: string) => seeds.set(id, (seeds.get(id) ?? 0) + 1);
    const seedRendered = store.seedRendered.bind(store);
    const seedAssertions = store.seedAssertions.bind(store);
    store.seedRendered = (id, rendered) => {
        count(id);
        return seedRendered(id, rendered);
    };
    store.seedAssertions = (id, assertions) => {
        count(id);
        return seedAssertions(id, assertions);
    };
    return { engine, store, seeds, reads: () => reads };
}

const ready = (root: HTMLElement) =>
    new Promise<void>((resolve) =>
        root.addEventListener('ezclassify:ready', () => resolve(), {
            once: true,
        }),
    );

async function settle() {
    for (let i = 0; i < 6; i++)
        await new Promise((resolve) => setTimeout(resolve, 20));
}

describe('seeding marking hosts on mount', () => {
    it('seeds each host once on the initial mount', async () => {
        document.body.innerHTML = FORM;
        const root = document.querySelector<HTMLElement>('#root')!;
        const { engine, store, seeds, reads } = countingStore();
        const isReady = ready(root);
        ui = new EzClassifyUI(engine, { root, store });
        await isReady;
        await settle();
        const entries = [
            ...root.querySelectorAll<HTMLElement>(
                '[data-marked-textarea-field]',
            ),
        ].map((el) => el.id);
        expect(entries).toHaveLength(2);
        const hosts = [
            'document',
            'attachment',
            'summary',
            'title',
            'appendix',
            'cover',
            ...entries,
        ].sort();
        expect([...seeds.keys()].sort()).toEqual(hosts);
        // They go out in the order the hosts mounted, the portions once their
        // textarea has parsed them, so what each part's first read carries
        // does not depend on which init answered first.
        expect([...seeds.keys()]).toEqual([
            'document',
            'attachment',
            'summary',
            'title',
            'appendix',
            'cover',
            ...entries,
        ]);
        expect([...seeds.values()].every((n) => n === 1)).toBe(true);
        // One read per host, and one more for each part of `document` against
        // the whole's committed value: the parts' first reads went out with
        // the whole's. No field publishes on mount.
        const parts = hosts.filter((id) => id !== 'document' && id !== 'cover');
        expect(reads()).toBe(hosts.length + parts.length);
    });

    it('seeds a host mounted after the initial sweep once, the same way', async () => {
        document.body.innerHTML = FORM;
        const root = document.querySelector<HTMLElement>('#root')!;
        const { engine, store, seeds } = countingStore();
        const isReady = ready(root);
        ui = new EzClassifyUI(engine, { root, store });
        await isReady;
        await settle();
        seeds.clear();
        root.insertAdjacentHTML(
            'beforeend',
            `<input type="hidden" id="late-cover" value="STUDENTS" data-ezclassify-rendered>
            <input type="hidden" id="late-part" value="STUDENTS" data-ezclassify-rendered data-ezclassify-part-of="document">
            <input id="late-field" value="STUDENTS" data-ezclassify-controller="marking" data-ezclassify-part-of="document">
            <textarea id="late-body" data-ezclassify-controller="marked-textarea" data-ezclassify-part-of="document">(SS) Late.</textarea>`,
        );
        await settle();
        const lateEntries = [
            ...root.querySelectorAll<HTMLElement>(
                '[data-marked-textarea-field]',
            ),
        ]
            .map((el) => el.id)
            .filter((id) => id.startsWith('late-body'));
        expect(lateEntries).toHaveLength(1);
        expect(Object.fromEntries(seeds)).toEqual(
            Object.fromEntries(
                ['late-cover', 'late-part', 'late-field', ...lateEntries].map(
                    (id) => [id, 1],
                ),
            ),
        );
    });

    it('rolls a whole up without a part the application registered and never seeded', async () => {
        document.body.innerHTML = FORM;
        const root = document.querySelector<HTMLElement>('#root')!;
        const { engine, store } = countingStore();
        store.setPartOf('never-seeded', 'document');
        const isReady = ready(root);
        ui = new EzClassifyUI(engine, { root, store });
        await isReady;
        await settle();
        expect(store.getWholeRollup('document').rendered).not.toBe('');
        expect(store.getAggregate().rendered).not.toBe('');
        const banner = root.querySelector<HTMLElement>(
            '[data-ezclassify-aggregate="document"]',
        )!;
        expect(banner.textContent?.trim()).not.toBe('');
    });
});
