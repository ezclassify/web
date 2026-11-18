import { describe, it, expect, beforeEach } from 'vitest';
import { t, setLocale, resetLocale, defaultLocale } from './i18n';

describe('i18n', () => {
    beforeEach(() => {
        resetLocale();
    });

    describe('t()', () => {
        it('returns the default translation for a known key', () => {
            expect(t('hint.setMarking')).toBe('Set marking');
        });

        it('returns the key itself when the key is not found', () => {
            expect(t('nonexistent.key')).toBe('nonexistent.key');
        });

        it('returns correct value for each default locale key', () => {
            expect(t('hint.addMarking')).toBe('Add marking');
            expect(t('aria.markingInput')).toBe('Marking input');
        });

        it('returns the key for empty string key', () => {
            expect(t('')).toBe('');
        });
    });

    describe('setLocale()', () => {
        it('overrides a single key', () => {
            setLocale({ 'hint.setMarking': 'Markierung' } as any);
            expect(t('hint.setMarking')).toBe('Markierung');
        });

        it('preserves non-overridden keys', () => {
            setLocale({ 'hint.setMarking': 'Markierung' } as any);
            expect(t('hint.addMarking')).toBe('Add marking');
        });

        it('applies multiple overrides at once', () => {
            setLocale({
                'hint.setMarking': 'Markierung',
                'hint.addMarking': 'hinzufügen',
            } as any);
            expect(t('hint.setMarking')).toBe('Markierung');
            expect(t('hint.addMarking')).toBe('hinzufügen');
        });

        it('stacks successive setLocale calls', () => {
            setLocale({ 'hint.setMarking': 'Markierung' } as any);
            setLocale({ 'hint.addMarking': 'hinzufügen' } as any);
            expect(t('hint.setMarking')).toBe('Markierung');
            expect(t('hint.addMarking')).toBe('hinzufügen');
        });

        it('later setLocale overwrites earlier override for same key', () => {
            setLocale({ 'hint.setMarking': 'Markierung' } as any);
            setLocale({ 'hint.setMarking': 'Kennzeichnung' } as any);
            expect(t('hint.setMarking')).toBe('Kennzeichnung');
        });
    });

    describe('resetLocale()', () => {
        it('restores defaults after setLocale', () => {
            setLocale({ 'hint.setMarking': 'Markierung' } as any);
            resetLocale();
            expect(t('hint.setMarking')).toBe('Set marking');
        });

        it('is idempotent when called without prior setLocale', () => {
            resetLocale();
            expect(t('hint.setMarking')).toBe('Set marking');
        });
    });

    describe('defaultLocale', () => {
        it('is a frozen-shape object with expected keys', () => {
            expect(defaultLocale).toHaveProperty('hint.setMarking');
            expect(defaultLocale).toHaveProperty('aria.markingInput');
        });
    });
});
