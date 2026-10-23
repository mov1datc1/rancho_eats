// Never print credentials. Support hosted Supabase direct and shared-pooler URLs.
const ref=process.env.EXPECTED_SUPABASE_REF;
try {
 const u=new URL(process.env.STAGING_DATABASE_URL);
 const pool=u.hostname.endsWith('.pooler.supabase.com') && decodeURIComponent(u.username)===`postgres.${ref}`;
 const direct=u.hostname===`db.${ref}.supabase.co`;
 if(!ref || ref===process.env.PRODUCTION_SUPABASE_REF || !['postgres:','postgresql:'].includes(u.protocol) || !(pool||direct) || u.pathname!=='/postgres') throw new Error();
 if(u.searchParams.get('sslmode')!=='require') throw new Error();
 console.log('Staging database target validated');
} catch {console.error('Database URL must target the isolated staging project with sslmode=require');process.exitCode=1;}
