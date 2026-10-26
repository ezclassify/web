import { Component, inject } from '@angular/core';
import { EzClassifyDirective } from '@ezclassify/angular';
import { CLIENT } from './client-token';
import { DocumentSummaryComponent } from './document-summary.component';
@Component({
    selector: 'app-document-editor',
    imports: [EzClassifyDirective, DocumentSummaryComponent],
    template: `
        <section [ezClassify]="client">
            <form id="document-form">
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
                    data-ezclassify-controller="marking"
                    data-ezclassify-part-of="document"
                    value="PUBLIC" />
                <label for="summary">Summary marking (TagInput)</label>
                <input
                    id="summary"
                    name="summaryMarking"
                    value="CONFIDENTIAL"
                    data-ezclassify-controller="tags"
                    data-ezclassify-part-of="document" />
                <label for="title">Title (MarkedInput)</label>
                <input
                    id="title"
                    name="title"
                    type="text"
                    data-ezclassify-controller="marked-input"
                    data-ezclassify-part-of="document"
                    value="(PUBLIC) District report" />
                <label for="body">Body (MarkedTextArea)</label>
                <textarea
                    id="body"
                    name="body"
                    data-ezclassify-controller="marked-textarea"
                    data-ezclassify-part-of="document">
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
                <app-document-summary />
            </form>
        </section>
    `,
})
export class DocumentEditorComponent {
    readonly client = inject(CLIENT);
}
