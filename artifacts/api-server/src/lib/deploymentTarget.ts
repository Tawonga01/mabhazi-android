import { normalizeOrigin } from './origins';
type Environment = Record<string, string | undefined>;
const PRODUCTION_REF = 'zmlpmsrnocyqxoncmzgh';

function variant(env: Environment) {
  const value = env.MABHAZI_DEPLOYMENT || 'production';
  if (value !== 'production' && value !== 'preview') throw new Error('Invalid deployment target.');
  return value;
}
/** Native callback is server configuration, never a caller-supplied redirect. */
export function mobileAuthRedirect(env: Environment = process.env) {
  return variant(env) === 'preview' ? 'mabhazipreview://auth/callback' : 'mabhazicom://auth/callback';
}
/** Fail closed if a preview service is wired to production identity or data. */
export function validateDeploymentTarget(env: Environment = process.env): void {
  if (variant(env) !== 'preview') return;
  try {
    const ref = env.MABHAZI_PREVIEW_SUPABASE_REF;
    if (!ref || !/^[a-z0-9]{20}$/.test(ref) || ref === PRODUCTION_REF) throw new Error();
    const auth = new URL(normalizeOrigin(env.SUPABASE_URL || ''));
    const api = new URL(normalizeOrigin(env.PUBLIC_ORIGIN || ''));
    const database = new URL(env.DATABASE_URL || '');
    if (auth.hostname !== `${ref}.supabase.co` || ['api.mabhazi.com','mabhazi.com','www.mabhazi.com'].includes(api.hostname)) throw new Error();
    if (!['postgres:','postgresql:'].includes(database.protocol)) throw new Error();
    const direct = database.hostname === `db.${ref}.supabase.co` && decodeURIComponent(database.username) === 'mabhazi_api';
    const pooled = database.hostname.endsWith('.pooler.supabase.com') && decodeURIComponent(database.username) === `mabhazi_api.${ref}`;
    if (!direct && !pooled) throw new Error();
  } catch { throw new Error('Preview requires its own Supabase project, restricted database role and HTTPS API origin.'); }
}
