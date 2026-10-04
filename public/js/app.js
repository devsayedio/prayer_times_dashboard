'use strict';

const state = {
  page: 'overview',
  overview: null,
  analytics: null,
  events: [],
  payments: [],
  qaris: [],
  support: null,
  modal: null,
  pageLoadId: 0,
  modalOpener: null
};

const pageMeta = {
  overview: ['আজকের সারসংক্ষেপ', 'ড্যাশবোর্ড ওভারভিউ'],
  analytics: ['Audience intelligence', 'ব্যবহারকারী অ্যানালিটিক্স'],
  notifications: ['Firebase Cloud Messaging', 'Push notification'],
  events: ['Islamic calendar', 'ইভেন্ট ম্যানেজমেন্ট'],
  content: ['Remote app control', 'অ্যাপ কনটেন্ট'],
  payments: ['Support methods', 'পেমেন্ট মাধ্যম'],
  qaris: ['Qur’an audio catalogue', 'ক্বারী ম্যানেজমেন্ট'],
  support: ['Google Play Billing', 'সাপোর্টার ও contribution']
};

document.addEventListener('DOMContentLoaded', () => {
  bindNavigation();
  bindForms();
  document.getElementById('eventsYear').value = new Date().getFullYear();
  const savedTheme = localStorage.getItem('prayerDashboardTheme') || 'light';
  document.documentElement.dataset.theme = savedTheme;
  loadPage('overview', true);
});

function bindNavigation() {
  document.querySelectorAll('[data-page]').forEach(button => {
    button.addEventListener('click', () => navigate(button.dataset.page));
  });
  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-go]');
    if (trigger) navigate(trigger.dataset.go);
    const action = event.target.closest('[data-action]');
    if (action) handleAction(action);
  });
  document.getElementById('refreshBtn').addEventListener('click', () => loadPage(state.page, true));
  document.getElementById('themeBtn').addEventListener('click', () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('prayerDashboardTheme', theme);
  });
  document.getElementById('menuBtn').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));
  document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
  document.getElementById('editorModal').addEventListener('click', event => {
    if (event.target.id === 'editorModal') closeModal();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeModal();
    if (event.key === 'Tab' && state.modal) {
      const elements = [...document.getElementById('editorModal').querySelectorAll('button:not(:disabled),input,select,textarea')];
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  });
}

function bindForms() {
  document.getElementById('notificationTarget').addEventListener('change', event => {
    document.getElementById('tokenField').classList.toggle('hidden', event.target.value !== 'single_user');
  });
  document.getElementById('notificationForm').addEventListener('submit', sendNotification);
  document.getElementById('appUpdateForm').addEventListener('submit', saveAppUpdate);
  document.getElementById('noticeForm').addEventListener('submit', saveNotice);
  document.getElementById('supportGoalForm').addEventListener('submit', saveSupportGoal);
  document.getElementById('eventsYear').addEventListener('change', () => loadEvents(true));
  document.getElementById('newEventBtn').addEventListener('click', () => openEventEditor());
  document.getElementById('newPaymentBtn').addEventListener('click', () => openPaymentEditor());
  document.getElementById('newQariBtn').addEventListener('click', () => openQariEditor());
  document.getElementById('editorForm').addEventListener('submit', saveEditor);
}

function navigate(page) {
  if (!pageMeta[page]) return;
  state.page = page;
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.page === page));
  document.querySelectorAll('.page').forEach(section => section.classList.toggle('active', section.id === `page-${page}`));
  document.getElementById('eyebrow').textContent = pageMeta[page][0];
  document.getElementById('pageTitle').textContent = pageMeta[page][1];
  document.getElementById('sidebar').classList.remove('open');
  loadPage(page);
}

