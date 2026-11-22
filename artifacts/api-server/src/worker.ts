import { validateDeploymentTarget } from './lib/deploymentTarget';
import { drainNormalise, drainAssociation, drainAssessment, drainTasks, readWorkerHealth } from './lib/normaliseWorker';

async function main() {
  // This first-stage delivery has no authority to process production data.
  if (process.env.MABHAZI_DEPLOYMENT!=='preview') throw new Error('WORKER_PREVIEW_REQUIRED');
  validateDeploymentTarget();
  const mode=process.argv[2] || 'drain';
  if (!['drain','associate','assess','tasks','health'].includes(mode)) throw new Error('WORKER_MODE_INVALID');
  const raw=process.argv[3] || '20';
  if (!/^[0-9]+$/.test(raw) || Number(raw)<1 || Number(raw)>20) throw new Error('WORKER_BATCH_INVALID');
  const {pool}=await import('@workspace/db');
  try {
    const result=mode==='health' ? await readWorkerHealth(pool) : mode==='tasks' ? await drainTasks(pool,Number(raw)) : mode==='assess' ? await drainAssessment(pool,Number(raw)) : mode==='associate' ? await drainAssociation(pool,Number(raw)) : await drainNormalise(pool,Number(raw));
    process.stdout.write(JSON.stringify(result)+'\n');
  } finally {await pool.end();}
}
void main().catch(()=>{process.stderr.write('WORKER_FAILED: verify preview target, schema, permissions and queue health.\n');process.exitCode=1;});
