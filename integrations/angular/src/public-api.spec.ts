import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import {
    EzClassifyBannerComponent,
    injectEzClassifyFacet,
} from '@ezclassify/angular';

describe('Angular public API', () => {
    it('exposes a banner that binds instance inputs to the scanner', () => {
        const fixture = TestBed.createComponent(EzClassifyBannerComponent);
        fixture.componentRef.setInput('label', 'Visible markings');
        fixture.componentRef.setInput('source', 'visible');
        fixture.componentRef.setInput('noLive', true);
        fixture.detectChanges();

        const host = fixture.nativeElement as HTMLElement;
        expect(host.getAttribute('data-ezclassify-controller')).toBe('banner');
        expect(host.getAttribute('data-ezclassify-source')).toBe('visible');
        expect(host.hasAttribute('data-ezclassify-aggregate')).toBe(false);
        expect(host.getAttribute('data-ezclassify-banner-label')).toBe(
            'Visible markings',
        );
        expect(host.hasAttribute('data-ezclassify-banner-no-live')).toBe(true);

        fixture.componentRef.setInput('source', undefined);
        fixture.componentRef.setInput('noLive', false);
        fixture.detectChanges();
        expect(host.hasAttribute('data-ezclassify-aggregate')).toBe(true);
        expect(host.hasAttribute('data-ezclassify-banner-no-live')).toBe(false);
    });

    it('exports the component-library facet adapter', () => {
        expect(typeof injectEzClassifyFacet).toBe('function');
    });
});