async function loadPage(page, force = false) {
  const loadId = ++state.pageLoadId;
  clearError();
  const loaders = {
    overview: loadOverview,
    analytics: loadAnalytics,
    notifications: loadNotifications,
    events: loadEvents,
    content: loadContent,
    payments: loadPayments,
    qaris: loadQaris,
    support: loadSupport
  };
  try {
    setLoading(true);
    setSyncStatus('loading', 'সংযোগ হচ্ছে…');
    await loaders[page](force);
    if (loadId === state.pageLoadId) setSyncStatus('live', `Live · ${new Date().toLocaleTimeString('bn-BD', { hour: '2-digit', minute: '2-digit' })}`);
  } catch (error) {
    if (loadId === state.pageLoadId) {
      setSyncStatus('error', 'সংযোগ ব্যর্থ');
      showError(error.message);
    }
  } finally {
    if (loadId === state.pageLoadId) setLoading(false);
  }
}

async function api(url, options = {}) {
  const controller = new AbortController();
  const timeout = (!options.method || options.method === 'GET')
    ? window.setTimeout(() => controller.abort(), 20000) : null;
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    let body;
    try { body = await response.json(); }
    catch (_) { throw new Error(`সার্ভার থেকে সঠিক response আসেনি (${response.status})`); }
    if (!response.ok || body.success === false) {
      throw new Error(body.detail || body.message || `Request failed (${response.status})`);
    }
    return body.data ?? body;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('২০ সেকেন্ডেও সার্ভারের response আসেনি। Firebase login ও সংযোগ পরীক্ষা করে রিফ্রেশ করুন।');
    throw error;
  } finally { if (timeout !== null) window.clearTimeout(timeout); }
}

async function loadOverview(force = false) {
  if (!force && state.overview && state.analytics) return renderOverview();
  const [overview, analytics] = await Promise.all([api('/api/overview'), api('/api/analytics')]);
  state.overview = overview;
  state.analytics = analytics;
  renderOverview();
}

function renderOverview() {
  const counts = state.overview.counts || {};
  document.getElementById('projectName').textContent = state.overview.projectId || 'prayer-times-6163f';
  document.getElementById('overviewStats').innerHTML = [
    statCard('ব্যবহারকারী', counts.devices, '♙', '#edf4ff', '#3157df'),
    statCard('সক্রিয় ৩০ দিন', state.analytics.activeUsers?.last30d, '↗', '#ecfdf3', '#039855'),
    statCard('ইভেন্ট', counts.events, '◇', '#fff7ed', '#dc6803'),
    statCard('Notification', counts.notifications, '◉', '#f5f3ff', '#7c3aed'),
    statCard('ক্বারী', counts.qaris, '♫', '#eef8ff', '#087ea4')
  ].join('');
  renderTrend('overviewTrend', state.analytics.registrationTrend || []);
  const update = state.overview.appUpdate || {};
  document.getElementById('releaseSummary').innerHTML = [
    summaryRow('Latest version', update.latest_version || 'সেট করা হয়নি'),
    summaryRow('Minimum version', update.min_supported_version || 'সেট করা হয়নি'),
    summaryRow('Force update', update.force_update ? badge('চালু', 'danger') : badge('বন্ধ', 'success'))
  ].join('');
  const support = state.overview.support || {};
  const current = Number(support.currentSupporters || 0);
  const goal = Number(support.goal || 500);
  const percentage = goal ? Math.min(100, Math.round(current / goal * 100)) : 0;
  document.getElementById('supportSummary').innerHTML = [
    summaryRow('Supporters', `${formatNumber(current)} / ${formatNumber(goal)}`),
    summaryRow('Contributions', formatNumber(support.totalContributions || 0)),
    `<div><div class="summary-row"><span>লক্ষ্যের অগ্রগতি</span><strong>${percentage}%</strong></div><div class="progress"><i style="width:${percentage}%"></i></div></div>`
  ].join('');
}

