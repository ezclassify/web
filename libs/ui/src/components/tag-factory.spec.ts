import { describe, it, expect, vi } from 'vitest';
import { createTag } from './tag-factory';

describe('tag-factory', () => {
    describe('createTag', () => {
        it('returns a span with correct class and aria-label', () => {
            const tag = createTag({
                label: 'Alpha',
                conceptId: 'c1',
                categoryId: 'cat1',
                color: '#ff0000',
            });
            expect(tag.tagName).toBe('SPAN');
            // No onRemove supplied, so this is also a removeless pill; see
            // the dedicated proto-tag--no-remove tests below.
            expect(tag.className).toBe('proto-tag proto-tag--no-remove');
            expect(tag.getAttribute('aria-label')).toBe('Alpha');
        });

        it('names the chip for AT via aria-label, with no list-item role (parent is a group, not a list)', () => {
            const tag = createTag({
                label: 'Alpha',
                conceptId: 'c1',
                categoryId: 'cat1',
                color: '#ff0000',
            });
            expect(tag.getAttribute('role')).toBeNull();
            expect(tag.getAttribute('aria-label')).toBe('Alpha');
        });

        it('uses fullName for aria-label when provided', () => {
            const tag = createTag({
                label: 'TS',
                fullName: 'TOP SECRET',
                conceptId: 'c1',
                categoryId: 'cat1',
                color: '#ff0000',
            });
            expect(tag.getAttribute('aria-label')).toBe('TOP SECRET');
        });

        it('falls back to label for aria-label when fullName is absent', () => {
            const tag = createTag({
                label: 'TS',
                conceptId: 'c1',
                categoryId: 'cat1',
                color: '#ff0000',
            });
            expect(tag.getAttribute('aria-label')).toBe('TS');
        });

        it('sets data attributes for concept and category', () => {
            const tag = createTag({
                label: 'Beta',
                conceptId: 'c2',
                categoryId: 'cat2',
                color: '#00ff00',
            });
            expect(tag.dataset.conceptId).toBe('c2');
            expect(tag.dataset.categoryId).toBe('cat2');
        });

        it('paints the chip as a filled pill: category color as background, caller-resolved text on top', () => {
            const tag = createTag({
                label: 'Gamma',
                conceptId: 'c3',
                categoryId: 'cat3',
                color: '#0000ff',
                textColor: '#ffffff',
            });
            // A filled pill, not underlined text: the category
            // color IS the chip's background, and the text color is whatever
            // the caller resolved for WCAG contrast against it (getCategoryTextColor
            // or an authority color rule's own `text`), not a fixed themed default.
            expect(tag.style.getPropertyValue('--ez-tag-bg')).toBe('#0000ff');
            expect(tag.style.getPropertyValue('--ez-tag-color')).toBe(
                '#ffffff',
            );
        });

        it('leaves --ez-tag-color unset when the caller has no text color to pair with it', () => {
            const tag = createTag({
                label: 'Gamma',
                conceptId: 'c3',
                categoryId: 'cat3',
                color: '#0000ff',
            });
            expect(tag.style.getPropertyValue('--ez-tag-bg')).toBe('#0000ff');
            expect(tag.style.getPropertyValue('--ez-tag-color')).toBe('');
        });

        it('applies no category color when color coding is disabled', () => {
            const tag = createTag({
                label: 'Gamma',
                conceptId: 'c3',
                categoryId: 'cat3',
                color: '#0000ff',
                textColor: '#ffffff',
                colorCoding: false,
            });
            // Neither property is set; the field's own neutral pill (--ez-tag-bg/
            // --ez-tag-color theme defaults) applies via the stylesheet instead.
            expect(tag.style.getPropertyValue('--ez-tag-bg')).toBe('');
            expect(tag.style.getPropertyValue('--ez-tag-color')).toBe('');
        });

        it('adds inferred class and aria-label suffix when inferred', () => {
            const tag = createTag({
                label: 'Delta',
                conceptId: 'c4',
                categoryId: 'cat4',
                color: '#fff',
                inferred: true,
            });
            expect(tag.className).toContain('proto-tag--inferred');
            expect(tag.getAttribute('aria-label')).toBe('Delta (inferred)');
        });

        it('adds remove button when onRemove is provided and not inferred', () => {
            const onRemove = vi.fn();
            const tag = createTag({
                label: 'Zeta',
                conceptId: 'c6',
                categoryId: 'cat6',
                color: '#000',
                onRemove,
            });
            const btn = tag.querySelector('button.proto-tag-remove');
            expect(btn).not.toBeNull();
            expect(btn!.getAttribute('aria-label')).toBe('Remove Zeta');
        });

        it('uses fullName in remove button aria-label when provided', () => {
            const onRemove = vi.fn();
            const tag = createTag({
                label: 'TS',
                fullName: 'TOP SECRET',
                conceptId: 'c6',
                categoryId: 'cat6',
                color: '#000',
                onRemove,
            });
            const btn = tag.querySelector('button.proto-tag-remove');
            expect(btn!.getAttribute('aria-label')).toBe('Remove TOP SECRET');
        });

        it('remove button starts with tabIndex -1', () => {
            const onRemove = vi.fn();
            const tag = createTag({
                label: 'Eta2',
                conceptId: 'c6x',
                categoryId: 'cat6',
                color: '#000',
                onRemove,
            });
            const btn = tag.querySelector(
                'button.proto-tag-remove',
            ) as HTMLButtonElement;
            expect(btn.tabIndex).toBe(-1);
        });

        it('does not add remove button when inferred even with onRemove', () => {
            const tag = createTag({
                label: 'Eta',
                conceptId: 'c7',
                categoryId: 'cat7',
                color: '#000',
                inferred: true,
                onRemove: () => {},
            });
            expect(tag.querySelector('button.proto-tag-remove')).toBeNull();
        });

        it('adds proto-tag--no-remove when there is no remove control (no onRemove)', () => {
            const tag = createTag({
                label: 'NoRemove',
                conceptId: 'c12',
                categoryId: 'cat12',
                color: '#000',
            });
            expect(tag.className).toContain('proto-tag--no-remove');
        });

        it('adds proto-tag--no-remove for an inferred chip even when onRemove is passed', () => {
            // Inferred chips never render a ✕ (see the test above), so they
            // are removeless pills too and need the same symmetric padding.
            const tag = createTag({
                label: 'InferredNoRemove',
                conceptId: 'c13',
                categoryId: 'cat13',
                color: '#000',
                inferred: true,
                onRemove: () => {},
            });
            expect(tag.className).toContain('proto-tag--no-remove');
        });

        it('omits proto-tag--no-remove when a real remove button is present', () => {
            const tag = createTag({
                label: 'Zeta2',
                conceptId: 'c6b',
                categoryId: 'cat6',
                color: '#000',
                onRemove: () => {},
            });
            expect(tag.className).not.toContain('proto-tag--no-remove');
        });

        it('calls onRemove callback when remove button is clicked', () => {
            const onRemove = vi.fn();
            const tag = createTag({
                label: 'Theta',
                conceptId: 'c8',
                categoryId: 'cat8',
                color: '#000',
                onRemove,
            });
            const btn = tag.querySelector(
                'button.proto-tag-remove',
            ) as HTMLButtonElement;
            btn.click();
            expect(onRemove).toHaveBeenCalledOnce();
        });

        it('adds editable input when editable option is provided', () => {
            const onChange = vi.fn();
            const tag = createTag({
                label: 'Iota',
                conceptId: 'c9',
                categoryId: 'cat9',
                color: '#000',
                editable: {
                    value: '2025-01-01',
                    placeholder: 'YYYY-MM-DD',
                    config: {
                        encoding: {
                            type: 'text',
                            pattern: '\\d{4}-\\d{2}-\\d{2}',
                        },
                    },
                    onChange,
                },
            });
            expect(tag.className).toContain('proto-tag--editable');
            const input = tag.querySelector(
                'input.proto-tag-edit',
            ) as HTMLInputElement;
            expect(input).not.toBeNull();
            expect(input.value).toBe('2025-01-01');
            expect(input.placeholder).toBe('YYYY-MM-DD');
            expect(input.pattern).toBe('\\d{4}-\\d{2}-\\d{2}');
            expect(input.getAttribute('aria-label')).toBe('Iota value');
        });

        it('calls editable onChange on input events', () => {
            const onChange = vi.fn();
            const tag = createTag({
                label: 'Kappa',
                conceptId: 'c10',
                categoryId: 'cat10',
                color: '#000',
                editable: {
                    value: '',
                    config: { encoding: { type: 'text' } },
                    onChange,
                },
            });
            const input = tag.querySelector(
                'input.proto-tag-edit',
            ) as HTMLInputElement;
            input.value = 'new-val';
            input.dispatchEvent(new Event('input'));
            expect(onChange).toHaveBeenCalledWith('new-val');
        });

        it('contains a label span as first child', () => {
            const tag = createTag({
                label: 'Lambda',
                conceptId: 'c11',
                categoryId: 'cat11',
                color: '#000',
            });
            const label = tag.querySelector('span');
            expect(label?.textContent).toBe('Lambda');
        });
    });
});
