/// <reference types="vite/client" />

interface ImportMetaEnv {
    /** EzClassify server the example connects to. */
    readonly VITE_EZCLASSIFY_URL?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
