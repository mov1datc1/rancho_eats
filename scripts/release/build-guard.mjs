import {validateEnvironment} from './environment.mjs';
if(process.env.VERCEL_ENV==='preview' || process.env.PIDEYA_ENV){
 try{validateEnvironment(process.env);}catch(error){console.error(error.message);process.exit(1);}
}
