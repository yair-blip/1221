'use strict';

const sqlite3 = require('sqlite3').verbose();
const path    = require('path');
const fs      = require('fs');
const logger  = require('./logger');
const { SLA_CONFIG } = require('./configService');

// Ensure data directory exists
const dataDir = path.resolve(__dirname, '../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.resolve(dataDir, 'mvp.db');
const db     = new sqlite3.Database(dbPath, err => {
    if (err) logger.error(`[DB] Failed to open: ${err.message}`);
    else     logger.info(`[DB] Connected: ${dbPath}`);
});

db.run('PRAGMA journal_mode=WAL');
db.run('PRAGMA foreign_keys=ON');
db.run('PRAGMA synchronous=NORMAL');

// ── Schema ────────────────────────────────────────────────────────────────────
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS tickets (
        id                        INTEGER PRIMARY KEY AUTOINCREMENT,
        chatwoot_conversation_id  TEXT UNIQUE NOT NULL,
        contact_id                TEXT,
        status                    TEXT DEFAULT 'open',
        channel                   TEXT DEFAULT 'Web',
        is_escalated              INTEGER DEFAULT 0,
        resolved_at               DATETIME,
        created_at                DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at                DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Migrate older DBs that don't have resolved_at yet — safe to run every time
    db.run(`ALTER TABLE tickets ADD COLUMN resolved_at DATETIME`, () => {});

    db.run(`CREATE TABLE IF NOT EXISTS metrics (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id   INTEGER,
        event_type  TEXT,
        value       REAL,
        timestamp   DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(ticket_id) REFERENCES tickets(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS conversation_metadata (
        conversation_id  TEXT PRIMARY KEY,
        collected_data   TEXT DEFAULT '{}',
        updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Seed demo data when DB is fresh
    db.get('SELECT COUNT(*) as count FROM tickets', (err, row) => {
        if (!err && row && row.count === 0) {
            logger.info('[DB] Seeding demo data...');
            const channels  = ['WhatsApp', 'Email', 'Web', '3CX'];
            const statuses  = ['open', 'open', 'open', 'resolved'];
            const contacts  = ['contact_101', 'contact_102', 'contact_103', 'contact_104', 'contact_105'];
            // Use db.run() directly instead of prepared statements to avoid
            // SQLITE_MISUSE (finalize called before async callbacks complete)
            for (let i = 0; i < 25; i++) {
                const daysAgo    = Math.floor(Math.random() * 7);
                const created    = new Date(Date.now() - daysAgo * 86_400_000 - Math.random() * 3_600_000).toISOString();
                const escalated  = i % 6 === 0 ? 1 : 0;
                const status     = statuses[i % 4];
                const resolvedAt = status === 'resolved'
                    ? new Date(new Date(created).getTime() + (Math.random() * 3_600_000 + 60_000)).toISOString()
                    : null;
                db.run(
                    `INSERT INTO tickets (chatwoot_conversation_id, contact_id, status, channel, is_escalated, created_at, resolved_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [`demo_conv_${i}`, contacts[i % 5], status, channels[i % 4], escalated, created, resolvedAt],
                    function(seedErr) {
                        if (!seedErr && this.lastID) {
                            const ticketId = this.lastID;
                            const frt = Math.floor(Math.random() * 600 + 10);
                            db.run(
                                `INSERT INTO metrics (ticket_id, event_type, value, timestamp) VALUES (?, ?, ?, ?)`,
                                [ticketId, 'FRT', frt, created]
                            );
                            if (resolvedAt) {
                                const aht = Math.floor(Math.random() * 3600 + 120);
                                db.run(
                                    `INSERT INTO metrics (ticket_id, event_type, value, timestamp) VALUES (?, ?, ?, ?)`,
                                    [ticketId, 'AHT', aht, resolvedAt]
                                );
                            }
                        }
                    }
                );
            }
        }
    });
});

