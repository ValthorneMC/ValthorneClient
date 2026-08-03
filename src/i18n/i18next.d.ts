import 'i18next';
import type { enResources } from './resources';
import type { DEFAULT_NAMESPACE } from './config';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: typeof DEFAULT_NAMESPACE;
    resources: typeof enResources;
  }
}
