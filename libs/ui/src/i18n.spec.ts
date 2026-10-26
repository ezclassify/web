import { describe, it, expect, beforeEach } from 'vitest';
import { t, setLocale, resetLocale, defaultLocale } from './i18n';

describe('i18n', () => {
    beforeEach(() => {
        resetLocale();
    });

    describe('t()', () => {
        it('returns the default translation for a known key', () => {
            expect(t('hint.type')).toBe('Type');
        });

        it('returns the key itself when the key is not found', () => {
            expect(t('nonexistent.key')).toBe('nonexistent.key');
        });

        it('returns correct value for each default locale key', () => {
            expect(t('hint.browse')).toBe('browse');
            expect(t('aria.markingInput')).toBe('Marking input');
        });

        it('returns the key for empty string key', () => {
            expect(t('')).toBe('');
        });
    });

    describe('setLocale()', () => {
        it('overrides a single key', () => {
            setLocale({ 'hint.type': 'Typ' } as any);
            expect(t('hint.type')).toBe('Typ');
        });

        it('preserves non-overridden keys', () => {
            setLocale({ 'hint.type': 'Typ' } as any);
            expect(t('hint.browse')).toBe('browse');
        });

        it('applies multiple overrides at once', () => {
            setLocale({
                'hint.type': 'Typ',
                'hint.browse': 'durchsuchen',
            } as any);
            expect(t('hint.type')).toBe('Typ');
            expect(t('hint.browse')).toBe('durchsuchen');
        });

        it('stacks successive setLocale calls', () => {
            setLocale({ 'hint.type': 'Typ' } as any);
            setLocale({ 'hint.browse': 'durchsuchen' } as any);
            expect(t('hint.type')).toBe('Typ');
            expect(t('hint.browse')).toBe('durchsuchen');
        });

        it('later setLocale overwrites earlier override for same key', () => {
            setLocale({ 'hint.type': 'Typ' } as any);
            setLocale({ 'hint.type': 'Tippen' } as any);
            expect(t('hint.type')).toBe('Tippen');
        });
    });

    describe('resetLocale()', () => {
        it('restores defaults after setLocale', () => {
            setLocale({ 'hint.type': 'Typ' } as any);
            resetLocale();
            expect(t('hint.type')).toBe('Type');
        });

        it('is idempotent when called without prior setLocale', () => {
            resetLocale();
            expect(t('hint.type')).toBe('Type');
        });
    });

    describe('defaultLocale', () => {
        it('is a frozen-shape object with expected keys', () => {
            expect(defaultLocale).toHaveProperty('hint.type');
            expect(defaultLocale).toHaveProperty('aria.markingInput');
        });
    });
});
