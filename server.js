'use strict';

require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { applicationDefault, cert, getApps, initializeApp } = require('firebase-admin/app');
const { FieldValue, Timestamp, getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { sendTrackedNotification } = require('./lib/notification_sender');
const packageInfo = require('./package.json');

const ROOT = __dirname;
const PORT = positiveInteger(process.env.PORT, 3000, 65_535);
const PROJECT_ID = String(process.env.FIREBASE_PROJECT_ID || 'prayer-times-6163f').trim();
const SERVICE_ACCOUNT_PATH = path.resolve(
  ROOT,
  process.env.FIREBASE_SERVICE_ACCOUNT || 'service-account.json'
);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DASHBOARD_USERNAME = String(process.env.DASHBOARD_USERNAME || '').trim();
const DASHBOARD_PASSWORD = String(process.env.DASHBOARD_PASSWORD || '');
const hasDashboardCredentials = Boolean(DASHBOARD_USERNAME && DASHBOARD_PASSWORD);

if (IS_PRODUCTION && !hasDashboardCredentials) {
  throw new Error('DASHBOARD_USERNAME and DASHBOARD_PASSWORD are required in production.');
}

const credential = fs.existsSync(SERVICE_ACCOUNT_PATH)
  ? cert(JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8')))
  : applicationDefault();

if (!getApps().length) {
  initializeApp({ credential, projectId: PROJECT_ID });
}

const db = getFirestore();
const messaging = getMessaging();
const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.use((req, res, next) => {
  res.set({
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY'
  });
  next();
});
app.use(requireDashboardAccess);
app.use(express.static(path.join(ROOT, 'public'), { etag: true, maxAge: IS_PRODUCTION ? '1h' : 0 }));

function positiveInteger(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? Math.min(number, max) : fallback;
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function isLoopback(req) {
  const address = req.socket.remoteAddress || '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function requireDashboardAccess(req, res, next) {
  if (!hasDashboardCredentials && !IS_PRODUCTION && isLoopback(req)) return next();

  const authorization = String(req.headers.authorization || '');
  if (authorization.startsWith('Basic ')) {
    try {
      const [username = '', password = ''] = Buffer.from(authorization.slice(6), 'base64')
        .toString('utf8')
        .split(/:(.*)/s, 2);
      if (safeEqual(username, DASHBOARD_USERNAME) && safeEqual(password, DASHBOARD_PASSWORD)) {
        return next();
      }
    } catch (_) {
      // Fall through to the authentication challenge.
    }
  }

  res.set('WWW-Authenticate', 'Basic realm="Prayer Times Admin", charset="UTF-8"');
  return res.status(401).send('Authentication required.');
}

function text(value, maxLength = 500) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function boolean(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function number(value, fallback = 0, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function required(value, name, maxLength = 500) {
  const result = text(value, maxLength);
  if (!result) {
    const error = new Error(`${name} is required.`);
    error.statusCode = 400;
    throw error;
  }
  return result;
}

function validId(value) {
  const result = text(value, 160);
  if (!result || result.includes('/')) {
    const error = new Error('Invalid document ID.');
    error.statusCode = 400;
    throw error;
  }
  return result;
}

function isoDate(value, name = 'date') {
  const result = required(value, name, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(Date.parse(`${result}T00:00:00Z`))) {
    const error = new Error(`${name} must use YYYY-MM-DD.`);
    error.statusCode = 400;
    throw error;
  }
  return result;
}

function serialize(value) {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serialize(item)]));
  }
  return value;
}

function documentData(document) {
  return { id: document.id, ...serialize(document.data()) };
}

function eventPayload(body) {
  const date = isoDate(body.date);
  return {
    title: required(body.title, 'title', 140),
    description: text(body.description, 1200),
    holiday_type: text(body.holiday_type, 80),
    date,
    color: /^#[\dA-Fa-f]{6}$/.test(text(body.color, 7)) ? text(body.color, 7) : '#4D7AEB',
    year: positiveInteger(body.year, Number(date.slice(0, 4)), 2200),
    is_active: boolean(body.is_active, true),
    updated_at: FieldValue.serverTimestamp()
  };
}

function paymentPayload(body) {
  const paymentType = text(body.payment_type, 20);
  if (!['bank', 'mobile'].includes(paymentType)) {
    const error = new Error('payment_type must be bank or mobile.');
    error.statusCode = 400;
    throw error;
  }

  const shared = {
    payment_type: paymentType,
    bank_name: required(body.bank_name, 'bank_name', 120),
    icon_path: text(body.icon_path, 400),
    card_color: /^#[\dA-Fa-f]{6}$/.test(text(body.card_color, 7)) ? text(body.card_color, 7) : '#4D7AEB',
    is_active: boolean(body.is_active, true),
    updated_at: FieldValue.serverTimestamp()
  };
  if (paymentType === 'mobile') {
    return { ...shared, number: required(body.number, 'number', 60) };
  }
  return {
    ...shared,
    account_number: required(body.account_number, 'account_number', 100),
    account_holder_name: text(body.account_holder_name, 140),
    branch_name: text(body.branch_name, 140),
    routing_number: text(body.routing_number, 100),
    swift_code: text(body.swift_code, 80),
    district: text(body.district, 100)
  };
}

function qariPayload(body) {
  const durations = body.durations && typeof body.durations === 'object'
    ? Object.fromEntries(Object.entries(body.durations)
      .filter(([key, value]) => /^\d{3}$/.test(key) && Number.isFinite(Number(value)) && Number(value) > 0)
      .map(([key, value]) => [key, Math.round(Number(value))]))
    : {};
  return {
    name: required(body.name, 'name', 140),
    name_ar: text(body.name_ar, 140),
    name_bn: text(body.name_bn, 140),
    subtitle: text(body.subtitle, 240),
    subtitle_bn: text(body.subtitle_bn, 240),
    language: text(body.language, 80),
    language_code: text(body.language_code, 16),
    flag: text(body.flag, 20),
    country: text(body.country, 80),
    country_bn: text(body.country_bn, 80),
    image_url: text(body.image_url, 600),
    audio_base_url: required(body.audio_base_url, 'audio_base_url', 600),
    format: text(body.format, 20) || 'mp3',
    durations,
    total_surahs: positiveInteger(body.total_surahs, Object.keys(durations).length, 114),
    tags: Array.isArray(body.tags) ? body.tags.map(item => text(item, 40)).filter(Boolean).slice(0, 20) : [],
    sort_order: Math.round(number(body.sort_order, 0, 0, 10_000)),
    is_active: boolean(body.is_active, true),
    updated_at: FieldValue.serverTimestamp()
  };
}

async function collectionCount(name) {
  const snapshot = await db.collection(name).count().get();
  return snapshot.data().count;
}

app.get('/healthz', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    version: packageInfo.version,
    projectId: PROJECT_ID,
    credentialSource: fs.existsSync(SERVICE_ACCOUNT_PATH) ? 'service-account' : 'application-default'
  });
});

