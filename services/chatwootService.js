'use strict';

require('dotenv').config();
const axios = require('axios');
const logger = require('./logger');

if (!process.env.CHATWOOT_API_URL) logger.warn('[Chatwoot] CHATWOOT_API_URL not set');
if (!process.env.CHATWOOT_API_TOKEN) logger.warn('[Chatwoot] CHATWOOT_API_TOKEN not set');

const chatwootClient = axios.create({
    baseURL: process.env.CHATWOOT_API_URL,
    timeout: 15_000,
    headers: {
        'api_access_token': process.env.CHATWOOT_API_TOKEN,
        'Content-Type': 'application/json',
    },
});

chatwootClient.interceptors.request.use(req => {
    logger.info(`[Chatwoot→] ${req.method.toUpperCase()} ${req.url}`);
    return req;
});
chatwootClient.interceptors.response.use(
    res => res,
    err => {
        logger.error(`[Chatwoot✗] ${err.response?.status} ${JSON.stringify(err.response?.data)} | ${err.config?.url}`);
        return Promise.reject(err);
    }
);

// accountId is read per-call from env so it works even if env loads after module init
const getAccountId = () => process.env.CHATWOOT_ACCOUNT_ID;

async function sendMessage(accountId, conversationId, content, messageType = 'outgoing') {
    if (!content || !conversationId) {
        logger.warn('[Chatwoot] sendMessage: empty content or conversationId');
        return null;
    }
    const res = await chatwootClient.post(
        `/api/v1/accounts/${accountId || getAccountId()}/conversations/${conversationId}/messages`,
        { content, message_type: messageType, private: false }
    );
    return res.data;
}

// Send a private internal note visible only to agents (not to the customer).
// Used for handoff summaries so the agent knows context without customer seeing it.
async function sendPrivateNote(accountId, conversationId, content) {
    if (!content || !conversationId) return null;
    try {
        const res = await chatwootClient.post(
            `/api/v1/accounts/${accountId || getAccountId()}/conversations/${conversationId}/messages`,
            { content, message_type: 'outgoing', private: true }
        );
        return res.data;
    } catch (err) {
        logger.warn(`[Chatwoot] sendPrivateNote failed for conv ${conversationId}: ${err.message}`);
        return null;
    }
}

async function updateConversation(accountId, conversationId, data) {
    const res = await chatwootClient.patch(
        `/api/v1/accounts/${accountId || getAccountId()}/conversations/${conversationId}`,
        data
    );
    return res.data;
}

async function getConversationMessages(accountId, conversationId) {
    try {
        const res = await chatwootClient.get(
            `/api/v1/accounts/${accountId || getAccountId()}/conversations/${conversationId}/messages`
        );
        const payload = res.data?.payload;
        return Array.isArray(payload) ? payload : [];
    } catch (err) {
        logger.warn(`[Chatwoot] getMessages failed for conv ${conversationId}: ${err.message}`);
        return [];
    }
}

async function findContact(query) {
    try {
        const res = await chatwootClient.get(
            `/api/v1/accounts/${getAccountId()}/contacts/search`,
            { params: { q: query, include_contacts: true } }
        );
        return res.data?.payload?.[0] || null;
    } catch (err) {
        logger.warn(`[Chatwoot] findContact failed for "${query}": ${err.message}`);
        return null;
    }
}

async function findContactById(contactId) {
    if (!contactId) return null;
    try {
        const res = await chatwootClient.get(
            `/api/v1/accounts/${getAccountId()}/contacts/${contactId}`
        );
        return res.data?.payload || null;
    } catch (err) {
        logger.warn(`[Chatwoot] findContactById(${contactId}) failed: ${err.message}`);
        return null;
    }
}

async function createContact(name, phone = '', email = '') {
    const payload = { name };
    if (phone) payload.phone_number = phone;
    if (email) payload.email = email;
    const res = await chatwootClient.post(`/api/v1/accounts/${getAccountId()}/contacts`, payload);
    return res.data?.payload?.contact || res.data?.payload || res.data;
}

async function createConversation(contactId, inboxId, extraAttrs = {}) {
    const res = await chatwootClient.post(
        `/api/v1/accounts/${getAccountId()}/conversations`,
        { contact_id: contactId, inbox_id: inboxId, ...extraAttrs }
    );
    return res.data;
}

/**
 * Set custom attributes on a conversation.
 * Used by enterprise portals to pass the selected branch into Chatwoot context.
 */
async function setConversationCustomAttributes(accountId, conversationId, attributes) {
    try {
        const res = await chatwootClient.patch(
            `/api/v1/accounts/${accountId || getAccountId()}/conversations/${conversationId}`,
            { custom_attributes: attributes }
        );
        return res.data;
    } catch (err) {
        logger.warn(`[Chatwoot] setCustomAttributes(${conversationId}) failed: ${err.message}`);
        return null;
    }
}

/**
 * Assign a conversation to a specific agent.
 * Called automatically on AI→human handoff if DEFAULT_ASSIGNEE_ID is set.
 */
async function assignConversation(accountId, conversationId, assigneeId) {
    if (!assigneeId) return null;
    try {
        const res = await chatwootClient.patch(
            `/api/v1/accounts/${accountId || getAccountId()}/conversations/${conversationId}/assignments`,
            { assignee_id: assigneeId }
        );
        return res.data;
    } catch (err) {
        logger.warn(`[Chatwoot] assignConversation(${conversationId}) failed: ${err.message}`);
        return null;
    }
}

/**
 * Downloads a file (image) from Chatwoot using the API token and converts it to a base64 Data URL.
 * This is used to pass images to OpenAI Vision without requiring the URL to be public.
 */
async function downloadFileAsBase64(url) {
    if (!url) return null;
    try {
        const res = await axios.get(url, {
            responseType: 'arraybuffer',
            headers: { 'api_access_token': process.env.CHATWOOT_API_TOKEN || '' }
        });
        const contentType = res.headers['content-type'] || 'image/jpeg';
        const base64 = Buffer.from(res.data, 'binary').toString('base64');
        return `data:${contentType};base64,${base64}`;
    } catch (err) {
        logger.error(`[Chatwoot] downloadFileAsBase64 failed for ${url}: ${err.message}`);
        return null;
    }
}

module.exports = {
    sendMessage,
    sendPrivateNote,
    updateConversation,
    getConversationMessages,
    findContact,
    findContactById,
    createContact,
    createConversation,
    assignConversation,
    setConversationCustomAttributes,
    downloadFileAsBase64,
};
