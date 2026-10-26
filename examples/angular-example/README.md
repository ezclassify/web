# Angular example

The document form from the [`@ezclassify/angular` README](../../integrations/angular/README.md#mark-a-document-and-its-parts),
as an app you can run. One document marking, the parts inside it, one form
store, and nothing else. No engine ships in it: every answer comes from the
EzClassify server it connects to.

## Run it against the replay server

The conformance server replays recorded answers for Cedar Valley, a fictional
school district's teaching policy, so you can see the form working before you
have a runtime. In one terminal:

```bash
npx @ezclassify/conformance-server --scenario cedar-valley --port 4010 \
  --cors-origin http://localhost:4200
```

In another, from this directory:

```bash
npm install
npm start
```

Open `http://localhost:4200`. Focus each control, browse its picker, open the
marking popup in the title or body with Ctrl+Enter (Cmd+Enter on macOS), select
**Set document to CONFIDENTIAL**, then edit the title to `(PUBLIC) District
report card` and the body's first line to `(CONFIDENTIAL) Planning notes.` The
document marking ends at CONFIDENTIAL and covers every part. The replay records
that path; other values need your runtime.

## Point it at your runtime

Change `ezclassifyUrl` in [`src/environments/environment.ts`](src/environments/environment.ts) to your runtime's
REST URL. Your runtime has to allow this page's origin, or serve the page from
its own origin.

A real runtime also wants credentials. Add them to `connectContext` as the
[README's Switch to your runtime section](../../integrations/angular/README.md#switch-to-your-runtime)
shows. Name your own provisioned Context if it is not `cedar-valley`.
