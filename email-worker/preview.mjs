import { writeFile } from 'node:fs/promises';
import { renderReceipt } from './template.mjs';
export const example={reference:'PY-DEMO01',restaurant:'Pizzería de ejemplo',delivered_at:'2026-10-30T21:30:00Z',
 items:[{name:'Pizza Margherita mediana',qty:1,amount:189},{name:'Agua mineral',qty:2,amount:40}],
 subtotal:229,delivery:25,fee:15,total:269,payment_method:'cash'};
const result=renderReceipt(example);
await writeFile(new URL('./preview.html',import.meta.url),result.html);
await writeFile(new URL('./preview.txt',import.meta.url),result.text);
console.log('Preview generated using synthetic data only; no email sent.');
