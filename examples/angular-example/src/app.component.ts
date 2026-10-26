import { Component } from '@angular/core';
import { DocumentEditorComponent } from './document-editor.component';
@Component({
    selector: 'app-root',
    imports: [DocumentEditorComponent],
    template: '<app-document-editor />',
})
export class AppComponent {}
