/**
 * @file Micro frontend controller.
 *
 * Owns UI state (language, theme, API base, session token), renders the
 * dashboard/catalog and sends Request Lab calls. Dynamic backend values are
 * inserted with textContent; no received HTML is executed. Preferences live in
 * localStorage and the credential only in sessionStorage.
 */
import { applyTranslations, t } from './i18n.js';
import { catalog, presets } from './catalog.js';
import { controlRequest, getJson, performRequest } from './api.js';
import {
  buildRequestUrl,
  compactDomainName,
  formatBytes,
  formatDuration,
  formatNumber,
  formatUptime,
  headerRowsToObject,
  headersToRows,
  isValidHttpUrl,
  modeErrorKey,
  normalizeBaseUrl,
  prettyPayload,
  statusTone,
  truncateText,
} from './lib.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const local = window.localStorage;
const session = window.sessionStorage;

const storedLanguage = local.getItem('bs.lang');
const storedTheme = local.getItem('bs.theme');
const browserLanguage = (navigator.language || 'es').toLowerCase().startsWith('es') ? 'es' : 'en';
const servedByBackend = window.location.pathname.startsWith('/ui/');
const defaultApiBase = servedByBackend ? window.location.origin : 'http://127.0.0.1:4000';

const state = {
  lang: storedLanguage === 'en' || storedLanguage === 'es' ? storedLanguage : browserLanguage,
  theme:
    storedTheme === 'dark' || storedTheme === 'light'
      ? storedTheme
      : window.matchMedia?.('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light',
  apiBase: normalizeBaseUrl(local.getItem('bs.apiBase') || defaultApiBase),
  token: session.getItem('bs.token') ?? 'local-admin-token',
  controlToken: session.getItem('bs.controlToken') ?? 'local-control-token',
  attachAuth: session.getItem('bs.attachAuth') !== 'false',
  connection: 'checking',
  stats: null,
  mode: null,
  modeBusy: false,
  controller: null,
  responseText: '',
};

if (!isValidHttpUrl(state.apiBase)) state.apiBase = 'http://127.0.0.1:4000';
document.documentElement.dataset.theme = state.theme;

const elements = {
  connectionPill: $('#connection-pill'),
  connectionText: $('#connection-text'),
  languageToggle: $('#language-toggle'),
  themeToggle: $('#theme-toggle'),
  apiBase: $('#api-base'),
  applyBase: $('#apply-base'),
  refreshOverview: $('#refresh-overview'),
  metricHealth: $('#metric-health'),
  metricHealthDetail: $('#metric-health-detail'),
  metricUptime: $('#metric-uptime'),
  metricRecords: $('#metric-records'),
  metricDomains: $('#metric-domains'),
  domainGrid: $('#domain-grid'),
  modeBadge: $('#mode-badge'),
  modeDescription: $('#mode-description'),
  controlToken: $('#control-token'),
  modeFreeze: $('#mode-freeze'),
  modeRestore: $('#mode-restore'),
  modeUnfreeze: $('#mode-unfreeze'),
  modeMessage: $('#mode-message'),
  requestForm: $('#request-form'),
  method: $('#method-select'),
  path: $('#path-input'),
  send: $('#send-button'),
  abort: $('#abort-button'),
  token: $('#token-input'),
  demoToken: $('#demo-token'),
  attachAuth: $('#attach-auth'),
  headersList: $('#headers-list'),
  addHeader: $('#add-header'),
  body: $('#body-input'),
  bodyField: $('#body-field'),
  presets: $('#presets'),
  responseEmpty: $('#response-empty'),
  responseContent: $('#response-content'),
  responseStatus: $('#response-status'),
  responseMeta: $('#response-meta'),
  responseUrl: $('#response-url'),
  responseHeaders: $('#response-headers'),
  responseHeadersCount: $('#response-headers-count'),
  responseBody: $('#response-body'),
  copyResponse: $('#copy-response'),
  catalogRoot: $('#catalog-root'),
  catalogSearch: $('#catalog-search'),
  catalogEmpty: $('#catalog-empty'),
  toast: $('#toast'),
};

let toastTimer;

/** Shows a short-lived accessible status/error toast. */
function showToast(message, isError = false) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle('is-error', isError);
  elements.toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 3200);
}

