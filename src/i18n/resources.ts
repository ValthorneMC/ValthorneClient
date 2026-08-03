import enCommon from './locales/en/common.json';
import enHome from './locales/en/home.json';
import enInstance from './locales/en/instance.json';
import enSettings from './locales/en/settings.json';
import enUpdater from './locales/en/updater.json';
import enSkins from './locales/en/skins.json';
import enAuth from './locales/en/auth.json';
import enErrors from './locales/en/errors.json';
import enNotifications from './locales/en/notifications.json';

import esCommon from './locales/es/common.json';
import esHome from './locales/es/home.json';
import esInstance from './locales/es/instance.json';
import esSettings from './locales/es/settings.json';
import esUpdater from './locales/es/updater.json';
import esSkins from './locales/es/skins.json';
import esAuth from './locales/es/auth.json';
import esErrors from './locales/es/errors.json';
import esNotifications from './locales/es/notifications.json';

/** English is the reference catalog: it defines the shape of every namespace. */
export const enResources = {
  common: enCommon,
  home: enHome,
  instance: enInstance,
  settings: enSettings,
  updater: enUpdater,
  skins: enSkins,
  auth: enAuth,
  errors: enErrors,
  notifications: enNotifications,
} as const;

export const resources = {
  en: enResources,
  es: {
    common: esCommon,
    home: esHome,
    instance: esInstance,
    settings: esSettings,
    updater: esUpdater,
    skins: esSkins,
    auth: esAuth,
    errors: esErrors,
    notifications: esNotifications,
  },
} as const;
