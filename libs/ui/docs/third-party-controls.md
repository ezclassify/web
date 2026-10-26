# Third-party control compatibility

EzClassify supports two independent UI paths:

1. EzClassify-rendered controls selected with `data-ezclassify-controller`.
2. Any application- or library-rendered control connected through the headless
   facet binding contract.

The headless contract is the compatibility guarantee. A control is compatible
when application code can:

- give it an array of options and selected concept ids;
- receive its next selected concept ids;
- refresh it when subscribed state changes; and
- dispose its event/subscription handlers.

That includes controlled framework components, Angular
`ControlValueAccessor` components, Vue `v-model` components, web components,
and jQuery plugins. It does not require a native `<select>`, direct DOM access,
or forwarding `data-*` attributes.

## Native select

A native select does not need a custom adapter. Bind it in place:

```html
<select
    data-ezclassify-bind
    data-ezclassify-facet-of="document-marking"
    data-ezclassify-category="handling"
    multiple></select>
```

The runtime supplies governed options, reflects selected concept ids, observes
the normal `change` event, updates `aria-invalid`, and emits
`ezclassify:sync` after it refreshes the control. Plugins that enhance a real
select, such as Select2, can repaint from that event while keeping their normal
initialization and teardown.

Framework packages expose library-native conveniences for composite controls:

- React: `useEzClassifyFacet(markingId, categoryId)`
- Vue: `useEzClassifyFacet(markingId, categoryId)`
- Angular: `injectEzClassifyFacet(markingId, categoryId)`

All three are projections of the store's facet cell and marking cell, wrapped in
the framework's own reactive primitive. None of them holds state, so a control
bound through one and a control bound through the universal adapter below read
the same values at the same moment.

Use the universal adapter when authoring a new framework integration or when a
control cannot consume those standard shapes.

## Universal adapter

```ts
import { createEzClassifyFacetBinding } from '@ezclassify/ui';

const binding = createEzClassifyFacetBinding(
    store,
    'document-marking',
    'dissemination_controls',
);

await binding.ready;
// `ready` includes the first governed-options snapshot.
const stop = binding.subscribe((snapshot) => {
    // Give these plain values to the UI library in its normal way.
    updateOptions(snapshot.allowableOptions);
    updateValue(snapshot.selectedConceptIds);
    showValidation(snapshot.marking.valid, snapshot.marking.errors);
});

onLibraryValueChange((ids) => binding.setSelected(ids));

// Component/plugin teardown:
stop();
binding.destroy();
```

For a single-select, pass zero or one concept id to `setSelected`. For a
multiselect, pass every selected concept id. A selected item may instead be
`{ conceptId, value }` when the concept captures a value.

## jQuery / Select2 shape

```ts
const binding = createEzClassifyFacetBinding(
    store,
    'document-marking',
    'dissemination_controls',
);
const $control = $('#controls').select2({ multiple: true });

await binding.ready;
$control.on('change.ezclassify', () => {
    void binding.setSelected($control.val() ?? []);
});

const stop = binding.subscribe(({ selectedConceptIds, allowableOptions }) => {
    const select = $control[0] as HTMLSelectElement;
    const labels = new Map<string, string>();
    if (allowableOptions === null) {
        for (const option of select.options)
            labels.set(option.value, option.text);
    } else {
        for (const option of allowableOptions) {
            labels.set(option.conceptId, option.label);
        }
    }
    // Keep selected values visible even when they are no longer addable.
    for (const id of selectedConceptIds) {
        if (!labels.has(id)) labels.set(id, id);
    }
    select.replaceChildren(
        ...Array.from(labels, ([id, label]) => new Option(label, id)),
    );
    // Trigger only Select2's display refresh, not the application change
    // handler above.
    $control.val(selectedConceptIds).trigger('change.select2');
});

function destroy() {
    stop();
    binding.destroy();
    $control.off('.ezclassify').select2('destroy');
}
```

## Native text input binding

`data-ezclassify-bind` with `data-ezclassify-bound-to` remains the concise
option for a raw marking input. Native selects use `data-ezclassify-facet-of`
and `data-ezclassify-category` as shown above. A composite control that renders
portals, hides its native input, or does not forward attributes should use its
framework adapter or the universal adapter.