async function loadAnalytics(force = false) {
  if (force || !state.analytics) state.analytics = await api('/api/analytics');
  const data = state.analytics;
  const notification = data.notificationStats || {};
  const rate = notification.total ? Math.round(notification.success / notification.total * 100) : 0;
  document.getElementById('analyticsStats').innerHTML = [
    statCard('মোট ব্যবহারকারী', data.totalUsers, '♙'),
    statCard('সক্রিয় ২৪ ঘণ্টা', data.activeUsers?.last24h, '◷', '#ecfdf3', '#039855'),
    statCard('সক্রিয় ৭ দিন', data.activeUsers?.last7d, '7', '#fff7ed', '#dc6803'),
    statCard('সক্রিয় ৩০ দিন', data.activeUsers?.last30d, '30', '#f5f3ff', '#7c3aed'),
    statCard('FCM acceptance', `${rate}%`, '✓', '#ecfdf3', '#039855')
  ].join('');
  renderTrend('analyticsTrend', data.registrationTrend || []);
  renderDistribution('platformDistribution', data.platformDistribution || [], 'platform');
  renderDistribution('versionDistribution', data.appVersionDistribution || [], 'version');
  renderDistribution('brandDistribution', data.brandDistribution || [], 'brand');
}

function statCard(label, value = 0, icon, tint = '#f0f5fe', accent = '#4d7aeb') {
  return `<article class="stat-card" style="--tint:${tint};--accent:${accent}"><span class="stat-icon">${escapeHtml(icon)}</span><small>${escapeHtml(label)}</small><strong>${escapeHtml(formatNumber(value ?? 0))}</strong></article>`;
}

function summaryRow(label, value) {
  return `<div class="summary-row"><span>${escapeHtml(label)}</span><strong>${typeof value === 'string' && value.startsWith('<span') ? value : escapeHtml(value)}</strong></div>`;
}

function renderTrend(id, items) {
  const max = Math.max(1, ...items.map(item => Number(item.count || 0)));
  document.getElementById(id).innerHTML = items.length
    ? items.map(item => `<i class="trend-bar" style="height:${Math.max(3, Number(item.count || 0) / max * 100)}%" data-tip="${escapeHtml(item.date)} · ${formatNumber(item.count)}"></i>`).join('')
    : '<div class="empty-state">কোনো trend data নেই</div>';
}

function renderDistribution(id, items, labelKey) {
  const total = items.reduce((sum, item) => sum + Number(item.count || 0), 0) || 1;
  document.getElementById(id).innerHTML = items.length
    ? items.map(item => `<div class="dist-row"><span title="${escapeHtml(item[labelKey])}">${escapeHtml(item[labelKey] || 'unknown')}</span><div class="dist-bar"><i style="width:${Math.round(item.count / total * 100)}%"></i></div><strong>${formatNumber(item.count)}</strong></div>`).join('')
    : '<div class="empty-state">কোনো data নেই</div>';
}

async function loadNotifications() {
  const [items, metrics] = await Promise.all([
    api('/api/notifications'),
    api('/api/notifications/metrics')
  ]);
  document.getElementById('notificationStats').innerHTML = [
    statCard('মোট campaign', metrics.campaigns, '◉'),
    statCard('Targeted devices', metrics.targeted, '◎'),
    statCard('App received', metrics.received, '↓', '#ecfdf3', '#039855'),
    statCard('Opened', metrics.opened, '↗', '#fff7ed', '#dc6803'),
    statCard('Open rate', `${metrics.openRate || 0}%`, '%', '#f5f3ff', '#7c3aed')
  ].join('');
  document.getElementById('notificationHistory').innerHTML = items.length
    ? items.map(item => `<div class="timeline-item ${item.status === 'fail' ? 'fail' : item.status === 'partial' || item.status === 'sending' ? 'pending' : ''}"><i></i><div><div class="timeline-head"><strong>${escapeHtml(item.title || 'Untitled')}</strong><button class="mini-btn danger" data-action="delete-notification" data-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.title || 'Notification')} history delete করুন">Delete</button></div><p>${escapeHtml(item.body || '')}</p><div class="timeline-meta"><small>${escapeHtml(item.target || 'unknown')} · ${formatDateTime(item.timestamp)} · ${escapeHtml(({ success: 'সফল', partial: 'আংশিক সফল', fail: 'ব্যর্থ', sending: 'পাঠানো হচ্ছে' })[item.status] || item.status || 'unknown')}</small>${notificationTrackingBadges(item)}</div></div></div>`).join('')
    : '<div class="empty-state">কোনো notification history নেই</div>';
}

