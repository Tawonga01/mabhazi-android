import { pool } from '@workspace/db';
import { SubmitV2LeadResponse } from '@workspace/api-zod';
import { CURRENT_TERMS_VERSION } from './terms';

export interface IntakeConnection {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  release(): void;
}
export interface IntakePool { connect(): Promise<IntakeConnection> }

/** A response exists only after COMMIT. Ambiguous commit failures require receipt lookup. */
export async function saveMinimumLead(actor: string, input: unknown, database: IntakePool = pool) {
  return saveIntake(actor,input,'v2_api_submit_minimum_lead',database);
}
export async function saveIntake(actor: string, input: unknown, facade: 'v2_api_submit_minimum_lead' | 'v2_api_submit_actual_journey' | 'v2_api_submit_public_actual_journey', database: IntakePool = pool, blocked: string[] = []) {
  for (let attempt = 0; ; attempt++) {
    const client = await database.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout='8s'");
      const isPublic = facade === 'v2_api_submit_public_actual_journey';
      const { rows } = await client.query(`SELECT public.${facade}($1,$2,$3::jsonb${isPublic ? ',$4::varchar[]' : ''}) receipt`,
        [actor, CURRENT_TERMS_VERSION, JSON.stringify(input), ...(isPublic ? [blocked] : [])]);
      const receipt = SubmitV2LeadResponse.parse(rows[0]?.receipt);
      await client.query('COMMIT');
      return receipt;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if ((error as { code?: string }).code === '40001' && attempt < 2) continue;
      throw error;
    } finally { client.release(); }
  }
}