// ── Promise wrappers ──────────────────────────────────────────────────────────
function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) { err ? reject(err) : resolve(this); });
    });
}
function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => { err ? reject(err) : resolve(row); });
    });
}
function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => { err ? reject(err) : resolve(rows || []); });
    });
}

// ── Public API ────────────────────────────────────────────────────────────────

function logTicket(conversationId, contactId, status = 'open', channel = 'Web', isEscalated = 0) {
    if (!conversationId) return;
    const resolvedAt = status === 'resolved' ? new Date().toISOString() : null;
    db.run(
        `INSERT INTO tickets (chatwoot_conversation_id, contact_id, status, channel, is_escalated, resolved_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(chatwoot_conversation_id) DO UPDATE SET
             status       = excluded.status,
             is_escalated = MAX(is_escalated, excluded.is_escalated),
             resolved_at  = CASE WHEN excluded.status = 'resolved' AND resolved_at IS NULL
                              THEN excluded.resolved_at ELSE resolved_at END,
             updated_at   = CURRENT_TIMESTAMP`,
        [String(conversationId), contactId ? String(contactId) : null, status, channel, isEscalated, resolvedAt],
        err => { if (err) logger.error(`[DB] logTicket: ${err.message}`); }
    );
}

function updateMetadata(conversationId, data) {
    if (!conversationId) return;
    db.run(
        `INSERT INTO conversation_metadata (conversation_id, collected_data, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(conversation_id) DO UPDATE SET
             collected_data = excluded.collected_data,
             updated_at     = CURRENT_TIMESTAMP`,
        [String(conversationId), JSON.stringify(data || {})],
        err => { if (err) logger.error(`[DB] updateMetadata: ${err.message}`); }
    );
}

async function getMetadataAsync(conversationId) {
    if (!conversationId) return {};
    try {
        const row = await dbGet(
            'SELECT collected_data FROM conversation_metadata WHERE conversation_id = ?',
            [String(conversationId)]
        );
        if (!row) return {};
        try { return JSON.parse(row.collected_data) || {}; } catch { return {}; }
    } catch {
        return {};
    }
}

function logMetric(conversationId, eventType, value) {
    if (!conversationId || value == null) return;
    db.get(
        'SELECT id FROM tickets WHERE chatwoot_conversation_id = ?',
        [String(conversationId)],
        (err, row) => {
            if (row) {
                db.run('INSERT INTO metrics (ticket_id, event_type, value) VALUES (?, ?, ?)',
                    [row.id, eventType, value],
                    err2 => { if (err2) logger.error(`[DB] logMetric: ${err2.message}`); }
                );
            }
        }
    );
}

