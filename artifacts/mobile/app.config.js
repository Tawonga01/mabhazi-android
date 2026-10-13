const { validateApiOrigin } = require('./scripts/release-preflight');

// Preserve the existing production config exactly; preview is a separate install.
module.exports = ({ config }) => {
  const variant = process.env.EXPO_PUBLIC_APP_VARIANT || 'production';
  if (!['production', 'preview'].includes(variant)) throw new Error('Unknown Mabhazi app variant.');
  if (variant === 'production') return config;
  const api = validateApiOrigin(process.env.EXPO_PUBLIC_API_BASE_URL || '');
  const hostname = new URL(api).hostname;
  if (['api.mabhazi.com', 'mabhazi.com', 'www.mabhazi.com'].includes(hostname) || /(^|\.)(replit\.com|replit\.dev|replit\.app|repl\.co)$/.test(hostname)) throw new Error('Preview requires its own API origin.');
  const versionCode = Number(process.env.MABHAZI_PREVIEW_VERSION_CODE || '1');
  if (!Number.isSafeInteger(versionCode) || versionCode < 1) throw new Error('Invalid preview version code.');
  return {
    ...config, name: 'Mabhazi Preview', scheme: 'mabhazipreview',
    android: { ...config.android, package: 'com.mabhazicom.preview', versionCode },
    ios: { ...config.ios, bundleIdentifier: 'com.mabhazicom.preview' },
    extra: { ...config.extra, appVariant: 'preview', previewApiOrigin: api },
  };
};
