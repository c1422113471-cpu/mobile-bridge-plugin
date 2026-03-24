import fs from 'node:fs';
import crypto from 'node:crypto';

const DEFAULTS = {
  gatewayUrl: 'http://127.0.0.1:8787/_openclaw/notify/events',
  gatewayToken: '',
  targetUrl: '/ui/',
  eventType: 'reply_finished',
  maxBodyChars: 160,
  skipSubagents: true,
  skipHeartbeat: true,
  debugLogPath: '',
};

function getPluginConfig(api) {
  const cfg = api?.config && typeof api.config === 'object' ? api.config : {};
  return {
    gatewayUrl: String(cfg.gatewayUrl || process.env.OPENCLAW_MOBILE_GATEWAY_URL || DEFAULTS.gatewayUrl).trim(),
    gatewayToken: String(cfg.gatewayToken || process.env.OPENCLAW_MOBILE_GATEWAY_TOKEN || DEFAULTS.gatewayToken).trim(),
    targetUrl: String(cfg.targetUrl || DEFAULTS.targetUrl).trim() || DEFAULTS.targetUrl,
    eventType: String(cfg.eventType || DEFAULTS.eventType).trim() || DEFAULTS.eventType,
    maxBodyChars: normalizeMaxBodyChars(cfg.maxBodyChars),
    skipSubagents: cfg.skipSubagents ?? DEFAULTS.skipSubagents,
    skipHeartbeat: cfg.skipHeartbeat ?? DEFAULTS.skipHeartbeat,
    debugLogPath: String(cfg.debugLogPath || DEFAULTS.debugLogPath).trim(),
  };
}

function normalizeMaxBodyChars(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULTS.maxBodyChars;
  return Math.max(32, Math.min(2000, Math.floor(n)));
}

function appendDebug(config, line) {
  if (!config.debugLogPath) return;
  try {
    fs.appendFileSync(config.debugLogPath, `${new Date().toISOString()} ${line}\n`);
  } catch {}
}

function extractText(content) {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part || typeof part !== 'object') return '';
        if (part.type === 'text' && typeof part.text === 'string') return part.text;
        if (part.type === 'output_text' && typeof part.text === 'string') return part.text;
        if (typeof part.content === 'string') return part.content;
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  if (content && typeof content === 'object') {
    if (typeof content.text === 'string') return content.text.trim();
  }
  return '';
}

function normalizeText(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/\[\[\s*reply_to_current\s*\]\]/gi, '').trim();
}

function shouldSkip(event, ctx, config) {
  const msg = event?.message;
  if (!msg || msg.role !== 'assistant') return true;
  const text = normalizeText(extractText(msg.content));
  if (!text) return true;
  if (text === 'NO_REPLY') return true;
  if (config.skipHeartbeat && text === 'HEARTBEAT_OK') return true;
  if (config.skipSubagents && ctx?.sessionKey && String(ctx.sessionKey).includes('subagent:')) return true;
  return false;
}

function buildPayload(event, ctx, config) {
  const text = normalizeText(extractText(event.message.content));
  const sourceId = event?.message?.id || event?.message?.messageId || '';
  const rawTimestamp = event?.message?.createdAt || event?.message?.timestamp || Date.now();
  const stableInput = JSON.stringify({
    sessionKey: ctx?.sessionKey || '',
    sourceId,
    rawTimestamp,
    text,
  });
  const eventId = `reply_${crypto.createHash('sha1').update(stableInput).digest('hex').slice(0, 16)}`;
  return {
    event: {
      eventId,
      type: config.eventType,
      body: text.length > config.maxBodyChars ? `${text.slice(0, config.maxBodyChars - 3)}...` : text,
      text,
      sessionKey: ctx?.sessionKey,
      agentId: ctx?.agentId,
      messageId: sourceId || undefined,
      timestamp: typeof rawTimestamp === 'string' ? rawTimestamp : new Date(Number(rawTimestamp)).toISOString(),
      targetUrl: config.targetUrl,
    },
  };
}

function fireAndForget(config, payload, logger) {
  appendDebug(config, `[publish] POST ${config.gatewayUrl} body=${JSON.stringify(payload).slice(0, 500)}`);
  const headers = { 'content-type': 'application/json' };
  if (config.gatewayToken) {
    headers.authorization = `Bearer ${config.gatewayToken}`;
  }
  fetch(config.gatewayUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  }).then(async (res) => {
    let body = '';
    try { body = await res.text(); } catch {}
    appendDebug(config, `[publish] status=${res.status} body=${body.slice(0, 500)}`);
    logger.info(`[mobile-bridge-plugin] publish status=${res.status} body=${body.slice(0, 300)}`);
  }).catch((err) => {
    appendDebug(config, `[publish] failed ${err?.stack || err}`);
    logger.error(`[mobile-bridge-plugin] publish failed: ${err?.stack || err}`);
  });
}

function handleBeforeMessageWrite(event, ctx, api, config) {
  const text = normalizeText(extractText(event?.message?.content));
  appendDebug(config, `[hook] before_message_write role=${event?.message?.role || ''} sessionKey=${ctx?.sessionKey || ''} text=${JSON.stringify(text).slice(0, 300)}`);
  api.logger.info(`[mobile-bridge-plugin] before_message_write role=${event?.message?.role} sessionKey=${ctx?.sessionKey || ''}`);
  if (shouldSkip(event, ctx, config)) {
    appendDebug(config, '[hook] skipped');
    return;
  }
  const payload = buildPayload(event, ctx, config);
  appendDebug(config, '[hook] accepted');
  fireAndForget(config, payload, api.logger);
}

export default {
  id: 'mobile-bridge-plugin',
  name: 'Mobile Bridge Plugin',
  version: '0.1.0',
  register(api) {
    const config = getPluginConfig(api);
    appendDebug(config, '[register] plugin register called');
    api.logger.info(`[mobile-bridge-plugin] registered gatewayUrl=${config.gatewayUrl}`);
    api.registerHook('before_message_write', (event, ctx) => handleBeforeMessageWrite(event, ctx, api, config), {
      name: 'mobile-bridge-before-message-write',
      description: 'Forward completed assistant replies to a configurable mobile/web bridge endpoint.',
    });
  },
};