app.get('/api/overview', asyncRoute(async (_req, res) => {
  const [devices, events, notifications, qaris, payments, updateDoc, supportDoc] = await Promise.all([
    collectionCount('device_tokens'),
    collectionCount('events'),
    collectionCount('notification_logs'),
    collectionCount('qaris'),
    collectionCount('payments'),
    db.collection('settings').doc('app_update').get(),
    db.collection('support_stats').doc('current').get()
  ]);
  res.json({
    success: true,
    data: {
      counts: { devices, events, notifications, qaris, payments },
      appUpdate: updateDoc.exists ? serialize(updateDoc.data()) : null,
      support: supportDoc.exists ? serialize(supportDoc.data()) : null,
      projectId: PROJECT_ID,
      serverTime: new Date().toISOString()
    }
  });
}));

app.get('/api/analytics', asyncRoute(async (_req, res) => {
  const [devicesSnapshot, logsSnapshot] = await Promise.all([
    db.collection('device_tokens').get(),
    db.collection('notification_logs').get()
  ]);
  const now = Date.now();
  const day = 86_400_000;
  const activeUsers = { last24h: 0, last7d: 0, last30d: 0 };
  const platform = new Map();
  const versions = new Map();
  const brands = new Map();
  const registrations = new Map();

  for (const document of devicesSnapshot.docs) {
    const data = document.data();
    const updatedAt = data.updated_at instanceof Timestamp ? data.updated_at.toMillis() : 0;
    if (updatedAt && now - updatedAt <= day) activeUsers.last24h += 1;
    if (updatedAt && now - updatedAt <= 7 * day) activeUsers.last7d += 1;
    if (updatedAt && now - updatedAt <= 30 * day) activeUsers.last30d += 1;
    increment(platform, text(data.platform, 60) || 'unknown');
    increment(versions, text(data.app_version, 60) || 'unknown');
    increment(brands, (text(data.brand, 60) || 'unknown').toLowerCase());
    if (data.created_at instanceof Timestamp && now - data.created_at.toMillis() <= 30 * day) {
      increment(registrations, data.created_at.toDate().toISOString().slice(0, 10));
    }
  }

  let success = 0;
  let failed = 0;
  let targeted = 0;
  let received = 0;
  let opened = 0;
  for (const document of logsSnapshot.docs) {
    const data = document.data();
    if (data.status === 'success' || data.status === 'partial') success += 1;
    else if (data.status === 'fail') failed += 1;
    targeted += number(data.targetedCount, 0, 0);
    received += number(data.receivedCount, 0, 0);
    opened += number(data.openedCount, 0, 0);
  }

  const trend = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(now - (29 - index) * day).toISOString().slice(0, 10);
    return { date, count: registrations.get(date) || 0 };
  });
  res.json({
    success: true,
    data: {
      totalUsers: devicesSnapshot.size,
      activeUsers,
      notificationStats: {
        total: logsSnapshot.size,
        success,
        fail: failed,
        targeted,
        received,
        opened
      },
      platformDistribution: ranked(platform, 'platform'),
      appVersionDistribution: ranked(versions, 'version'),
      brandDistribution: ranked(brands, 'brand').slice(0, 10),
      registrationTrend: trend
    }
  });
}));

