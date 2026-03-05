'use strict';

/**
 * asteriskService.js
 * ────────────────────────────────────────────────────────────────────────────
 * Asterisk AMI (Asterisk Manager Interface) middleware.
 *
 * Architecture:
 *   Incoming Call → Asterisk (AMI events captured here)
 *                 → SIP Trunk → 3CX (human answers)
 *                 → API triggers to Chatwoot (contact + conversation auto-created)
 *
 * What this service does:
 *   1. Connects to Asterisk AMI via TCP socket
 *   2. Listens for call events (Newchannel, Hangup, Answer, etc.)
 *   3. On new call: creates/finds Chatwoot contact, opens conversation with metadata
 *   4. On missed call: sends WhatsApp follow-up to caller
 *   5. On answered + hangup: sends handled-call follow-up message
 *
 * Requirements: Asterisk with manager.conf configured (see below)
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Asterisk manager.conf (add to your Asterisk server):
 * ─────────────────────────────────────────────────────
 * [general]
 * enabled = yes
 * port = 5038
 * bindaddr = 0.0.0.0
 *
 * [bartech]
 * secret = your_ami_secret
 * deny = 0.0.0.0/0.0.0.0
 * permit = 127.0.0.1/255.255.255.0   ; or your app server IP
 * read = all
 * write = all
 * writetimeout = 5000
 * ─────────────────────────────────────────────────────
 *
 * Asterisk extensions.conf snippet (dialplan):
 * ─────────────────────────────────────────────
 * [from-trunk]
 * exten => _X.,1,NoOp(Incoming call from ${CALLERID(num)})
 *  same => n,Set(CALLERID_NUM=${CALLERID(num)})
 *  same => n,Set(CALLERID_NAME=${CALLERID(name)})
 *  same => n,Dial(SIP/3cx-trunk/${EXTEN},30,gU(missed-call-handler))   ; ring 3CX for 30s
 *  same => n,Hangup()
 *
 * [missed-call-handler]
 * exten => h,1,NoOp(Call ended - hangup handler)
 *  same => n,Hangup()
 * ─────────────────────────────────────────────
 */

const net             = require('net');
const EventEmitter    = require('events');
const chatwootService = require('./chatwootService');
const whatsappService = require('./whatsappService');
const logger          = require('./logger');

// ── Configuration ─────────────────────────────────────────────────────────────
const AMI_HOST    = process.env.ASTERISK_AMI_HOST   || '127.0.0.1';
const AMI_PORT    = parseInt(process.env.ASTERISK_AMI_PORT || '5038', 10);
const AMI_USER    = process.env.ASTERISK_AMI_USER   || 'bartech';
const AMI_SECRET  = process.env.ASTERISK_AMI_SECRET || '';
const RECONNECT_DELAY = 10_000; // ms before reconnection attempt

// ── In-memory call state ──────────────────────────────────────────────────────
// Map of UniqueID → call metadata
const activeCalls = new Map();

class AsteriskAMI extends EventEmitter {
    constructor() {
        super();
        this.socket    = null;
        this.buffer    = '';
        this.connected = false;
        this._shouldConnect = false;
    }

    connect() {
        this._shouldConnect = true;
        this._connect();
    }

    _connect() {
        if (!this._shouldConnect) return;
        if (!AMI_SECRET) {
            logger.warn('[Asterisk] ASTERISK_AMI_SECRET not set — Asterisk integration disabled');
            return;
        }

        logger.info(`[Asterisk] Connecting to AMI at ${AMI_HOST}:${AMI_PORT}`);
        this.socket = new net.Socket();
        this.socket.setEncoding('utf8');

        this.socket.connect(AMI_PORT, AMI_HOST, () => {
            logger.info('[Asterisk] AMI socket connected');
        });

        this.socket.on('data', data => {
            this.buffer += data;
            const events = this.buffer.split('\r\n\r\n');
            this.buffer  = events.pop(); // keep partial last block
            events.forEach(block => {
                if (block.trim()) this._parseBlock(block);
            });
        });

        this.socket.on('close', () => {
            this.connected = false;
            logger.warn('[Asterisk] AMI socket closed — reconnecting in 10s');
            if (this._shouldConnect) setTimeout(() => this._connect(), RECONNECT_DELAY);
        });

        this.socket.on('error', err => {
            logger.error(`[Asterisk] AMI socket error: ${err.message}`);
            this.socket.destroy();
        });
    }