function notificationTrackingBadges(item) {
  const targeted = Number(item.targetedCount);
  const received = Number(item.receivedCount);
  const opened = Number(item.openedCount);
  const targetedLabel = Number.isFinite(targeted) && targeted >= 0
    ? formatNumber(targeted)
    : item.target === 'single_user' ? '১' : 'তথ্য নেই';
  if (!Number.isFinite(received) || !Number.isFinite(opened)) {
    return `<span class="tracking-badges"><span class="audience-badge">Targeted: ${targetedLabel}</span><span class="audience-badge unavailable">Tracking: legacy</span></span>`;
  }
  const openRate = received > 0 ? (opened / received * 100).toFixed(1) : '0.0';
  return `<span class="tracking-badges"><span class="audience-badge">Targeted: ${targetedLabel}</span><span class="audience-badge received">Received: ${formatNumber(received)}</span><span class="audience-badge opened">Opened: ${formatNumber(opened)} (${openRate}%)</span></span>`;
}

async function sendNotification(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const targetText = values.target === 'all_users' ? 'নিবন্ধিত সব ডিভাইস' : 'একটি নির্দিষ্ট ডিভাইস';
  if (!window.confirm(`${targetText}-এর কাছে এই notification পাঠাবেন?`)) return;
  await submitForm(form, async () => {
    try {
      const result = await api('/api/notifications/send', { method: 'POST', body: JSON.stringify(values) });
      toast(result.message || 'Notification পাঠানো হয়েছে');
      form.reset();
      document.getElementById('tokenField').classList.add('hidden');
    } finally {
      state.analytics = null;
      state.overview = null;
      await loadNotifications().catch(error => toast(`History refresh ব্যর্থ: ${error.message}`, true));
    }
  });
}

async function loadEvents() {
  const year = document.getElementById('eventsYear').value || new Date().getFullYear();
  state.events = await api(`/api/events?year=${encodeURIComponent(year)}`);
  document.getElementById('eventsTable').innerHTML = state.events.length
    ? state.events.map(item => `<tr><td>${escapeHtml(item.date || '—')}</td><td><strong>${escapeHtml(item.title || 'Untitled')}</strong><span class="muted">${escapeHtml(item.description || '')}</span></td><td>${escapeHtml(item.holiday_type || '—')}</td><td>${item.is_active === false ? badge('নিষ্ক্রিয়', 'danger') : badge('সক্রিয়', 'success')}</td><td><div class="row-actions"><button class="mini-btn" data-action="edit-event" data-id="${escapeHtml(item.id)}">Edit</button><button class="mini-btn" data-action="delete-event" data-id="${escapeHtml(item.id)}">Delete</button></div></td></tr>`).join('')
    : emptyRow(5, 'এই বছরে কোনো custom event নেই');
}

async function loadContent() {
  const [update, notice] = await Promise.all([api('/api/app-update'), api('/api/notice')]);
  setFormValues(document.getElementById('appUpdateForm'), update);
  setFormValues(document.getElementById('noticeForm'), notice);
}

async function saveAppUpdate(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  values.force_update = form.elements.force_update.checked;
  await submitForm(form, async () => {
    await api('/api/app-update', { method: 'PUT', body: JSON.stringify(values) });
    state.overview = null;
    toast('App update policy সংরক্ষণ হয়েছে');
  });
}