function increment(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function ranked(map, keyName) {
  return [...map.entries()]
    .map(([label, count]) => ({ [keyName]: label, count }))
    .sort((a, b) => b.count - a.count);
}

app.get('/api/notifications', asyncRoute(async (req, res) => {
  const limit = positiveInteger(req.query.limit, 50, 100);
  const snapshot = await db.collection('notification_logs').orderBy('timestamp', 'desc').limit(limit).get();
  res.json({ success: true, data: snapshot.docs.map(documentData) });
}));

app.get('/api/notifications/metrics', asyncRoute(async (_req, res) => {
  const snapshot = await db.collection('notification_logs').get();
  const metrics = snapshot.docs.reduce((totals, document) => {
    const data = document.data();
    totals.campaigns += 1;
    totals.targeted += number(data.targetedCount, 0, 0);
    totals.received += number(data.receivedCount, 0, 0);
    totals.opened += number(data.openedCount, 0, 0);
    if (data.status === 'success' || data.status === 'partial') totals.accepted += 1;
    if (data.status === 'fail') totals.failed += 1;
    return totals;
  }, { campaigns: 0, accepted: 0, failed: 0, targeted: 0, received: 0, opened: 0 });
  metrics.openRate = metrics.received > 0
    ? Number((metrics.opened / metrics.received * 100).toFixed(1))
    : 0;
  res.json({ success: true, data: metrics });
}));

app.delete('/api/notifications/:id', asyncRoute(async (req, res) => {
  const notificationId = validId(req.params.id);
  const reference = db.collection('notification_logs').doc(notificationId);
  const snapshot = await reference.get();
  if (!snapshot.exists) {
    const error = new Error('Notification history record not found.');
    error.statusCode = 404;
    throw error;
  }
  await db.recursiveDelete(reference);
  res.json({ success: true, message: 'Notification history deleted from Firebase.' });
}));

app.post('/api/notifications/send', asyncRoute(async (req, res) => {
  const target = req.body.target;
  if (!['single_user', 'all_users'].includes(target)) {
    const error = new Error('নোটিফিকেশনের সঠিক target নির্বাচন করুন।');
    error.statusCode = 400;
    throw error;
  }
  const title = required(req.body.title, 'title', 140);
  const body = required(req.body.body, 'body', 500);
  const fcmToken = text(req.body.fcmToken, 4096);
  if (target === 'single_user' && !fcmToken) {
    const error = new Error('fcmToken is required for a single user.');
    error.statusCode = 400;
    throw error;
  }
  const imageUrl = text(req.body.imageUrl, 1000);
  const actionUrl = text(req.body.actionUrl, 1000);
  res.json(await sendTrackedNotification({
    db, messaging, target, title, body, fcmToken, imageUrl, actionUrl
  }));
}));

app.get('/api/events', asyncRoute(async (req, res) => {
  const year = positiveInteger(req.query.year, new Date().getFullYear(), 2200);
  const snapshot = await db.collection('events').where('year', '==', year).get();
  const events = snapshot.docs.map(documentData).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  res.json({ success: true, data: events });
}));

app.post('/api/events', asyncRoute(async (req, res) => {
  const reference = await db.collection('events').add({ ...eventPayload(req.body), created_at: FieldValue.serverTimestamp() });
  res.status(201).json({ success: true, id: reference.id });
}));

app.put('/api/events/:id', asyncRoute(async (req, res) => {
  await db.collection('events').doc(validId(req.params.id)).set(eventPayload(req.body), { merge: true });
  res.json({ success: true });
}));

app.delete('/api/events/:id', asyncRoute(async (req, res) => {
  await db.collection('events').doc(validId(req.params.id)).delete();
  res.json({ success: true });
}));

app.get('/api/app-update', asyncRoute(async (_req, res) => {
  const document = await db.collection('settings').doc('app_update').get();
  res.json({ success: true, data: document.exists ? serialize(document.data()) : {} });
}));

app.put('/api/app-update', asyncRoute(async (req, res) => {
  const payload = {
    title: text(req.body.title, 180),
    change_logs: text(req.body.change_logs, 5000),
    latest_version: required(req.body.latest_version, 'latest_version', 40),
    min_supported_version: required(req.body.min_supported_version, 'min_supported_version', 40),
    force_update: boolean(req.body.force_update),
    store_url: text(req.body.store_url, 1000),
    ios_store_url: text(req.body.ios_store_url, 1000),
    updated_at: FieldValue.serverTimestamp()
  };
  await db.collection('settings').doc('app_update').set(payload, { merge: true });
  res.json({ success: true });
}));

app.get('/api/notice', asyncRoute(async (_req, res) => {
  const document = await db.collection('notice').doc('notice-bn').get();
  res.json({ success: true, data: document.exists ? serialize(document.data()) : {} });
}));

app.put('/api/notice', asyncRoute(async (req, res) => {
  await db.collection('notice').doc('notice-bn').set({
    promotional_message: text(req.body.promotional_message, 3000),
    updated_at: FieldValue.serverTimestamp()
  }, { merge: true });
  res.json({ success: true });
}));

app.get('/api/payments', asyncRoute(async (_req, res) => {
  const snapshot = await db.collection('payments').get();
  res.json({ success: true, data: snapshot.docs.map(documentData) });
}));

app.post('/api/payments', asyncRoute(async (req, res) => {
  const reference = await db.collection('payments').add({ ...paymentPayload(req.body), created_at: FieldValue.serverTimestamp() });
  res.status(201).json({ success: true, id: reference.id });
}));

app.put('/api/payments/:id', asyncRoute(async (req, res) => {
  await db.collection('payments').doc(validId(req.params.id)).set(paymentPayload(req.body), { merge: true });
  res.json({ success: true });
}));

app.delete('/api/payments/:id', asyncRoute(async (req, res) => {
  await db.collection('payments').doc(validId(req.params.id)).delete();
  res.json({ success: true });
}));

app.get('/api/qaris', asyncRoute(async (_req, res) => {
  const snapshot = await db.collection('qaris').get();
  const qaris = snapshot.docs.map(documentData).sort((a, b) => number(a.sort_order) - number(b.sort_order));
  res.json({ success: true, data: qaris });
}));

app.post('/api/qaris', asyncRoute(async (req, res) => {
  const requestedId = text(req.body.id, 160);
  const reference = requestedId
    ? db.collection('qaris').doc(validId(requestedId))
    : db.collection('qaris').doc();
  await reference.set({ ...qariPayload(req.body), created_at: FieldValue.serverTimestamp() });
  res.status(201).json({ success: true, id: reference.id });
}));

app.put('/api/qaris/:id', asyncRoute(async (req, res) => {
  await db.collection('qaris').doc(validId(req.params.id)).set(qariPayload(req.body), { merge: true });
  res.json({ success: true });
}));

app.delete('/api/qaris/:id', asyncRoute(async (req, res) => {
  await db.collection('qaris').doc(validId(req.params.id)).delete();
  res.json({ success: true });
}));

app.get('/api/support', asyncRoute(async (_req, res) => {
  const [stats, config, purchases] = await Promise.all([
    db.collection('support_stats').doc('current').get(),
    db.collection('support_config').doc('public').get(),
    db.collection('support_purchases').orderBy('updatedAt', 'desc').limit(50).get()
  ]);
  res.json({
    success: true,
    data: {
      stats: stats.exists ? serialize(stats.data()) : {},
      config: config.exists ? serialize(config.data()) : {},
      purchases: purchases.docs.map(documentData)
    }
  });
}));

app.delete('/api/support/purchases/:id', asyncRoute(async (req, res) => {
  const purchaseId = validId(req.params.id);
  const reference = db.collection('support_purchases').doc(purchaseId);
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) {
      const error = new Error('Purchase record not found.');
      error.statusCode = 404;
      throw error;
    }
    transaction.delete(reference);
  });
  res.json({
    success: true,
    message: 'Purchase record deleted from Firebase. Support stats are recalculating.'
  });
}));

app.put('/api/support/config', asyncRoute(async (req, res) => {
  await db.collection('support_config').doc('public').set({
    goal: Math.round(number(req.body.goal, 500, 1, 1_000_000)),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  res.json({ success: true });
}));

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

app.use('/api', (_req, res) => res.status(404).json({ success: false, message: 'API endpoint not found.' }));

app.use((error, _req, res, _next) => {
  const status = Number.isInteger(error.statusCode) ? error.statusCode : 500;
  console.error(`[${new Date().toISOString()}]`, error);
  res.status(status).json({
    success: false,
    message: status >= 500 ? 'The dashboard could not complete this request.' : error.message,
    ...(IS_PRODUCTION ? {} : { detail: error.message })
  });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Prayer Times dashboard: http://127.0.0.1:${PORT}`);
  console.log(`Firebase project: ${PROJECT_ID}`);
  console.log(`Credential: ${fs.existsSync(SERVICE_ACCOUNT_PATH) ? SERVICE_ACCOUNT_PATH : 'Application Default Credentials'}`);
});