    _parseBlock(block) {
        const lines = block.split('\r\n');
        const parsed = {};
        lines.forEach(line => {
            const idx = line.indexOf(':');
            if (idx > -1) {
                const key   = line.slice(0, idx).trim();
                const value = line.slice(idx + 1).trim();
                parsed[key] = value;
            }
        });

        if (!parsed.Event && !parsed.Response) return;

        // Handle login challenge
        if (parsed.Response === 'Success' && !this.connected) {
            this.connected = true;
            logger.info('[Asterisk] AMI authenticated');
            this.emit('connected');
            return;
        }

        if (parsed['Asterisk Call Manager']) {
            // Banner line — send login
            this._login();
            return;
        }

        this.emit('ami_event', parsed);
    }

    _login() {
        const cmd = `Action: Login\r\nUsername: ${AMI_USER}\r\nSecret: ${AMI_SECRET}\r\nEvents: on\r\n\r\n`;
        this.socket.write(cmd);
    }

    _send(action) {
        if (!this.connected || !this.socket) return;
        let msg = '';
        Object.entries(action).forEach(([k, v]) => { msg += `${k}: ${v}\r\n`; });
        msg += '\r\n';
        this.socket.write(msg);
    }

    originate(to, from, context = 'from-internal') {
        this._send({
            Action:   'Originate',
            Channel:  `SIP/${to}`,
            Exten:    from,
            Context:  context,
            Priority: 1,
            CallerID: from,
            Async:    'yes',
        });
    }

    disconnect() {
        this._shouldConnect = false;
        if (this.socket) this.socket.destroy();
    }
}

const ami = new AsteriskAMI();

// ── Call event handlers ───────────────────────────────────────────────────────

ami.on('ami_event', async (event) => {
    const { Event: evtName, UniqueID, CallerID1, CallerIDName, Channel, Exten } = event;
    if (!evtName) return;

    logger.info(`[Asterisk] AMI Event: ${evtName}${UniqueID ? ' uid:' + UniqueID : ''}`);

    switch (evtName) {

        // ── New call started ────────────────────────────────────────────────
        case 'Newchannel': {
            if (!UniqueID || !CallerID1 || CallerID1 === '<unknown>') break;
            activeCalls.set(UniqueID, {
                callerNumber:   CallerID1,
                callerName:     CallerIDName || '',
                extension:      Exten || '',
                channel:        Channel || '',
                startTime:      Date.now(),
                answered:       false,
                chatwootConvId: null,
            });
            logger.info(`[Asterisk] New call from ${CallerID1} (uid:${UniqueID})`);

            // Fire Chatwoot contact+conversation creation in background
            _createChatwootCallRecord(UniqueID, CallerID1, CallerIDName).catch(err =>
                logger.error(`[Asterisk] Chatwoot record failed: ${err.message}`)
            );
            break;
        }

        // ── Call was answered ───────────────────────────────────────────────
        case 'Answer': {
            const call = activeCalls.get(UniqueID);
            if (call) {
                call.answered = true;
                logger.info(`[Asterisk] Call answered uid:${UniqueID}`);
            }
            break;
        }

        // ── Call ended ──────────────────────────────────────────────────────
        case 'Hangup': {
            const call = activeCalls.get(UniqueID);
            if (!call) break;

            const duration  = Math.round((Date.now() - call.startTime) / 1000);
            const wasMissed = !call.answered;

            logger.info(`[Asterisk] Hangup uid:${UniqueID} answered:${!wasMissed} duration:${duration}s`);

            // Update Chatwoot conversation with outcome
            if (call.chatwootConvId) {
                await _updateCallOutcome(call, wasMissed, duration).catch(err =>
                    logger.error(`[Asterisk] Update outcome failed: ${err.message}`)
                );
            }

            // Send follow-up WhatsApp
            if (call.callerNumber && call.callerNumber !== '<unknown>') {
                const phone = _normalizePhone(call.callerNumber);
                if (wasMissed) {
                    await _sendMissedCallWhatsApp(phone, call.callerName).catch(err =>
                        logger.error(`[Asterisk] Missed call WA failed: ${err.message}`)
                    );
                } else {
                    await _sendHandledCallWhatsApp(phone, call.callerName).catch(err =>
                        logger.error(`[Asterisk] Handled call WA failed: ${err.message}`)
                    );
                }
            }

            activeCalls.delete(UniqueID);
            break;
        }

        default:
            break; // we only care about the above events
    }
});

// ── Internal helpers ──────────────────────────────────────────────────────────

