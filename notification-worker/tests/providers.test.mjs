import {test} from 'node:test';
import assert from 'node:assert/strict';
import {messageFor} from '../providers.mjs';

test('merchant branded sound is opt-in and never affects client or driver channels', () => {
  const previous=process.env.PIDEYA_MERCHANT_SOUND_V3;
  try {
    const job={endpoint:{app:'restaurant'},event:{id:'event',order_id:'order',title:'Nuevo',body:'Pedido',revision:1,expires_at:new Date(Date.now()+60000).toISOString()}};
    delete process.env.PIDEYA_MERCHANT_SOUND_V3;
    assert.equal(messageFor(job).sound,'default');
    process.env.PIDEYA_MERCHANT_SOUND_V3='true';
    assert.equal(messageFor(job).channelId,'kds_new_order_alarm_v3');
    assert.equal(messageFor(job).sound,'pideya_order.wav');
    assert.equal(messageFor({...job,endpoint:{app:'client'}}).sound,'default');
  } finally {if(previous===undefined)delete process.env.PIDEYA_MERCHANT_SOUND_V3;else process.env.PIDEYA_MERCHANT_SOUND_V3=previous;}
});
