// Dedicated throwaway cluster; no URL/env credentials, no path to production.
import { mkdtempSync,rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=mkdtempSync('/private/tmp/pideya-email-qa-');
const bin=process.env.PG_BIN || '/opt/homebrew/opt/postgresql@14/bin';
const port='55447';
function run(name,args){const r=spawnSync(`${bin}/${name}`,args,{encoding:'utf8'});if(r.status!==0)throw Error(`${name}: ${r.stderr}\n${r.stdout}`);return r.stdout;}
try {
 run('initdb',['-D',`${root}/data`,'-A','trust','--no-locale','--encoding=UTF8']);
 run('pg_ctl',['-D',`${root}/data`,'-l',`${root}/pg.log`,'-o',`-k ${root} -p ${port} -h ''`,'-w','start']);
 for(const file of ['./schema.sql','../../supabase/migrations/060_order_receipt_email.sql','./outbox.sql']){
   const actual=fileURLToPath(new URL(file,import.meta.url));
   const r=spawnSync(`${bin}/psql`,['-h',root,'-p',port,'-d','postgres','-v','ON_ERROR_STOP=1','-f',actual],{encoding:'utf8'});
   if(r.status!==0)throw Error(r.stderr);if(file==='./outbox.sql')process.stdout.write(r.stderr);
 }
} finally {
 spawnSync(`${bin}/pg_ctl`,['-D',`${root}/data`,'-m','immediate','-w','stop'],{encoding:'utf8'});
 rmSync(root,{recursive:true,force:true});
}