/** Updates the backend connection indicator in the current language. */
function setConnection(next) {
  state.connection = next;
  elements.connectionPill.classList.toggle('is-online', next === 'online');
  elements.connectionPill.classList.toggle('is-offline', next === 'offline');
  const key = next === 'online' ? 'status.online' : next === 'offline' ? 'status.offline' : 'status.checking';
  elements.connectionText.textContent = t(state.lang, key);
}

function updateTheme() {
  document.documentElement.dataset.theme = state.theme;
  elements.themeToggle.setAttribute('aria-label', t(state.lang, 'toggle.theme'));
  elements.themeToggle.title = t(state.lang, 'toggle.theme');
  const glyph = elements.themeToggle.querySelector('span');
  if (glyph) glyph.textContent = state.theme === 'dark' ? '☀' : '◐';
}

function updateApiLinks() {
  for (const link of $$('[data-api-link]')) {
    link.href = buildRequestUrl(state.apiBase, link.getAttribute('data-api-link'));
  }
}

function headerPlaceholder(input, key) {
  input.placeholder = t(state.lang, key);
  input.setAttribute('aria-label', t(state.lang, key));
}

function refreshHeaderRowsLanguage() {
  for (const row of $$('.header-row', elements.headersList)) {
    const [name, value] = $$('input', row);
    if (name) headerPlaceholder(name, 'lab.headerName');
    if (value) headerPlaceholder(value, 'lab.headerValue');
    const remove = $('button', row);
    if (remove) remove.setAttribute('aria-label', t(state.lang, 'lab.removeHeader'));
  }
}

function addHeaderRow(name = '', value = '') {
  const row = document.createElement('div');
  row.className = 'header-row';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = name;
  nameInput.autocomplete = 'off';
  nameInput.spellcheck = false;
  headerPlaceholder(nameInput, 'lab.headerName');
  const valueInput = document.createElement('input');
  valueInput.type = 'text';
  valueInput.value = value;
  valueInput.autocomplete = 'off';
  valueInput.spellcheck = false;
  headerPlaceholder(valueInput, 'lab.headerValue');
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'remove-header';
  remove.textContent = '×';
  remove.setAttribute('aria-label', t(state.lang, 'lab.removeHeader'));
  row.append(nameInput, valueInput, remove);
  elements.headersList.append(row);
}

function clearHeaders() {
  elements.headersList.replaceChildren();
}

function collectHeaders() {
  const rows = $$('.header-row', elements.headersList).map((row) => {
    const [name, value] = $$('input', row);
    return { name: name?.value ?? '', value: value?.value ?? '' };
  });
  return headerRowsToObject(rows);
}

function updateBodyAvailability() {
  const disabled = elements.method.value === 'GET' || elements.method.value === 'HEAD';
  elements.body.disabled = disabled;
  elements.bodyField.classList.toggle('is-disabled', disabled);
}

/** Reapplies translations and re-renders dynamic lists after a language change. */
function updateStaticLanguage() {
  applyTranslations(document, state.lang);
  document.documentElement.lang = state.lang;
  elements.languageToggle.textContent = state.lang === 'es' ? 'EN' : 'ES';
  elements.languageToggle.setAttribute('aria-label', t(state.lang, 'toggle.language'));
  updateTheme();
  updateApiLinks();
  refreshHeaderRowsLanguage();
  renderPresets();
  renderCatalog();
  if (state.stats) renderDomains(state.stats);
  renderMode();
  setConnection(state.connection);
}

function renderPresets() {
  elements.presets.replaceChildren();
  for (const preset of presets) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip';
    button.textContent = preset.label[state.lang] ?? preset.label.es;
    button.addEventListener('click', () => applyPreset(preset));
    elements.presets.append(button);
  }
}

function applyPreset(preset) {
  elements.method.value = preset.method;
  elements.path.value = preset.path;
  elements.body.value = preset.body ?? '';
  clearHeaders();
  const headers = { ...(preset.headers ?? {}) };
  if (preset.body && !Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) {
    headers['Content-Type'] = 'application/json';
  }
  for (const [name, value] of Object.entries(headers)) addHeaderRow(name, value);
  if (Object.keys(headers).length === 0) addHeaderRow();
  updateBodyAvailability();
  document.querySelector('#lab')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  elements.path.focus({ preventScroll: true });
}

