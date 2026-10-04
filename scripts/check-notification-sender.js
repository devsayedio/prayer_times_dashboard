'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { sendTrackedNotification } = require('../lib/notification_sender');

const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function fixture(tokens, failEvery = 0, interrupt = false) {
  const events = new Map();
  const campaign = {};
  let sendCalls = 0;
  const logReference = {
    create: async data => Object.assign(campaign, data),
    update: async data => Object.assign(campaign, data),
    collection: () => ({ doc: id => id })
  };
  const db = {
    collection: name => name === 'device_tokens' ? {
      get: async () => ({ docs: tokens.map(token => ({ get: () => token })) })
    } : { doc: () => logReference },
    batch: () => {
      const writes = [];
      return {
        create: (id, data) => writes.push([id, data]),
        update: (id, data) => writes.push([id, data]),
        commit: async () => writes.forEach(([id, data]) => {
          events.set(id, { ...events.get(id), ...data });
        })
      };
    }
  };
  const messaging = {
    sendEach: async messages => {
      sendCalls++;
      assert.ok(messages.length <= 500);
      messages.forEach(message => {
        const { campaignId, receiptId, trackingToken } = message.data;
        assert.equal(receiptId, hash(message.token));
        assert.equal(events.get(receiptId).trackingTokenHash, hash(trackingToken));
        assert.equal(events.get(receiptId).trackingToken, undefined);
        assert.equal(campaignId, campaign.campaignId);
        assert.ok(campaign.timestamp);
        assert.equal(message.topic, undefined);
        assert.equal(message.data.imageUrl, 'https://example.com/image.jpg');
        assert.equal(message.data.actionUrl, 'https://example.com/action');
        assert.equal(message.fcmOptions.analyticsLabel, campaign.analyticsLabel);
      });
      if (interrupt) throw Object.assign(new Error('private FCM diagnostic'), { code: 'messaging/internal-error' });
      const responses = messages.map((_, index) => failEvery && (index + 1) % failEvery === 0
        ? { success: false, error: { code: 'messaging/invalid-registration-token' } }
        : { success: true, messageId: `fcm-${sendCalls}-${index}` });
      return {
        responses,
        successCount: responses.filter(response => response.success).length,
        failureCount: responses.filter(response => !response.success).length
      };
    }
  };
  return {
    db, messaging, campaign, events,
    get sendCalls() { return sendCalls; }
  };
}

async function send(state, target = 'all_users') {
  return sendTrackedNotification({
    db: state.db,
    messaging: state.messaging,
    target,
    fcmToken: 'single-device',
    title: 'Check',
    body: 'Sender contract check',
    imageUrl: 'https://example.com/image.jpg',
    actionUrl: 'https://example.com/action'
  });
}

async function main() {
  const all = fixture(['a', 'a', '', undefined, 'b'], 2);
  const result = await send(all);
  assert.equal(result.targetedCount, 2);
  assert.equal(result.sentCount, 1);
  assert.equal(result.failedCount, 1);
  assert.equal(all.events.size, 2);
  assert.equal(all.campaign.status, 'partial');
  console.log('PASS: registered recipients deduplicated; secrets exist before delivery; partial success retained');

  const single = fixture([]);
  assert.equal((await send(single, 'single_user')).targetedCount, 1);
  assert.equal(single.campaign.status, 'success');
  console.log('PASS: single-device target works without a registry entry');

  const many = fixture(Array.from({ length: 501 }, (_, index) => `device-${index}`));
  assert.equal((await send(many)).sentCount, 501);
  assert.equal(many.sendCalls, 2);
  console.log('PASS: more than 500 recipients split into supported FCM/Firestore batches');

  const empty = fixture([]);
  await assert.rejects(() => send(empty), error => error.statusCode === 400);
  assert.equal(empty.sendCalls, 0);
  assert.equal(empty.campaign.campaignId, undefined);
  console.log('PASS: empty audience creates no campaign and sends nothing');

  const interrupted = fixture(['a'], 0, true);
  await assert.rejects(() => send(interrupted), error =>
    error.statusCode === 502 && !error.message.includes('private FCM diagnostic'));
  assert.equal(interrupted.campaign.status, 'fail');
  assert.equal(interrupted.campaign.interrupted, true);
  console.log('PASS: interrupted campaign remains visible with sanitized diagnostics');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
