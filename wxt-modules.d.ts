// The wxt-module-safari-xcode package augments InlineConfig, but its own
// augmentation isn't picked up (no top-level "types" for a reference), so
// re-declare it here from the importable type. Lets `safariXcode` in
// wxt.config.ts typecheck.
import type { SafariXcodeOptions } from 'wxt-module-safari-xcode';
import type { AutoIconsOptions } from '@wxt-dev/auto-icons';

declare module 'wxt' {
  interface InlineConfig {
    safariXcode?: SafariXcodeOptions;
    autoIcons?: AutoIconsOptions;
  }
}
