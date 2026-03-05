'use strict';

// ── Service Profiles ──────────────────────────────────────────────────────────
// Keys MUST match inbox names exactly as configured in Chatwoot.
const SERVICE_PROFILES = {
    'General Support': {
        tone:           'Friendly and Professional',
        requiredFields: ['name', 'phone', 'issueDescription'],
        prompt:         'Help the customer with general inquiries. Collect their full name, contact phone number, and a clear description of the issue they are experiencing.',
        handoffRules:   ['technical issue', 'hardware failure', 'refund', 'escalate', 'complaint', 'legal'],
    },
    'Fleet Services': {
        tone:           'Efficient and Technical',
        requiredFields: ['fleetId', 'vehiclePlate', 'serviceType'],
        prompt:         'You are assisting a fleet manager or driver. Collect the Fleet ID, Vehicle Plate number, and the type of service required: Maintenance, Repair, or Inspection.',
        handoffRules:   ['emergency', 'accident', 'breakdown', 'billing dispute', 'legal'],
    },
    'Sales': {
        tone:           'Persuasive and Helpful',
        requiredFields: ['interestedProduct', 'budgetRange', 'contactEmail'],
        prompt:         'You are a sales assistant. Identify the product the customer is interested in, their approximate budget range, and collect their email address for sending a personalised quote.',
        handoffRules:   ['ready to buy', 'custom quote', 'bulk order', 'contract', 'demo request'],
    },
};

// ── Inbox Mapping ─────────────────────────────────────────────────────────────
// Maps 3CX department names → Chatwoot Inbox IDs.
// parseInt(undefined) returns NaN which is falsy, so the || chain works correctly.
const defaultInbox = parseInt(process.env.CHATWOOT_INBOX_ID, 10) || 5;

const INBOX_MAPPING = {
    'Support': parseInt(process.env.CHATWOOT_SUPPORT_INBOX_ID, 10) || defaultInbox,
    'Sales':   parseInt(process.env.CHATWOOT_SALES_INBOX_ID,   10) || defaultInbox,
    'Fleet':   parseInt(process.env.CHATWOOT_FLEET_INBOX_ID,   10) || defaultInbox,
};

// ── SLA Configuration ─────────────────────────────────────────────────────────
// Configurable via .env — default 300 seconds (5 minutes)
const SLA_CONFIG = {
    FRT_TARGET_SECONDS: parseInt(process.env.SLA_FRT_SECONDS, 10) || 300,
};

module.exports = { SERVICE_PROFILES, INBOX_MAPPING, SLA_CONFIG };
