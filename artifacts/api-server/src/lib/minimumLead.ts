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
export async function saveIntake(actor: string, input: unknown, facade: 'v2_api_submit_minimum_lead' | 'v2_api_submit_actual_journey' | 'v2_api_submit_public_actual_journey' | 'v2_api_submit_route_observations' | 'v2_api_submit_pickup_question_answer', database: IntakePool = pool, blocked: string[] = [], invitation?: string) {
  for (let attempt = 0; ; attempt++) {
    const client = await database.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout='8s'");
      const prompted = facade === 'v2_api_submit_pickup_question_answer';
      if (prompted && !invitation) throw new Error('Pickup question invitation required');
      const isPublic = prompted || facade === 'v2_api_submit_public_actual_journey' || facade === 'v2_api_submit_route_observations';
      const { rows } = await client.query(`SELECT public.${facade}($1,$2,$3::jsonb${isPublic ? ',$4::varchar[]' : ''}${prompted ? ',$5::uuid' : ''}) receipt`,
        [actor, CURRENT_TERMS_VERSION, JSON.stringify(input), ...(isPublic ? [blocked] : []), ...(prompted ? [invitation] : [])]);
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