async function getReports() {
    const slaThreshold = SLA_CONFIG.FRT_TARGET_SECONDS;

    const [
        totalRow, statusVolumes, channelVolumes, frtRow, ahtRow,
        customerBreakdown, slaRow, recentActivity, dailyVolume,
        hourlyVolume, escalationTrend,
    ] = await Promise.all([
        dbGet('SELECT COUNT(*) as total FROM tickets'),
        dbAll('SELECT status, COUNT(*) as count FROM tickets GROUP BY status ORDER BY count DESC'),
        dbAll('SELECT channel, COUNT(*) as count FROM tickets GROUP BY channel ORDER BY count DESC'),
        dbGet("SELECT AVG(value) as avgResponse FROM metrics WHERE event_type = 'FRT'"),
        dbGet("SELECT AVG(value) as avgHandle FROM metrics WHERE event_type = 'AHT'"),
        dbAll(`SELECT contact_id, COUNT(*) as ticket_count
               FROM tickets WHERE contact_id IS NOT NULL AND contact_id NOT LIKE 'demo_%'
               GROUP BY contact_id ORDER BY ticket_count DESC LIMIT 10`),
        dbGet(`SELECT COUNT(*) as escalated,
                 SUM(CASE WHEN m.value > ${slaThreshold} THEN 1 ELSE 0 END) as breached
               FROM tickets t
               LEFT JOIN metrics m ON m.ticket_id = t.id AND m.event_type = 'FRT'
               WHERE t.is_escalated = 1`),
        dbAll(`SELECT * FROM tickets
               WHERE chatwoot_conversation_id NOT LIKE 'demo_%'
               ORDER BY updated_at DESC LIMIT 10`),
        dbAll(`SELECT date(created_at) as day, COUNT(*) as count,
                 SUM(CASE WHEN is_escalated=1 THEN 1 ELSE 0 END) as escalated
               FROM tickets WHERE created_at >= date('now', '-7 days')
               GROUP BY day ORDER BY day ASC`),
        dbAll(`SELECT strftime('%H:00', created_at) as hour, COUNT(*) as count
               FROM tickets WHERE created_at >= datetime('now', '-24 hours')
               GROUP BY hour ORDER BY hour ASC`),
        dbAll(`SELECT date(created_at) as day,
                 SUM(CASE WHEN is_escalated=1 THEN 1 ELSE 0 END) as escalated,
                 COUNT(*) as total
               FROM tickets WHERE created_at >= date('now', '-7 days')
               GROUP BY day ORDER BY day ASC`),
    ]);

    const totalTickets   = totalRow?.total || 0;
    const totalEscalated = slaRow?.escalated || 0;

    return {
        totalTickets,
        statusVolumes,
        channelVolumes,
        avgFirstResponse:  Math.round(frtRow?.avgResponse || 0),
        avgHandleTime:     Math.round(ahtRow?.avgHandle   || 0),
        customerBreakdown,
        totalEscalated,
        totalBreached:     slaRow?.breached || 0,
        slaThreshold,
        aiResolved:        Math.max(0, totalTickets - totalEscalated),
        recentActivity,
        dailyVolume,
        hourlyVolume,
        escalationTrend,
    };
}

async function getCustomerReport(contactId) {
    if (!contactId) return { contactId, totalTickets: 0, tickets: [], metrics: [], summary: {} };
    const [tickets, metrics] = await Promise.all([
        dbAll('SELECT * FROM tickets WHERE contact_id = ? ORDER BY created_at DESC', [contactId]),
        dbAll(`SELECT m.*, t.chatwoot_conversation_id FROM metrics m
               JOIN tickets t ON t.id = m.ticket_id
               WHERE t.contact_id = ? ORDER BY m.timestamp DESC`, [contactId]),
    ]);
    const summary = {
        totalTickets: tickets.length,
        open:         tickets.filter(t => t.status === 'open').length,
        resolved:     tickets.filter(t => t.status === 'resolved').length,
        escalated:    tickets.filter(t => t.is_escalated).length,
        channels:     [...new Set(tickets.map(t => t.channel))],
        avgFRT:       metrics.filter(m => m.event_type === 'FRT').reduce((a, m, _, arr) => a + m.value / arr.length, 0) || 0,
        firstSeen:    tickets[tickets.length - 1]?.created_at || null,
        lastSeen:     tickets[0]?.updated_at || null,
    };
    return { contactId, tickets, metrics, summary };
}

async function searchTickets({ status, channel, contactId, limit = 20, offset = 0 }) {
    const conditions = [];
    const params     = [];
    if (status)    { conditions.push('status = ?');     params.push(status); }
    if (channel)   { conditions.push('channel = ?');    params.push(channel); }
    if (contactId) { conditions.push('contact_id = ?'); params.push(contactId); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const [rows, countRow] = await Promise.all([
        dbAll(`SELECT * FROM tickets ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset]),
        dbGet(`SELECT COUNT(*) as total FROM tickets ${where}`, params),
    ]);
    return { tickets: rows, total: countRow?.total || 0, limit, offset };
}

module.exports = { logTicket, updateMetadata, getMetadataAsync, logMetric, getReports, getCustomerReport, searchTickets };
