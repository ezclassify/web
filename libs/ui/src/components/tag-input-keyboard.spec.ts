import { describe, it, expect, vi } from 'vitest';
import { handleChipKeydown, handleFilterChipKeys } from './tag-input-keyboard';
import type { ChipKeyboardContext } from './tag-input-keyboard';

function makeKeyEvent(
    key: string,
    opts?: Partial<KeyboardEvent>,
): KeyboardEvent {
    return new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        ...opts,
    });
}

function createChipContext(
    overrides?: Partial<ChipKeyboardContext>,
): ChipKeyboardContext {
    const chip1 = document.createElement('span');
    chip1.dataset.conceptId = 'c1';
    chip1.dataset.categoryId = 'cat1';
    chip1.tabIndex = 0;

    const chip2 = document.createElement('span');
    chip2.dataset.conceptId = 'c2';
    chip2.dataset.categoryId = 'cat2';
    chip2.tabIndex = 0;

    return {
        tagEls: [chip1, chip2],
        filterInput: document.createElement('input'),
        assertions: [
            {
                conceptId: 'c1',
                categoryId: 'cat1',
                confidence: 'certain',
                source: 'user',
            },
            {
                conceptId: 'c2',
                categoryId: 'cat2',
                confidence: 'certain',
                source: 'user',
            },
        ],
        focusChip: vi.fn(),
        unfocusAllChips: vi.fn(),
        removeAssertion: vi.fn(),
        closeList: vi.fn(),
        setPendingFocusConceptId: vi.fn(),
        ...overrides,
    };
}

describe('handleChipKeydown', () => {
    it('ArrowLeft focuses previous chip', () => {
        const ctx = createChipContext();
        handleChipKeydown(makeKeyEvent('ArrowLeft'), ctx.tagEls[1], ctx);
        expect(ctx.focusChip).toHaveBeenCalledWith(0);
    });

    it('ArrowLeft does nothing on first chip', () => {
        const ctx = createChipContext();
        handleChipKeydown(makeKeyEvent('ArrowLeft'), ctx.tagEls[0], ctx);
        expect(ctx.focusChip).not.toHaveBeenCalled();
    });

    it('ArrowRight focuses next chip', () => {
        const ctx = createChipContext();
        handleChipKeydown(makeKeyEvent('ArrowRight'), ctx.tagEls[0], ctx);
        expect(ctx.focusChip).toHaveBeenCalledWith(1);
    });

    it('ArrowRight on last chip moves focus to filter input', () => {
        const ctx = createChipContext();
        const focusSpy = vi.spyOn(ctx.filterInput, 'focus');
        handleChipKeydown(makeKeyEvent('ArrowRight'), ctx.tagEls[1], ctx);
        expect(ctx.unfocusAllChips).toHaveBeenCalled();
        expect(focusSpy).toHaveBeenCalled();
    });

    it('ArrowUp/ArrowDown unfocuses chips and focuses filter', () => {
        const ctx = createChipContext();
        const focusSpy = vi.spyOn(ctx.filterInput, 'focus');
        handleChipKeydown(makeKeyEvent('ArrowUp'), ctx.tagEls[0], ctx);
        expect(ctx.unfocusAllChips).toHaveBeenCalled();
        expect(focusSpy).toHaveBeenCalled();
    });

    it('Delete removes assertion for non-inferred chip', () => {
        const ctx = createChipContext();
        handleChipKeydown(makeKeyEvent('Delete'), ctx.tagEls[1], ctx);
        expect(ctx.removeAssertion).toHaveBeenCalledWith('c2', 'cat2');
    });

    it('Backspace removes assertion for non-inferred chip', () => {
        const ctx = createChipContext();
        handleChipKeydown(makeKeyEvent('Backspace'), ctx.tagEls[0], ctx);
        expect(ctx.removeAssertion).toHaveBeenCalledWith('c1', 'cat1');
        expect(ctx.setPendingFocusConceptId).toHaveBeenCalled();
    });

    it('Delete on inferred chip navigates to previous non-inferred chip', () => {
        const ctx = createChipContext({
            assertions: [
                {
                    conceptId: 'c1',
                    categoryId: 'cat1',
                    confidence: 'certain',
                    source: 'user',
                },
                {
                    conceptId: 'c2',
                    categoryId: 'cat2',
                    confidence: 'inferred',
                    source: 'infer',
                },
            ],
        });
        handleChipKeydown(makeKeyEvent('Delete'), ctx.tagEls[1], ctx);
        expect(ctx.removeAssertion).not.toHaveBeenCalled();
        expect(ctx.focusChip).toHaveBeenCalledWith(0);
    });

    it('Delete on a category default moves on instead of removing it', () => {
        // A default reads as certain, yet the author never stated it: like
        // an inferred chip it has no × and the keys do not remove it.
        const ctx = createChipContext({
            assertions: [
                {
                    conceptId: 'c1',
                    categoryId: 'cat1',
                    confidence: 'certain',
                    source: 'user',
                },
                {
                    conceptId: 'c2',
                    categoryId: 'cat2',
                    confidence: 'certain',
                    source: 'default',
                },
            ],
        });
        handleChipKeydown(makeKeyEvent('Delete'), ctx.tagEls[1], ctx);
        expect(ctx.removeAssertion).not.toHaveBeenCalled();
        expect(ctx.focusChip).toHaveBeenCalledWith(0);
    });

    it('Escape unfocuses chips, closes the list, and focuses filter', () => {
        const ctx = createChipContext();
        const focusSpy = vi.spyOn(ctx.filterInput, 'focus');
        handleChipKeydown(makeKeyEvent('Escape'), ctx.tagEls[0], ctx);
        expect(ctx.unfocusAllChips).toHaveBeenCalled();
        expect(ctx.closeList).toHaveBeenCalled();
        expect(focusSpy).toHaveBeenCalled();
    });

    it('printable character unfocuses chips and focuses filter', () => {
        const ctx = createChipContext();
        const focusSpy = vi.spyOn(ctx.filterInput, 'focus');
        handleChipKeydown(makeKeyEvent('a'), ctx.tagEls[0], ctx);
        expect(ctx.unfocusAllChips).toHaveBeenCalled();
        expect(focusSpy).toHaveBeenCalled();
    });

    it('printable character with ctrl does not passthrough', () => {
        const ctx = createChipContext();
        handleChipKeydown(
            makeKeyEvent('a', { ctrlKey: true }),
            ctx.tagEls[0],
            ctx,
        );
        expect(ctx.unfocusAllChips).not.toHaveBeenCalled();
    });
});