/** Renders per-domain table/record totals from `_control/stats`. */
function renderDomains(stats) {
  const domains = stats.domains ?? {};
  elements.domainGrid.replaceChildren();
  for (const [domain, data] of Object.entries(domains)) {
    const card = document.createElement('article');
    card.className = 'domain-card';
    const header = document.createElement('header');
    const title = document.createElement('h3');
    title.textContent =
      t(state.lang, `domain.${domain}`) === `domain.${domain}`
        ? compactDomainName(domain)
        : t(state.lang, `domain.${domain}`);
    const total = document.createElement('span');
    total.className = 'domain-total';
    total.textContent = formatNumber(data.total);
    header.append(title, total);
    const tables = document.createElement('p');
    tables.textContent = `${t(state.lang, 'overview.rows', { count: formatNumber(data.total) })} · ${t(state.lang, 'overview.tables', { count: Object.keys(data.tables ?? {}).length })}`;
    card.append(header, tables);
    elements.domainGrid.append(card);
  }
  if (Object.keys(domains).length === 0) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = t(state.lang, 'overview.offline');
    elements.domainGrid.append(empty);
  }
}

/** Renders the active data mode and the actions valid for that mode. */
function renderMode() {
  const mode = state.mode;
  const frozen = mode?.mode === 'frozen';
  elements.modeBadge.textContent = t(state.lang, frozen ? 'mode.frozen' : 'mode.persistent');
  elements.modeBadge.dataset.mode = frozen ? 'frozen' : 'persistent';
  elements.modeDescription.textContent = t(state.lang, frozen ? 'mode.frozenHint' : 'mode.persistentHint');
  elements.modeRestore.textContent = t(state.lang, frozen ? 'mode.restoreFrozen' : 'mode.restore');
  elements.modeFreeze.hidden = frozen;
  elements.modeUnfreeze.hidden = !frozen;
  const disabled = !mode || state.modeBusy;
  elements.modeFreeze.disabled = disabled;
  elements.modeRestore.disabled = disabled;
  elements.modeUnfreeze.disabled = disabled;
  elements.controlToken.disabled = state.modeBusy;
  elements.modeMessage.textContent =
    frozen && mode?.frozen_at
      ? t(state.lang, 'mode.frozenAt', {
          date: new Date(mode.frozen_at).toLocaleString(state.lang === 'es' ? 'es-ES' : 'en-GB'),
        })
      : '';
}

/** Toggles the data-mode controls while an action is in flight. */
function setModeBusy(busy) {
  state.modeBusy = busy;
  renderMode();
}

/** Runs freeze, restore or unfreeze and refreshes the overview afterwards. */
async function runModeAction(action) {
  if (!state.mode || state.modeBusy) return;
  const token = elements.controlToken.value.trim();
  if (!token) {
    showToast(t(state.lang, 'mode.tokenMissing'), true);
    elements.controlToken.focus();
    return;
  }
  session.setItem('bs.controlToken', token);
  const frozen = state.mode.mode === 'frozen';
  if (action === 'restore') {
    const key = frozen ? 'mode.confirmRestoreFrozen' : 'mode.confirmRestorePersistent';
    if (!window.confirm(t(state.lang, key))) return;
  }
  if (action === 'unfreeze' && !window.confirm(t(state.lang, 'mode.confirmUnfreeze'))) return;
  const path =
    action === 'freeze' ? '/_control/freeze' : action === 'unfreeze' ? '/_control/unfreeze' : '/_control/restore';
  setModeBusy(true);
  try {
    const result = await controlRequest(state.apiBase, path, { token, method: 'POST' });
    if (!result.ok) {
      showToast(t(state.lang, modeErrorKey(result.status), { status: result.status }), true);
      return;
    }
    if (result.body?.data) state.mode = result.body.data;
    const successKey =
      action === 'freeze'
        ? 'mode.freezeSuccess'
        : action === 'unfreeze'
          ? 'mode.unfreezeSuccess'
          : frozen
            ? 'mode.restoreSnapshot'
            : 'mode.restoreSeed';
    showToast(t(state.lang, successKey));
    await refreshOverview();
  } catch {
    showToast(t(state.lang, 'mode.error'), true);
  } finally {
    setModeBusy(false);
  }
}

