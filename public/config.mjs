// The universal edition suggests browser STT on iPhone and cloud STT on Android.
export const EDITION = 'UNIVERSAL';
export const VERSION = '0.5.0';
export const DEFAULT_STT = /Android/i.test(navigator.userAgent) ? 'cloud' : 'browser';
