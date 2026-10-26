import type { InjectionKey } from 'vue';
import type { EzClassifyClient } from '@ezclassify/rest-client';
export const ClientKey: InjectionKey<EzClassifyClient> =
    Symbol('EzClassify client');