function renderOverviewError() {
  elements.metricHealth.textContent = '—';
  elements.metricHealthDetail.textContent = t(state.lang, 'overview.offline');
  elements.metricUptime.textContent = '—';
  elements.metricRecords.textContent = '—';
  elements.metricDomains.textContent = '—';
  state.mode = null;
  renderMode();
  elements.domainGrid.replaceChildren();
  const message = document.createElement('p');
  message.className = 'muted';
  message.textContent = t(state.lang, 'overview.offline');
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'button button-small';
  retry.textContent = t(state.lang, 'overview.retry');
  retry.addEventListener('click', () => refreshOverview());
  elements.domainGrid.append(message, retry);
}

/** Loads health and domain statistics; failures leave the console usable offline. */
async function refreshOverview() {
  setConnection('checking');
  elements.refreshOverview.disabled = true;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);
  try {
    const [health, stats, mode] = await Promise.all([
      getJson(state.apiBase, '/health', controller.signal),
      getJson(state.apiBase, '/_control/stats', controller.signal),
      getJson(state.apiBase, '/_control/mode', controller.signal),
    ]);
    const healthData = health.data ?? {};
    state.stats = stats.data ?? {};
    state.mode = mode.data ?? null;
    elements.metricHealth.textContent = String(healthData.status ?? 'ok').toUpperCase();
    elements.metricHealthDetail.textContent = healthData.database?.ok
      ? t(state.lang, 'metric.databaseOk')
      : t(state.lang, 'metric.databaseDown');
    elements.metricUptime.textContent = formatUptime(healthData.uptime_seconds);
    elements.metricRecords.textContent = formatNumber(state.stats.total_records);
    elements.metricDomains.textContent = formatNumber(Object.keys(state.stats.domains ?? {}).length);
    renderDomains(state.stats);
    renderMode();
    setConnection('online');
  } catch {
    setConnection('offline');
    renderOverviewError();
  } finally {
    window.clearTimeout(timeout);
    elements.refreshOverview.disabled = false;
  }
}

function renderResponseHeaders(headers) {
  const rows = headersToRows(headers);
  elements.responseHeaders.replaceChildren();
  for (const row of rows) {
    const line = document.createElement('div');
    line.className = 'header-line';
    const name = document.createElement('dt');
    name.textContent = row.name;
    const value = document.createElement('dd');
    value.textContent = row.value;
    line.append(name, value);
    elements.responseHeaders.append(line);
  }
  elements.responseHeadersCount.textContent = String(rows.length);
  return rows;
}

function formatResponseBody(result) {
  if (result.binary) {
    return `${t(state.lang, 'lab.binaryBody')}\n\n${result.binaryPreview ?? ''}`;
  }
  const body = prettyPayload(result.text, result.contentType);
  if (!body) return t(state.lang, 'lab.noContent');
  const truncated = truncateText(body);
  return truncated.truncated ? `${truncated.text}\n\n${t(state.lang, 'lab.truncated')}` : truncated.text;
}

/** Renders status, timing, size, headers and a bounded response body. */
function renderResponse(result) {
  elements.responseEmpty.hidden = true;
  elements.responseContent.hidden = false;
  const tone = statusTone(result.status);
  elements.responseStatus.className = `response-status${tone === 'neutral' ? '' : ` is-${tone}`}`;
  elements.responseStatus.textContent = `${result.status} ${result.statusText}`.trim();
  elements.responseMeta.textContent = `${formatDuration(result.elapsed)} · ${formatBytes(result.bytes)} · ${result.contentType || '—'}`;
  elements.responseUrl.textContent = result.redirected
    ? `${result.url} · ${t(state.lang, 'lab.redirected')}`
    : result.url;
  renderResponseHeaders(result.headers);
  state.responseText = formatResponseBody(result);
  elements.responseBody.textContent = state.responseText;
  elements.copyResponse.disabled = false;
}