describe('handleFilterChipKeys', () => {
    function filterContext(value = '') {
        const ctx = createChipContext();
        ctx.filterInput.value = value;
        return {
            filterInput: ctx.filterInput,
            tagEls: ctx.tagEls,
            assertions: ctx.assertions,
            focusChip: vi.fn(),
        };
    }

    it('ArrowLeft focuses last chip when filter is empty', () => {
        const ctx = filterContext();
        const e = makeKeyEvent('ArrowLeft');
        handleFilterChipKeys(e, ctx);
        expect(ctx.focusChip).toHaveBeenCalledWith(1);
        expect(e.defaultPrevented).toBe(true);
    });

    it('ArrowLeft does nothing when filter has text', () => {
        const ctx = filterContext('se');
        const e = makeKeyEvent('ArrowLeft');
        handleFilterChipKeys(e, ctx);
        expect(ctx.focusChip).not.toHaveBeenCalled();
        expect(e.defaultPrevented).toBe(false);
    });

    it('Backspace focuses last non-inferred chip when filter is empty', () => {
        const ctx = filterContext();
        ctx.assertions[1] = { ...ctx.assertions[1], confidence: 'inferred' };
        handleFilterChipKeys(makeKeyEvent('Backspace'), ctx);
        expect(ctx.focusChip).toHaveBeenCalledWith(0);
    });

    it('leaves every list key to the composer', () => {
        const ctx = filterContext();
        for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape']) {
            const e = makeKeyEvent(key);
            handleFilterChipKeys(e, ctx);
            expect(e.defaultPrevented).toBe(false);
        }
        expect(ctx.focusChip).not.toHaveBeenCalled();
    });

    it('ignores keys mid-IME-composition (isComposing and legacy keyCode 229)', () => {
        const ctx = filterContext();
        handleFilterChipKeys(
            makeKeyEvent('ArrowLeft', { isComposing: true }),
            ctx,
        );
        handleFilterChipKeys(makeKeyEvent('Backspace', { keyCode: 229 }), ctx);
        expect(ctx.focusChip).not.toHaveBeenCalled();
    });
});
