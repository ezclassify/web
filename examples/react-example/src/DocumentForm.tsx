import { EzClassify } from '@ezclassify/react';
import { DocumentState } from './DocumentState';

export function DocumentForm() {
    return (
        <EzClassify>
            <form data-ezclassify-whole="document">
                <label htmlFor="document">Document marking</label>
                <input
                    type="text"
                    id="document"
                    name="documentMarking"
                    defaultValue="INTERNAL"
                    data-ezclassify-controller="marking"
                />

                <label htmlFor="attachment">
                    Attachment marking (MarkingField)
                </label>
                <input
                    type="text"
                    id="attachment"
                    name="attachmentMarking"
                    defaultValue="PUBLIC"
                    data-ezclassify-controller="marking"
                />
                <label htmlFor="summary">Summary marking (TagInput)</label>
                <input
                    id="summary"
                    name="summaryMarking"
                    defaultValue="CONFIDENTIAL"
                    data-ezclassify-controller="tags"
                />
                <label htmlFor="title">Title (MarkedInput)</label>
                <input
                    type="text"
                    id="title"
                    name="title"
                    defaultValue="(PUBLIC) District report"
                    data-ezclassify-controller="marked-input"
                />
                <label htmlFor="body">Body (MarkedTextArea)</label>
                <textarea
                    id="body"
                    name="body"
                    defaultValue={
                        '(INTERNAL) Planning notes.\n(PUBLIC) Published background.'
                    }
                    data-ezclassify-controller="marked-textarea"
                />

                <p>Document preview</p>
                <div
                    data-ezclassify-controller="banner"
                    data-ezclassify-source="document"
                />
                <p>Computed parts</p>
                <div
                    data-ezclassify-controller="banner"
                    data-ezclassify-aggregate="document"
                />
                <DocumentState />
            </form>
        </EzClassify>
    );
}
