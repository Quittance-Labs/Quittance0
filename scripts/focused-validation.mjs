import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const mode=process.argv[2]??'seller-session';
if(mode==='disabled'){
  process.stdout.write('Broad test sweeps are disabled for this work. Use the focused seller-session check.\n');
  process.exit(0);
}
if(mode!=='seller-session'){
  process.stderr.write('Unknown focused validation target.\n');
  process.exit(2);
}
const pattern='requires a recent signature bound to the seller and read scope';
const run=spawnSync(process.execPath,['--import','tsx','--test','--test-reporter=spec','--test-name-pattern',pattern,'tests/invoice-handlers.test.ts'],{
  cwd:resolve(root,'backend'),stdio:'inherit',env:{...process.env,NODE_ENV:'test',STELLAR_NETWORK:'TESTNET',STELLAR_HORIZON_URL:'http://127.0.0.1:1'}
});
if(run.error){process.stderr.write(`${run.error.message}\n`);process.exit(2);}
process.exit(run.status??2);
