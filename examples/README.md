# Examples

Each example is the document form from its package README, as an app you can
run: one document marking, the parts inside it, and one form store.

| Example                                | README                                                     | Start         |
| -------------------------------------- | ---------------------------------------------------------- | ------------- |
| [`vanilla-example`](./vanilla-example) | [`@ezclassify/ui`](../libs/ui/README.md)                   | `npm run dev` |
| [`react-example`](./react-example)     | [`@ezclassify/react`](../integrations/react/README.md)     | `npm run dev` |
| [`vue-example`](./vue-example)         | [`@ezclassify/vue`](../integrations/vue/README.md)         | `npm run dev` |
| [`angular-example`](./angular-example) | [`@ezclassify/angular`](../integrations/angular/README.md) | `npm start`   |

Each one connects to the Cedar Valley replay from
[`@ezclassify/conformance-server`](https://www.npmjs.com/package/@ezclassify/conformance-server)
by default, so it runs before you have a runtime. Start the server, start the
app, and see the form work; then point the app at your runtime. Each example's
README has the two commands and the one setting to change.

None of them carries an engine, as a dependency or in a bundle.
`npm run check:consumer-engine-free` proves it on every CI run.