function renderRequestError(error) {
  elements.responseEmpty.hidden = true;
  elements.responseContent.hidden = false;
  elements.responseStatus.className = 'response-status is-error';
  elements.responseStatus.textContent = 'ERR';
  elements.responseMeta.textContent =
    error?.name === 'AbortError' ? t(state.lang, 'lab.aborted') : t(state.lang, 'lab.networkError');
  elements.responseUrl.textContent = elements.path.value;
  elements.responseHeaders.replaceChildren();
  elements.responseHeadersCount.textContent = '0';
  state.responseText = error instanceof Error ? error.message : String(error);
  elements.responseBody.textContent = state.responseText;
  elements.copyResponse.disabled = false;
}

/** Runs the Request Lab request, supporting reset/abort and error rendering. */
async function handleSend(event) {
  event.preventDefault();
  const method = elements.method.value;
  const path = elements.path.value.trim();
  if (!path) {
    showToast(t(state.lang, 'lab.invalidUrl'), true);
    elements.path.focus();
    return;
  }
  if (/^https?:/i.test(path) && !isValidHttpUrl(path)) {
    showToast(t(state.lang, 'lab.invalidUrl'), true);
    elements.path.focus();
    return;
  }

  state.controller?.abort();
  state.controller = new AbortController();
  const controller = state.controller;
  elements.send.disabled = true;
  elements.abort.hidden = false;
  elements.requestForm.setAttribute('aria-busy', 'true');
  try {
    const result = await performRequest({
      baseUrl: state.apiBase,
      path,
      method,
      headers: collectHeaders(),
      body: elements.body.disabled ? '' : elements.body.value,
      token: elements.token.value.trim(),
      attachAuth: elements.attachAuth.checked,
      signal: controller.signal,
    });
    setConnection('online');
    renderResponse(result);
  } catch (error) {
    if (controller !== state.controller) return;
    if (error?.name === 'AbortError') {
      showToast(t(state.lang, 'lab.aborted'));
    } else {
      renderRequestError(error);
      showToast(t(state.lang, 'lab.networkError'), true);
    }
  } finally {
    if (controller === state.controller) {
      elements.send.disabled = false;
      elements.abort.hidden = true;
      elements.requestForm.removeAttribute('aria-busy');
      state.controller = null;
    }
  }
}

/** Filters and renders the bilingual endpoint catalogue. */
function renderCatalog() {
  const query = elements.catalogSearch.value.trim().toLowerCase();
  elements.catalogRoot.replaceChildren();
  let visible = 0;
  for (const group of catalog) {
    const matches = group.entries.filter((entry) => {
      if (!query) return true;
      const title = entry.title[state.lang] ?? entry.title.es;
      const description = entry.description[state.lang] ?? entry.description.es;
      return `${entry.method} ${entry.path} ${title} ${description}`.toLowerCase().includes(query);
    });
    if (matches.length === 0) continue;
    visible += matches.length;
    const section = document.createElement('article');
    section.className = 'catalog-group';
    const heading = document.createElement('h3');
    const groupKey = `domain.${group.id}`;
    const groupName = t(state.lang, groupKey);
    heading.textContent = groupName === groupKey ? compactDomainName(group.id) : groupName;
    const count = document.createElement('span');
    count.className = 'catalog-count';
    count.textContent = String(matches.length);
    heading.append(count);
    const grid = document.createElement('div');
    grid.className = 'endpoint-grid';
    for (const entry of matches) {
      const card = document.createElement('article');
      card.className = 'endpoint-card';
      const top = document.createElement('div');
      top.className = 'endpoint-top';
      const method = document.createElement('span');
      method.className = `method ${entry.method.toLowerCase()}`;
      method.textContent = entry.method;
      const path = document.createElement('code');
      path.className = 'endpoint-path';
      path.textContent = entry.path;
      top.append(method, path);
      const title = document.createElement('h4');
      title.textContent = entry.title[state.lang] ?? entry.title.es;
      const description = document.createElement('p');
      description.textContent = entry.description[state.lang] ?? entry.description.es;
      const load = document.createElement('button');
      load.type = 'button';
      load.className = 'button button-small';
      load.textContent = t(state.lang, 'catalog.load');
      load.addEventListener('click', () => applyPreset(entry));
      card.append(top, title, description, load);
      grid.append(card);
    }
    section.append(heading, grid);
    elements.catalogRoot.append(section);
  }
  elements.catalogEmpty.hidden = visible > 0;
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(t(state.lang, 'toast.copySuccess'));
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.className = 'sr-only';
      document.body.append(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      showToast(t(state.lang, 'toast.copySuccess'));
    } catch {
      showToast(t(state.lang, 'toast.copyError'), true);
    }
  }
}

