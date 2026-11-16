import { Component } from '@angular/core';
import { EzClassifyDirective } from '@ezclassify/angular';
import { DocumentStateComponent } from './document-state.component';
@Component({
    selector: 'app-root',
    imports: [EzClassifyDirective, DocumentStateComponent],
    template: `
        <section ezClassify>
            <form data-ezclassify-whole="document">
                <label for="document">Document marking</label>
                <input
                    id="document"
                    type="text"
                    name="documentMarking"
                    value="INTERNAL"
                    data-ezclassify-controller="marking" />

                <label for="attachment"
                    >Attachment marking (MarkingField)</label
                >
                <input
                    id="attachment"
                    name="attachmentMarking"
                    type="text"
                    value="PUBLIC"
                    data-ezclassify-controller="marking" />
                <label for="summary">Summary marking (TagInput)</label>
                <input
                    id="summary"
                    name="summaryMarking"
                    value="CONFIDENTIAL"
                    data-ezclassify-controller="tags" />
                <label for="title">Title (MarkedInput)</label>
                <input
                    id="title"
                    name="title"
                    type="text"
                    value="(PUBLIC) District report"
                    data-ezclassify-controller="marked-input" />
                <label for="body">Body (MarkedTextArea)</label>
                <textarea
                    id="body"
                    name="body"
                    data-ezclassify-controller="marked-textarea">
(INTERNAL) Planning notes.
(PUBLIC) Published background.</textarea>

                <p>Document preview</p>
                <div
                    data-ezclassify-controller="banner"
                    data-ezclassify-source="document"></div>
                <p>Computed parts</p>
                <div
                    data-ezclassify-controller="banner"
                    data-ezclassify-aggregate="document"></div>
                <app-document-state />
            </form>
        </section>
    `,
})
export class AppComponent {}