async function _createChatwootCallRecord(uniqueId, callerNumber, callerName) {
    const accountId = process.env.CHATWOOT_ACCOUNT_ID;
    const inboxId   = process.env.CHATWOOT_PHONE_INBOX_ID || process.env.CHATWOOT_INBOX_ID;
    const phone     = _normalizePhone(callerNumber);

    // Find or create contact
    let contact = await chatwootService.findContact(phone);
    if (!contact) {
        contact = await chatwootService.createContact(
            callerName || phone,
            phone,
            null // no email for phone-only contacts
        );
    }

    // Create conversation with call metadata
    const conv = await chatwootService.createConversation(contact.id, inboxId, {
        additional_attributes: {
            source:       'phone_call',
            asterisk_uid: uniqueId,
            caller:       callerNumber,
        },
    });

    // Post initial note with call metadata
    await chatwootService.sendPrivateNote(accountId, conv.id,
        `📞 **Incoming Call**\n` +
        `Caller: ${callerName || 'Unknown'} (${callerNumber})\n` +
        `Time: ${new Date().toLocaleString('en-GB', { timeZone: process.env.BUSINESS_TZ || 'UTC' })}\n` +
        `Status: Ringing…`
    );

    // Store conv ID back into call state
    const call = activeCalls.get(uniqueId);
    if (call) call.chatwootConvId = conv.id;

    logger.info(`[Asterisk] Chatwoot conv #${conv.id} created for call from ${callerNumber}`);
    return conv;
}

async function _updateCallOutcome(call, wasMissed, durationSec) {
    const accountId = process.env.CHATWOOT_ACCOUNT_ID;
    const note = wasMissed
        ? `📵 **Missed Call** — Duration in queue: ${durationSec}s\nNo agent answered. WhatsApp follow-up sent.`
        : `✅ **Call Handled** — Duration: ${durationSec}s\nCall connected to 3CX agent. Follow-up WhatsApp sent.`;

    await chatwootService.sendPrivateNote(accountId, call.chatwootConvId, note);

    // Tag conversation
    await chatwootService.updateConversation(accountId, call.chatwootConvId, {
        additional_attributes: {
            call_outcome:  wasMissed ? 'missed' : 'answered',
            call_duration: durationSec,
        },
    });
}

async function _sendMissedCallWhatsApp(phone, callerName) {
    const name    = callerName ? ` ${callerName}` : '';
    const message =
        `Hi${name}! 👋\n\nWe missed your call at Bar-Tech. We're sorry we couldn't answer right now.\n\n` +
        `You can reach us faster through this chat — just type your question or issue and our team will respond shortly.\n\n` +
        `Alternatively, you can call us back during business hours:\n📅 Sunday–Thursday, 08:00–16:00\n\n— Bar-Tech Team`;

    await whatsappService.sendWhatsApp(phone, message);
    logger.info(`[Asterisk] Missed call follow-up WhatsApp sent to ${phone}`);
}

async function _sendHandledCallWhatsApp(phone, callerName) {
    const name    = callerName ? ` ${callerName}` : '';
    const message =
        `Hi${name}! 👋\n\nThank you for calling Bar-Tech! We hope your issue was resolved.\n\n` +
        `If you need any follow-up support or have additional questions, feel free to continue the conversation here — it's the fastest way to reach us.\n\n— Bar-Tech Team`;

    await whatsappService.sendWhatsApp(phone, message);
    logger.info(`[Asterisk] Post-call WhatsApp sent to ${phone}`);
}

/**
 * Normalise Israeli/international phone numbers to E.164.
 * e.g. 0501234567 → +9720501234567
 */
function _normalizePhone(raw) {
    if (!raw) return raw;
    let num = raw.replace(/\D/g, '');
    if (num.startsWith('972')) return `+${num}`;
    if (num.startsWith('0'))   return `+972${num.slice(1)}`;
    if (num.startsWith('00'))  return `+${num.slice(2)}`;
    return `+${num}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * start
 * Call once from index.js to begin listening for Asterisk events.
 */
function start() {
    if (!process.env.ASTERISK_AMI_SECRET) {
        logger.info('[Asterisk] AMI credentials not configured — telephony integration skipped');
        return;
    }
    ami.connect();
    logger.info('[Asterisk] AMI service started');
}

function stop() {
    ami.disconnect();
}

/** For testing: manually trigger a fake call event */
function _simulateCall(callerNumber, answered = false) {
    const uid = `sim-${Date.now()}`;
    ami.emit('ami_event', { Event: 'Newchannel', UniqueID: uid, CallerID1: callerNumber, CallerIDName: 'Test' });
    if (answered) {
        setTimeout(() => ami.emit('ami_event', { Event: 'Answer', UniqueID: uid }), 200);
    }
    setTimeout(() => ami.emit('ami_event', { Event: 'Hangup',  UniqueID: uid }), 400);
}

module.exports = { start, stop, _simulateCall, _normalizePhone };
