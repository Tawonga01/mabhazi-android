export interface WorkerConnection {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  release(): void;
}
export interface WorkerPool { connect(): Promise<WorkerConnection> }
export type TickResult = { done: number; superseded: number; failedAttempts: number };
export type AssociationTickResult = TickResult & { continued: number };

/** One bounded SQL tick. Completion is reported only after its transaction commits. */
export async function drainNormalise(database: WorkerPool, limit=20): Promise<TickResult> {
  return drainStage(database,limit,false);
}
export async function drainAssociation(database: WorkerPool, limit=20): Promise<AssociationTickResult> {
  return await drainStage(database,limit,true) as AssociationTickResult;
}
async function drainStage(database: WorkerPool, limit:number, association:boolean): Promise<TickResult> {
  if (!Number.isInteger(limit) || limit<1 || limit>20) throw new Error('WORKER_BATCH_INVALID');
  const client=await database.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout='20s'");
    await client.query("SET LOCAL lock_timeout='5s'");
    const {rows}=await client.query(association ? 'SELECT public.v2_worker_drain_associate($1) result' : 'SELECT public.v2_worker_drain_normalise($1) result',[limit]);
    const result=rows[0]?.result as TickResult | undefined;
    if (!result || ![result.done,result.superseded,result.failedAttempts].every(v=>Number.isInteger(v) && v>=0 && v<=limit)) throw new Error('WORKER_RESULT_INVALID');
    if (association && (!Number.isInteger((result as AssociationTickResult).continued) || (result as AssociationTickResult).continued<0 || (result as AssociationTickResult).continued>limit)) throw new Error('WORKER_RESULT_INVALID');
    await client.query('COMMIT');
    return result;
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  } finally {client.release();}
}

export async function readWorkerHealth(database: WorkerPool): Promise<unknown> {
  const client=await database.connect();
  try {
    const {rows}=await client.query('SELECT public.v2_worker_health() result');
    return rows[0]?.result;
  } finally {client.release();}
}
