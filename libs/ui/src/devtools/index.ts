/**
 * `@ezclassify/ui/devtools`: development aids that stay in step with the
 * library but never reach a production bundle unless a page imports them.
 *
 * Loading this entry also installs `ezclassify.devtools()` on the global
 * object, the one-line console switch for pages with no build step, such as a
 * SharePoint or Jira page that loads its scripts directly.
 */

import {
    createComponentLocator,
    type ComponentLocator,
} from './component-locator';

export { createComponentLocator } from './component-locator';
export type {
    ComponentLocator,
    ComponentLocatorOptions,
} from './component-locator';

/** The control the console switch placed on the page, while it is shown. */
let shown: ComponentLocator | null = null;

/**
 * Turn the component highlights on or off for the whole page. On, a floating
 * "Highlight components" control appears in a corner with highlighting already
 * switched on; off removes it and every outline. Calling it again in the state
 * it is already in does nothing. From the browser console it is
 * `ezclassify.devtools()`, and `ezclassify.devtools(false)` to turn it off.
 *
 * @param on - Show the highlights (default) or remove them.
 */
export function devtools(on = true): void {
    if (!on) {
        shown?.destroy();
        shown = null;
        return;
    }
    if (shown) return;
    shown = createComponentLocator({ active: true });
    shown.element.classList.add('ezclassify-locator--floating');
    document.body.append(shown.element);
}

/**
 * Install the console switch as `ezclassify.devtools`, keeping anything else a
 * page already put on an `ezclassify` global object.
 */
function installConsoleSwitch(): void {
    const scope = globalThis as { ezclassify?: unknown };
    if (scope.ezclassify === undefined) scope.ezclassify = {};
    const namespace = scope.ezclassify;
    if (typeof namespace === 'object' && namespace !== null)
        (namespace as { devtools?: typeof devtools }).devtools = devtools;
}

installConsoleSwitch();
