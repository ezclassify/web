import { provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { connectContext } from '@ezclassify/rest-client';
import { AppComponent } from './app.component';
import { CLIENT } from './client-token';
import { environment } from './environments/environment';

async function start() {
    const client = await connectContext({
        baseUrl: environment.ezclassifyUrl,
        contextId: 'cedar-valley',
        contextVersion: '1.0.0',
    });
    const app = await bootstrapApplication(AppComponent, {
        providers: [
            provideZonelessChangeDetection(),
            { provide: CLIENT, useValue: client },
        ],
    });
    app.onDestroy(() => client.destroy());
}

void start().catch((error: unknown) => {
    const host = document.querySelector('app-root');
    if (host) {
        host.textContent =
            'Unable to start the document editor. Please try again.';
    }
    console.error(error);
});