function applyBaseUrl() {
  const normalized = normalizeBaseUrl(elements.apiBase.value);
  if (!isValidHttpUrl(normalized)) {
    showToast(t(state.lang, 'toast.apiInvalid'), true);
    elements.apiBase.focus();
    return;
  }
  state.apiBase = normalized;
  local.setItem('bs.apiBase', normalized);
  elements.apiBase.value = normalized;
  updateApiLinks();
  showToast(t(state.lang, 'toast.apiSaved'));
  refreshOverview();
}

function setupNavObserver() {
  const links = $$('.main-nav a');
  const byId = new Map(links.map((link) => [link.getAttribute('href')?.slice(1), link]));
  const activate = (id) => {
    for (const link of links) link.classList.remove('is-active');
    byId.get(id)?.classList.add('is-active');
  };
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) activate(entry.target.id);
      }
    },
    { rootMargin: '-25% 0px -65% 0px', threshold: 0 },
  );
  for (const section of $$('main section[id]')) observer.observe(section);
  window.addEventListener('hashchange', () => activate(window.location.hash.slice(1) || 'overview'));
  window.setTimeout(() => activate(window.location.hash.slice(1) || 'overview'), 150);
}

function bindEvents() {
  elements.languageToggle.addEventListener('click', () => {
    state.lang = state.lang === 'es' ? 'en' : 'es';
    local.setItem('bs.lang', state.lang);
    updateStaticLanguage();
  });
  elements.themeToggle.addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    local.setItem('bs.theme', state.theme);
    updateTheme();
  });
  elements.applyBase.addEventListener('click', applyBaseUrl);
  elements.apiBase.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      applyBaseUrl();
    }
  });
  elements.refreshOverview.addEventListener('click', () => refreshOverview());
  elements.modeFreeze.addEventListener('click', () => runModeAction('freeze'));
  elements.modeRestore.addEventListener('click', () => runModeAction('restore'));
  elements.modeUnfreeze.addEventListener('click', () => runModeAction('unfreeze'));
  elements.controlToken.addEventListener('input', () => {
    session.setItem('bs.controlToken', elements.controlToken.value);
  });
  elements.requestForm.addEventListener('submit', handleSend);
  elements.method.addEventListener('change', updateBodyAvailability);
  elements.addHeader.addEventListener('click', () => {
    addHeaderRow();
    $('input', elements.headersList.lastElementChild)?.focus();
  });
  elements.headersList.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest('.remove-header');
    if (button) button.closest('.header-row')?.remove();
  });
  elements.demoToken.addEventListener('click', () => {
    elements.token.value = 'local-admin-token';
    elements.attachAuth.checked = true;
    state.attachAuth = true;
    session.setItem('bs.token', elements.token.value);
    session.setItem('bs.attachAuth', 'true');
    showToast(t(state.lang, 'toast.tokenLoaded'));
  });
  elements.token.addEventListener('input', () => {
    if (elements.token.value) session.setItem('bs.token', elements.token.value);
    else session.removeItem('bs.token');
  });
  elements.attachAuth.addEventListener('change', () => {
    session.setItem('bs.attachAuth', String(elements.attachAuth.checked));
  });
  elements.abort.addEventListener('click', () => {
    state.controller?.abort();
  });
  elements.copyResponse.addEventListener('click', () => copyToClipboard(state.responseText));
  elements.catalogSearch.addEventListener('input', renderCatalog);
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest('[data-copy]');
    if (button) copyToClipboard(button.getAttribute('data-copy') ?? '');
  });
  elements.requestForm.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      elements.requestForm.requestSubmit();
    }
  });
}

/** Applies persisted preferences, binds events and starts the first data load. */
function initialize() {
  elements.apiBase.value = state.apiBase;
  elements.token.value = state.token;
  elements.controlToken.value = state.controlToken;
  elements.attachAuth.checked = state.attachAuth;
  addHeaderRow('Accept', 'application/json');
  updateStaticLanguage();
  updateBodyAvailability();
  bindEvents();
  setupNavObserver();
  refreshOverview();
}

initialize();
