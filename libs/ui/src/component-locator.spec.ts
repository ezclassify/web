import { afterEach, describe, expect, it } from 'vitest';
import { createComponentLocator } from './component-locator';
import { adoptedStyleTexts } from './styles/adopt';
import { setMountHost } from './mount-host-registry';

/**
 * The locator's stylesheet is adopted onto the document, not appended as a
 * `<style>` element, so read it back through the adoption module.
 */
function adoptedLocatorCss(): string {
    const css = adoptedStyleTexts().find((text) =>
        text.includes('.ezclassify-locator'),
    );
    expect(css).toBeDefined();
    return css!;
}

describe('component locator', () => {
    afterEach(() => {
        document.body.replaceChildren();
        document.getElementById('ezclassify-locator-styles')?.remove();
    });

    const rendered = (element: HTMLElement, width = 240, height = 48) => {
        element.getBoundingClientRect = () =>
            ({
                x: 0,
                y: 0,
                top: 0,
                left: 0,
                right: width,
                bottom: height,
                width,
                height,
                toJSON: () => ({}),
            }) as DOMRect;
    };

    it.each([
        {
            tag: 'input',
            controllerName: 'marking',
            wrapperClass: 'marking-field-wrap',
            component: 'MarkingField',
        },
        {
            tag: 'textarea',
            controllerName: 'marking',
            wrapperClass: 'marking-field-wrap',
            component: 'MarkingField',
        },
        {
            tag: 'input',
            controllerName: 'marked-input',
            wrapperClass: 'marked-input-wrap',
            component: 'MarkedInput',
        },
    ])(
        'outlines the complete enhanced $tag $component without its host label or duplicate plumbing',
        ({ tag, controllerName, wrapperClass, component }) => {
            const target = document.createElement('div');
            target.innerHTML = `<label for="mark">Customer marking</label><div class="${wrapperClass}"><${tag} id="mark" data-ezclassify-controller="${controllerName}"></${tag}><div class="ez-validation-errors">Invalid<button>Apply fix</button></div></div><div data-ezclassify-mount="${controllerName}"></div>`;
            const controller = target.querySelector<HTMLElement>('#mark')!;
            const wrapper = target.querySelector<HTMLElement>(
                '.' + wrapperClass,
            )!;
            const mount = target.querySelector<HTMLElement>(
                '[data-ezclassify-mount]',
            )!;
            setMountHost(mount, controller);
            if (tag === 'input') controller.style.display = 'none';
            rendered(target, 300, 200);
            rendered(wrapper, 240, 140);
            rendered(
                controller,
                tag === 'input' ? 0 : 240,
                tag === 'input' ? 0 : 48,
            );
            rendered(mount, 240, 0);
            document.body.append(target);
            const locator = createComponentLocator({ target, active: true });
            expect(wrapper.dataset.ezclassifyXrayLabel).toBe(
                `@ezclassify/ui: ${component}`,
            );
            expect(
                target.querySelectorAll('[data-ezclassify-xray-kind]'),
            ).toHaveLength(1);
            expect(
                wrapper.contains(target.querySelector('.ez-validation-errors')),
            ).toBe(true);
            expect(wrapper.contains(target.querySelector('label'))).toBe(false);
            expect(controller.dataset.ezclassifyXrayLabel).toBeUndefined();
            locator.destroy();
            expect(
                target.querySelectorAll('[data-ezclassify-xray-kind]'),
            ).toHaveLength(0);
        },
    );

    it('ignores controls inside closed disclosures despite nonzero geometry', () => {
        const target = document.createElement('div');
        target.innerHTML =
            '<details><summary>More</summary><div data-ezclassify-powered>Result</div></details>';
        const details = target.querySelector('details')!;
        const result = target.querySelector<HTMLElement>(
            '[data-ezclassify-powered]',
        )!;
        rendered(result);
        document.body.append(target);
        const locator = createComponentLocator({ target, active: true });
        expect(result.dataset.ezclassifyXrayKind).toBeUndefined();
        locator.destroy();
        details.open = true;
        const opened = createComponentLocator({ target, active: true });
        expect(result.dataset.ezclassifyXrayKind).toBeDefined();
        opened.destroy();
    });

    it('does not count a clipped announcement as a second component mount', () => {
        const target = document.createElement('div');
        target.innerHTML =
            '<div><textarea data-ezclassify-controller="marking"></textarea></div><div data-ezclassify-mount="marking"><span role="status" style="clip:rect(0px, 0px, 0px, 0px)">Ready</span></div>';
        for (const element of target.querySelectorAll<HTMLElement>('*'))
            rendered(element);
        document.body.append(target);
        const locator = createComponentLocator({ target, active: true });
        expect(
            target.querySelectorAll('[data-ezclassify-xray-kind]'),
        ).toHaveLength(1);
        expect(
            target
                .querySelector('[data-ezclassify-mount]')
                ?.getAttribute('data-ezclassify-xray-kind'),
        ).toBeNull();
        locator.destroy();
    });

    it('marks a visible controller but not its zero-height plumbing mount', () => {
        const target = document.createElement('div');
        const visible = document.createElement('textarea');
        visible.setAttribute('data-ezclassify-controller', 'marked-textarea');
        const plumbing = document.createElement('div');
        plumbing.setAttribute('data-ezclassify-mount', 'marked-textarea');
        rendered(target, 300, 100);
        rendered(visible);
        rendered(plumbing, 240, 0);
        target.append(visible, plumbing);
        document.body.append(target);

        const locator = createComponentLocator({ target });
        document.body.append(locator.element);
        const toggle = locator.element.querySelector<HTMLInputElement>(
            'input[role="switch"]',
        )!;
        toggle.checked = true;
        toggle.dispatchEvent(new Event('change'));

        expect(target.dataset.ezclassifyXrayKind).toBe('component');
        expect(target.dataset.ezclassifyXrayLabel).toBe(
            '@ezclassify/ui: MarkedTextArea',
        );
        expect(visible.dataset.ezclassifyXrayKind).toBeUndefined();
        expect(plumbing.dataset.ezclassifyXrayKind).toBeUndefined();
        locator.destroy();
    });

    it('does not mark a nonzero plumbing mount beside its enhanced controller', () => {
        const target = document.createElement('div');
        const wrapper = document.createElement('div');
        const controller = document.createElement('textarea');
        controller.setAttribute('data-ezclassify-controller', 'marked-input');
        const mount = document.createElement('div');
        mount.setAttribute('data-ezclassify-mount', 'marked-input');
        rendered(target, 300, 140);
        rendered(wrapper, 240, 96);
        rendered(controller, 240, 48);
        rendered(mount, 240, 20);
        wrapper.append(controller);
        target.append(wrapper, mount);
        document.body.append(target);

        const locator = createComponentLocator({ target });
        document.body.append(locator.element);
        const toggle = locator.element.querySelector<HTMLInputElement>(
            'input[role="switch"]',
        )!;
        toggle.checked = true;
        toggle.dispatchEvent(new Event('change'));

        expect(wrapper.dataset.ezclassifyXrayLabel).toBe(
            '@ezclassify/ui: MarkedInput',
        );
        expect(mount.dataset.ezclassifyXrayKind).toBeUndefined();
        locator.destroy();
    });

    it('marks a rendered mount that contains the component output beside its hidden controller', () => {
        const target = document.createElement('div');
        const controller = document.createElement('fieldset');
        controller.hidden = true;
        controller.setAttribute('data-ezclassify-controller', 'selector');
        const mount = document.createElement('div');
        mount.setAttribute('data-ezclassify-mount', 'selector');
        const renderedComponent = document.createElement('div');
        renderedComponent.className = 'category-selector';
        rendered(target, 300, 180);
        rendered(controller, 0, 0);
        rendered(mount, 280, 160);
        rendered(renderedComponent, 280, 160);
        mount.append(renderedComponent);
        target.append(controller, mount);
        document.body.append(target);

        const locator = createComponentLocator({ target });
        document.body.append(locator.element);
        const toggle = locator.element.querySelector<HTMLInputElement>(
            'input[role="switch"]',
        )!;
        toggle.checked = true;
        toggle.dispatchEvent(new Event('change'));

        expect(mount.dataset.ezclassifyXrayKind).toBe('component');
        expect(mount.dataset.ezclassifyXrayLabel).toBe(
            '@ezclassify/ui: CategorySelector',
        );
        locator.destroy();
    });

    it('marks a visible rendered output as a binding', () => {
        const target = document.createElement('div');
        const output = document.createElement('output');
        output.setAttribute('data-ezclassify-rendered', '');
        rendered(target, 300, 100);
        rendered(output);
        target.append(output);
        document.body.append(target);

        const locator = createComponentLocator({ target });
        document.body.append(locator.element);
        const toggle = locator.element.querySelector<HTMLInputElement>(
            'input[role="switch"]',
        )!;
        toggle.checked = true;
        toggle.dispatchEvent(new Event('change'));

        expect(output.dataset.ezclassifyXrayKind).toBe('binding');
        locator.destroy();
    });

    it('ignores hidden markers and assigns one highest-priority kind per box', () => {
        const target = document.createElement('div');
        const visible = document.createElement('div');
        visible.setAttribute('data-ezclassify-powered', '');
        visible.setAttribute('data-ezclassify-controller', 'text');
        const hidden = document.createElement('select');
        hidden.hidden = true;
        hidden.setAttribute('data-ezclassify-controller', 'select');
        rendered(target, 300, 100);
        rendered(visible);
        rendered(hidden);
        target.append(visible, hidden);
        document.body.append(target);

        const locator = createComponentLocator({ target });
        document.body.append(locator.element);
        const toggle = locator.element.querySelector<HTMLInputElement>(
            'input[role="switch"]',
        )!;
        toggle.checked = true;
        toggle.dispatchEvent(new Event('change'));

        expect(visible.dataset.ezclassifyXrayKind).toBe('component');
        expect(visible.dataset.ezclassifyXrayLabel).toBe(
            '@ezclassify/ui: EzClassifyText',
        );
        expect(hidden.dataset.ezclassifyXrayKind).toBeUndefined();
        locator.destroy();
    });

    it('places the legend below the switch row instead of inside its label', () => {
        const target = document.createElement('div');
        rendered(target);
        document.body.append(target);
        const locator = createComponentLocator({ target });
        document.body.append(locator.element);

        const switchRow = locator.element.querySelector(
            '.ezclassify-locator__switch',
        )!;
        const legend = locator.element.querySelector(
            '.ezclassify-locator__legend',
        )!;
        expect(switchRow.contains(legend)).toBe(false);
        expect(legend.parentElement).toBe(locator.element);
        locator.destroy();
    });

    it('supports a persisted initial state and reports subsequent changes', () => {
        const target = document.createElement('div');
        const component = document.createElement('div');
        component.setAttribute('data-ezclassify-mount', 'select');
        rendered(target, 300, 100);
        rendered(component);
        target.append(component);
        document.body.append(target);
        const changes: boolean[] = [];

        const locator = createComponentLocator({
            target,
            active: true,
            onChange: (active) => changes.push(active),
        });
        document.body.append(locator.element);
        const toggle = locator.element.querySelector<HTMLInputElement>(
            'input[role="switch"]',
        )!;

        expect(toggle.checked).toBe(true);
        expect(toggle.getAttribute('aria-checked')).toBe('true');
        expect(component.dataset.ezclassifyXrayKind).toBe('component');
        expect(component.dataset.ezclassifyXrayLabel).toBe(
            '@ezclassify/ui: SingleSelect',
        );
        expect(changes).toEqual([true]);

        toggle.checked = false;
        toggle.dispatchEvent(new Event('change'));
        expect(changes).toEqual([true, false]);
        expect(component.dataset.ezclassifyXrayKind).toBeUndefined();
        locator.destroy();
    });

    it('keys its dark palette on host theme attributes, never the OS theme', () => {
        // Standing rule (styles.css): the library never queries
        // prefers-color-scheme. Theme state comes from the host application;
        // if the host does not change with the system theme, neither does any
        // EzClassify surface, including this debug overlay.
        const target = document.createElement('div');
        document.body.append(target);
        const locator = createComponentLocator({ target });
        document.body.append(locator.element);
        const toggle = locator.element.querySelector<HTMLInputElement>(
            'input[role="switch"]',
        )!;
        toggle.checked = true;
        toggle.dispatchEvent(new Event('change'));

        const locatorCss = adoptedLocatorCss();
        expect(locatorCss).not.toContain('prefers-color-scheme');
        // The host-keyed dark selectors cover the same set styles.css uses.
        for (const sel of [
            "[data-color-scheme='dark']",
            "[data-theme='dark']",
            "[data-bs-theme='dark']",
            '.dark',
        ]) {
            expect(locatorCss).toContain(sel);
        }
        locator.destroy();
    });
});
