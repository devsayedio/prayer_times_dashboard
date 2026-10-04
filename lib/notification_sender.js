'use strict';

const crypto = require('crypto');
const { FieldValue, Timestamp } = require('firebase-admin/firestore');

const hash = value => crypto.createHash('sha256').update(value).digest('hex');

async function sendTrackedNotification({ db, messaging, target, title, body, fcmToken, imageUrl, actionUrl }) {
  const tokens = target === 'single_user'
    ? [fcmToken]
    : [...new Set((await db.collection('device_tokens').get()).docs
      .map(document => document.get('token'))
      .filter(token => typeof token === 'string' && token.trim())
      .map(token => token.trim()))];
  if (!tokens.length) {
    const error = new Error('No registered device tokens found.');
    error.statusCode = 400;
    throw error;
  }

  const campaignId = crypto.randomUUID();
  const analyticsLabel = `campaign_${campaignId.replaceAll('-', '')}`;
  const logReference = db.collection('notification_logs').doc(campaignId);
  await logReference.create({
    timestamp: FieldValue.serverTimestamp(),
    target,
    targetedCount: tokens.length,
    receivedCount: 0,
    openedCount: 0,
    sentCount: 0,
    failedCount: 0,
    title,
    body,
    imageUrl,
    actionUrl,
    analyticsLabel,
    campaignId,
    trackingVersion: 1,
    status: 'sending'
  });

  let sentCount = 0;
  let failedCount = 0;
  let messageId = null;
  try {
    for (let offset = 0; offset < tokens.length; offset += 500) {
      const recipients = tokens.slice(offset, offset + 500).map(token => ({
        token,
        receiptId: hash(token),
        trackingToken: crypto.randomBytes(32).toString('hex')
      }));
      const receiptBatch = db.batch();
      for (const recipient of recipients) {
        receiptBatch.create(logReference.collection('device_events').doc(recipient.receiptId), {
          trackingTokenHash: hash(recipient.trackingToken),
          createdAt: FieldValue.serverTimestamp(),
          expiresAt: Timestamp.fromMillis(Date.now() + 7 * 86_400_000)
        });
      }
      // Persist authorization before delivering a message that can be acknowledged.
      await receiptBatch.commit();

      const result = await messaging.sendEach(recipients.map(recipient => {
        const data = {
          type: 'push',
          campaignId,
          receiptId: recipient.receiptId,
          trackingToken: recipient.trackingToken
        };
        if (imageUrl) data.imageUrl = imageUrl;
        if (actionUrl) data.actionUrl = actionUrl;
        return {
          token: recipient.token,
          notification: { title, body },
          data,
          android: {
            priority: 'high',
            notification: {
              sound: 'hayya_ala_salah',
              channelId: 'com.amatullah.prayer_times_push_notification',
              ...(imageUrl ? { imageUrl } : {})
            }
          },
          fcmOptions: { analyticsLabel }
        };
      }));
      sentCount += result.successCount;
      failedCount += result.failureCount;
      const resultBatch = db.batch();
      result.responses.forEach((response, index) => {
        if (response.success) messageId ??= response.messageId;
        resultBatch.update(
          logReference.collection('device_events').doc(recipients[index].receiptId),
          response.success ? {
            sendAcceptedAt: FieldValue.serverTimestamp(),
            fcmMessageId: response.messageId
          } : { sendErrorCode: response.error?.code || 'unknown' }
        );
      });
      await resultBatch.commit();
      await logReference.update({ sentCount, failedCount });
    }

    const status = sentCount === 0 ? 'fail' : failedCount > 0 ? 'partial' : 'success';
    await logReference.update({
      status,
      sentCount,
      failedCount,
      messageId,
      sentAt: FieldValue.serverTimestamp()
    });
    return {
      success: sentCount > 0,
      message: `FCM accepted ${sentCount} of ${tokens.length} targeted devices; rejected ${failedCount}.`,
      messageId,
      campaignId,
      targetedCount: tokens.length,
      sentCount,
      failedCount
    };
  } catch (error) {
    await logReference.update({
      status: sentCount > 0 ? 'partial' : 'fail',
      interrupted: true,
      sentCount,
      failedCount,
      errorCode: error.code || 'send-interrupted',
      failedAt: FieldValue.serverTimestamp()
    }).catch(() => {});
    const safeError = new Error('Notification sending was interrupted. Check campaign history before retrying.');
    safeError.statusCode = 502;
    throw safeError;
  }
}

module.exports = { sendTrackedNotification };
