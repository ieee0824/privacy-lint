/** Default relay endpoint, injected at build time (scripts/build.mjs). */
declare const __RELAY_URL__: string;
/**
 * True only in `--e2e` builds. Guards the storage-dump hook used by tests/e2e/run.mjs;
 * the guarded code is removed from normal builds (checked by scripts/build.mjs).
 */
declare const __E2E__: boolean;