async function saveNotice(event) {
  event.preventDefault();
  const form = event.currentTarget;
  await submitForm(form, async () => {
    await api('/api/notice', { method: 'PUT', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    toast('Promotional notice সংরক্ষণ হয়েছে');
  });
}

async function loadPayments() {
  state.payments = await api('/api/payments');
  document.getElementById('paymentsGrid').innerHTML = state.payments.length
    ? state.payments.map(item => `<article class="content-card"><div class="content-card-head"><span class="content-card-icon">${item.payment_type === 'mobile' ? '৳' : '▣'}</span>${item.is_active === false ? badge('নিষ্ক্রিয়', 'danger') : badge('সক্রিয়', 'success')}</div><h3>${escapeHtml(item.bank_name || 'Payment method')}</h3><p>${escapeHtml(item.payment_type === 'mobile' ? item.number : item.account_number)}</p><p>${escapeHtml(item.payment_type === 'bank' ? item.account_holder_name || '' : 'Mobile financial service')}</p><div class="content-card-actions"><button class="mini-btn" data-action="edit-payment" data-id="${escapeHtml(item.id)}">Edit</button><button class="mini-btn" data-action="delete-payment" data-id="${escapeHtml(item.id)}">Delete</button></div></article>`).join('')
    : '<article class="panel empty-state">কোনো payment method নেই</article>';
}

async function loadQaris() {
  state.qaris = await api('/api/qaris');
  document.getElementById('qarisTable').innerHTML = state.qaris.length
    ? state.qaris.map(item => `<tr><td><strong>${escapeHtml(item.name_bn || item.name || 'Untitled')}</strong><span class="muted">${escapeHtml(item.name || '')}</span></td><td>${escapeHtml([item.language, item.country].filter(Boolean).join(' · ') || '—')}</td><td>${formatNumber(item.total_surahs || 0)}</td><td>${formatNumber(item.sort_order || 0)}</td><td>${item.is_active === false ? badge('নিষ্ক্রিয়', 'danger') : badge('সক্রিয়', 'success')}</td><td><div class="row-actions"><button class="mini-btn" data-action="edit-qari" data-id="${escapeHtml(item.id)}">Edit</button><button class="mini-btn" data-action="delete-qari" data-id="${escapeHtml(item.id)}">Delete</button></div></td></tr>`).join('')
    : emptyRow(6, 'কোনো ক্বারী পাওয়া যায়নি');
}

async function loadSupport() {
  state.support = await api('/api/support');
  const stats = state.support.stats || {};
  const config = state.support.config || {};
  document.getElementById('supportStats').innerHTML = [
    statCard('বর্তমান সাপোর্টার', stats.currentSupporters, '♡'),
    statCard('Monthly goal', stats.goal || config.goal || 500, '◎'),
    statCard('Contributions', stats.totalContributions, '৳', '#ecfdf3', '#039855'),
    statCard('Purchase records', state.support.purchases.length, '▤', '#fff7ed', '#dc6803')
  ].join('');
  document.getElementById('supportGoalForm').elements.goal.value = config.goal || stats.goal || 500;
  document.getElementById('supportTable').innerHTML = state.support.purchases.length
    ? state.support.purchases.map(item => `<tr><td><strong>${escapeHtml(item.productId || '—')}</strong></td><td>${escapeHtml(item.productType || '—')}</td><td>${escapeHtml(item.supportMonth || '—')}</td><td>${item.active ? badge('Active', 'success') : badge('Inactive', 'danger')}</td><td>${item.acknowledged ? badge('Yes', 'success') : badge('No', 'danger')}</td><td>${formatDateTime(item.updatedAt)}</td><td><div class="row-actions"><button class="mini-btn danger" data-action="delete-purchase" data-id="${escapeHtml(item.id)}">Delete</button></div></td></tr>`).join('')
    : emptyRow(7, 'কোনো verified purchase নেই');
}

async function saveSupportGoal(event) {
  event.preventDefault();
  const form = event.currentTarget;
  await submitForm(form, async () => {
    await api('/api/support/config', { method: 'PUT', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    state.overview = null;
    toast('Supporter goal আপডেট হয়েছে');
    await loadSupport();
  });
}

function handleAction(button) {
  const [verb, entity] = button.dataset.action.split('-');
  const id = button.dataset.id;
  if (verb === 'edit' && entity === 'event') return openEventEditor(state.events.find(item => item.id === id));
  if (verb === 'edit' && entity === 'payment') return openPaymentEditor(state.payments.find(item => item.id === id));
  if (verb === 'edit' && entity === 'qari') return openQariEditor(state.qaris.find(item => item.id === id));
  if (verb === 'delete') deleteItem(entity, id);
}

async function deleteItem(entity, id) {
  const names = { event: 'ইভেন্ট', payment: 'পেমেন্ট মাধ্যম', qari: 'ক্বারী', purchase: 'verified purchase record', notification: 'notification history' };
  const warning = entity === 'purchase'
    ? 'এই purchase record সরাসরি Firebase থেকে স্থায়ীভাবে মুছে ফেলবেন? এটি Google Play-এর আসল order cancel বা refund করবে না।'
    : entity === 'notification'
      ? 'এই notification history সরাসরি Firebase থেকে স্থায়ীভাবে মুছে ফেলবেন?'
      : `এই ${names[entity]} স্থায়ীভাবে মুছে ফেলবেন?`;
  if (!window.confirm(warning)) return;
  try {
    setLoading(true);
    const endpoint = entity === 'purchase'
      ? `/api/support/purchases/${encodeURIComponent(id)}`
      : `/api/${entity === 'qari' ? 'qaris' : `${entity}s`}/${encodeURIComponent(id)}`;
    const result = await api(endpoint, { method: 'DELETE' });
    toast(result.message || `${names[entity]} মুছে ফেলা হয়েছে`);
    state.overview = null;
    await ({ event: loadEvents, payment: loadPayments, qari: loadQaris, purchase: loadSupport, notification: loadNotifications })[entity](true);
  } catch (error) {
    toast(error.message, true);
  } finally { setLoading(false); }
}

function openEventEditor(item = {}) {
  state.modal = { entity: 'event', id: item.id || null };
  openModal(item.id ? 'ইভেন্ট সম্পাদনা' : 'নতুন ইভেন্ট', 'Islamic calendar', `
    ${field('title', 'ইভেন্টের নাম', item.title, 'text', true, 'full')}
    ${field('date', 'তারিখ', item.date, 'date', true)}
    ${field('year', 'বছর', item.year || document.getElementById('eventsYear').value, 'number', true)}
    ${field('holiday_type', 'ধরন', item.holiday_type)}
    ${field('color', 'রং', item.color || '#4D7AEB', 'color')}
    ${textareaField('description', 'বিবরণ', item.description, 4, 'full')}
    ${switchField('is_active', 'সক্রিয়', 'অ্যাপে event দেখানো হবে', item.is_active !== false)}
    ${modalActions(item.id ? 'পরিবর্তন সংরক্ষণ' : 'ইভেন্ট তৈরি করুন')}`);
}

function openPaymentEditor(item = {}) {
  state.modal = { entity: 'payment', id: item.id || null };
  openModal(item.id ? 'পেমেন্ট মাধ্যম সম্পাদনা' : 'নতুন পেমেন্ট মাধ্যম', 'Support methods', `
    <label class="field"><span>ধরন</span><select name="payment_type"><option value="mobile" ${item.payment_type !== 'bank' ? 'selected' : ''}>Mobile</option><option value="bank" ${item.payment_type === 'bank' ? 'selected' : ''}>Bank</option></select></label>
    ${field('bank_name', 'প্রতিষ্ঠানের নাম', item.bank_name, 'text', true)}
    ${field('number', 'Mobile number', item.number)}
    ${field('account_number', 'Account number', item.account_number)}
    ${field('account_holder_name', 'Account holder', item.account_holder_name)}
    ${field('branch_name', 'Branch', item.branch_name)}
    ${field('routing_number', 'Routing number', item.routing_number)}
    ${field('swift_code', 'SWIFT code', item.swift_code)}
    ${field('district', 'District', item.district)}
    ${field('icon_path', 'Icon asset path', item.icon_path)}
    ${field('card_color', 'Card color', item.card_color || '#4D7AEB', 'color')}
    ${switchField('is_active', 'সক্রিয়', 'অ্যাপের support page-এ দেখানো হবে', item.is_active !== false)}
    ${modalActions(item.id ? 'পরিবর্তন সংরক্ষণ' : 'পেমেন্ট মাধ্যম তৈরি করুন')}`);
}

function openQariEditor(item = {}) {
  state.modal = { entity: 'qari', id: item.id || null };
  const durations = item.durations ? JSON.stringify(item.durations, null, 2) : '{}';
  openModal(item.id ? 'ক্বারী সম্পাদনা' : 'নতুন ক্বারী', 'Qur’an audio catalogue', `
    ${item.id ? '' : field('id', 'Document ID (optional)', '', 'text', false, 'full')}
    ${field('name', 'English name', item.name, 'text', true)}
    ${field('name_bn', 'বাংলা নাম', item.name_bn)}
    ${field('name_ar', 'আরবি নাম', item.name_ar)}
    ${field('language', 'Language', item.language)}
    ${field('language_code', 'Language code', item.language_code)}
    ${field('country', 'Country', item.country)}
    ${field('country_bn', 'দেশ (বাংলা)', item.country_bn)}
    ${field('flag', 'Flag emoji', item.flag)}
    ${field('sort_order', 'Sort order', item.sort_order || 0, 'number')}
    ${field('total_surahs', 'Total surahs', item.total_surahs || 114, 'number', true)}
    ${field('format', 'Audio format', item.format || 'mp3')}
    ${field('image_url', 'Image URL', item.image_url, 'url', false, 'full')}
    ${field('audio_base_url', 'Audio base URL', item.audio_base_url, 'url', true, 'full')}
    ${field('subtitle', 'Subtitle', item.subtitle)}
    ${field('subtitle_bn', 'Subtitle (বাংলা)', item.subtitle_bn)}
    ${field('tags', 'Tags (comma separated)', Array.isArray(item.tags) ? item.tags.join(', ') : '', 'text', false, 'full')}
    ${textareaField('durations', 'Durations JSON — keys 001…114, values milliseconds', durations, 8, 'full')}
    ${switchField('is_active', 'সক্রিয়', 'Audio catalogue-এ দেখানো হবে', item.is_active !== false)}
    ${modalActions(item.id ? 'পরিবর্তন সংরক্ষণ' : 'ক্বারী তৈরি করুন')}`);
}

function openModal(title, kicker, content) {
  state.modalOpener = document.activeElement;
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalKicker').textContent = kicker;
  document.getElementById('editorForm').innerHTML = content;
  const modal = document.getElementById('editorModal');
  modal.classList.add('active');
  modal.setAttribute('aria-hidden', 'false');
  document.querySelector('.app-shell').inert = true;
  document.getElementById('editorForm').querySelector('input,select,textarea')?.focus();
}

function closeModal() {
  if (state.modal?.saving) return;
  state.modal = null;
  const modal = document.getElementById('editorModal');
  modal.classList.remove('active');
  modal.setAttribute('aria-hidden', 'true');
  document.querySelector('.app-shell').inert = false;
  state.modalOpener?.focus();
  state.modalOpener = null;
}

async function saveEditor(event) {
  event.preventDefault();
  if (!state.modal) return;
  const form = event.currentTarget;
  const modal = state.modal;
  const values = Object.fromEntries(new FormData(form));
  values.is_active = form.elements.is_active?.checked ?? true;
  if (state.modal.entity === 'qari') {
    values.tags = String(values.tags || '').split(',').map(item => item.trim()).filter(Boolean);
    try { values.durations = JSON.parse(values.durations || '{}'); }
    catch (_) { return toast('Durations valid JSON হতে হবে', true); }
  }
  const plural = state.modal.entity === 'qari' ? 'qaris' : `${state.modal.entity}s`;
  const url = state.modal.id ? `/api/${plural}/${encodeURIComponent(state.modal.id)}` : `/api/${plural}`;
  const method = state.modal.id ? 'PUT' : 'POST';
  modal.saving = true;
  document.getElementById('modalCloseBtn').disabled = true;
  try {
    await submitForm(form, async () => {
      await api(url, { method, body: JSON.stringify(values) });
      const entity = modal.entity;
      modal.saving = false;
      closeModal();
      state.overview = null;
      toast('তথ্য সংরক্ষণ হয়েছে');
      await ({ event: loadEvents, payment: loadPayments, qari: loadQaris })[entity](true);
    });
  } finally {
    modal.saving = false;
    document.getElementById('modalCloseBtn').disabled = false;
  }
}

function field(name, label, value = '', type = 'text', isRequired = false, className = '') {
  return `<label class="field ${className}"><span>${escapeHtml(label)}</span><input name="${escapeHtml(name)}" type="${escapeHtml(type)}" value="${escapeHtml(value ?? '')}" ${isRequired ? 'required' : ''}></label>`;
}

function textareaField(name, label, value = '', rows = 4, className = '') {
  return `<label class="field ${className}"><span>${escapeHtml(label)}</span><textarea name="${escapeHtml(name)}" rows="${rows}">${escapeHtml(value ?? '')}</textarea></label>`;
}

function switchField(name, label, hint, checked) {
  return `<label class="switch-row full"><input name="${escapeHtml(name)}" type="checkbox" ${checked ? 'checked' : ''}><span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(hint)}</small></span></label>`;
}

function modalActions(label) {
  return `<div class="form-actions full"><button class="btn btn-primary" type="submit">${escapeHtml(label)}</button></div>`;
}

async function submitForm(form, handler) {
  const button = form.querySelector('[type=submit]');
  const original = button?.textContent;
  if (button) { button.disabled = true; button.textContent = 'সংরক্ষণ হচ্ছে…'; }
  try { await handler(); }
  catch (error) { toast(error.message, true); }
  finally { if (button) { button.disabled = false; button.textContent = original; } }
}

function setFormValues(form, values) {
  [...form.elements].forEach(element => {
    if (!element.name || !(element.name in values)) return;
    if (element.type === 'checkbox') element.checked = Boolean(values[element.name]);
    else element.value = values[element.name] ?? '';
  });
}

function badge(label, type = '') {
  return `<span class="badge ${type}">${escapeHtml(label)}</span>`;
}

function emptyRow(columns, message) {
  return `<tr><td colspan="${columns}"><div class="empty-state">${escapeHtml(message)}</div></td></tr>`;
}

function formatNumber(value) {
  if (typeof value === 'string' && value.endsWith('%')) return value;
  return new Intl.NumberFormat('bn-BD').format(Number(value) || 0);
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('bn-BD', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Dhaka' }).format(date);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function setLoading(loading) {
  document.getElementById('loader').classList.toggle('hidden', !loading);
}

function showError(message) {
  const banner = document.getElementById('errorBanner');
  banner.textContent = `সংযোগ ব্যর্থ: ${message}`;
  banner.classList.remove('hidden');
}

function clearError() {
  document.getElementById('errorBanner').classList.add('hidden');
}

function setSyncStatus(status, message) {
  document.getElementById('syncState').dataset.status = status;
  document.getElementById('syncText').textContent = message;
}

function toast(message, isError = false) {
  const element = document.createElement('div');
  element.className = `toast ${isError ? 'error' : ''}`;
  element.textContent = message;
  document.getElementById('toastStack').appendChild(element);
  window.setTimeout(() => element.remove(), 3200);
}
