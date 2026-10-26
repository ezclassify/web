import { InjectionToken } from '@angular/core';
import type { EzClassifyClient } from '@ezclassify/rest-client';
export const CLIENT = new InjectionToken<EzClassifyClient>('EzClassify client');
