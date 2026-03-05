'use strict';

/**
 * routes/portals.js
 * ────────────────────────────────────────────────────────────────────────────
 * Enterprise Client Portal routes.
 *
 * GET  /portal/:slug          → Renders the branded HTML support page
 * POST /portal/:slug/ticket   → Creates Chatwoot contact + conversation
 *                               with branch as custom attribute, returns conv ID
 * ────────────────────────────────────────────────────────────────────────────
 */

const express         = require('express');
const router          = express.Router();
const path            = require('path');
const fs              = require('fs');

const CLIENTS         = require('../config/portalClients');
const chatwootService = require('../services/chatwootService');
const dbService       = require('../services/dbService');
const lifecycleService= require('../services/lifecycleService');
const logger          = require('../services/logger');

// ── Rate limit portal ticket creation (prevent spam) ─────────────────────────
const rateLimit = require('express-rate-limit');
const portalTicketLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 min
    max:      10,
    message:  { error: 'Too many submissions — please wait 15 minutes.' },
});

// ── GET /portal/:slug ─────────────────────────────────────────────────────────
router.get('/:slug', (req, res) => {
    const client = CLIENTS[req.params.slug?.toLowerCase()];
    if (!client) {
        return res.status(404).send(`
            <html><body style="font-family:sans-serif;text-align:center;padding:4rem">
            <h2>404 — Portal Not Found</h2>
            <p>The client portal you requested does not exist.</p>
            </body></html>`);
    }

    // Check logo exists, fall back to placeholder
    const logoPath     = path.join(__dirname, '../public/portals/logos', client.logoFile);
    const logoUrl      = fs.existsSync(logoPath)
        ? `/portals/logos/${client.logoFile}`
        : `/portals/logos/placeholder.png`;

    const branchOptions = client.branches
        .map(b => `<option value="${_esc(b)}">${_esc(b)}</option>`)
        .join('\n');

    const html = buildPortalHTML(client, logoUrl, branchOptions, req.params.slug);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
});

// ── POST /portal/:slug/ticket ─────────────────────────────────────────────────
router.post('/:slug/ticket', portalTicketLimiter, async (req, res) => {
    const client = CLIENTS[req.params.slug?.toLowerCase()];
    if (!client) return res.status(404).json({ error: 'Portal not found' });

    const { name, email, phone, branch, subject, description } = req.body || {};

    // Validate required fields
    if (!name || !branch || !description) {
        return res.status(400).json({ error: 'name, branch, and description are required' });
    }
    if (!client.branches.includes(branch)) {
        return res.status(400).json({ error: 'Invalid branch selection' });
    }

    const accountId = process.env.CHATWOOT_ACCOUNT_ID;
    const inboxId   = client.chatwootInboxId || process.env.CHATWOOT_SUPPORT_INBOX_ID;

    try {
        // 1. Find or create Chatwoot contact
        let contact;
        if (email) contact = await chatwootService.findContact(email);
        if (!contact && phone) contact = await chatwootService.findContact(phone);
        if (!contact) {
            contact = await chatwootService.createContact(name, phone || '', email || '');
        }

        // 2. Create conversation
        const conv = await chatwootService.createConversation(contact.id, inboxId, {
            additional_attributes: {
                portal_client:   client.name,
                portal_slug:     req.params.slug,
                branch:          branch,
                submitted_via:   'enterprise_portal',
            },
        });

        // 3. Set branch as a Chatwoot Custom Attribute
        await chatwootService.setConversationCustomAttributes(accountId, conv.id, {
            client_branch: branch,
            client_name:   client.name,
            portal_slug:   req.params.slug,
        }).catch(err => logger.warn(`[Portal] Custom attributes failed: ${err.message}`));

        // 4. Post the ticket details as the first message
        const ticketBody =
            `📋 **Support Request via ${client.name} Portal**\n\n` +
            `**Name:** ${name}\n` +
            `**Branch:** ${branch}\n` +
            (email ? `**Email:** ${email}\n` : '') +
            (phone ? `**Phone:** ${phone}\n` : '') +
            (subject ? `**Subject:** ${subject}\n` : '') +
            `\n**Description:**\n${description}`;

        await chatwootService.sendMessage(accountId, conv.id, ticketBody, 'incoming');

        // 5. Log to local DB
        dbService.logTicket(conv.id, contact.id, 'open', `Portal:${client.name}`);

        // 6. Lifecycle notification
        await lifecycleService.notifyTicketOpened({
            ticketId:     conv.id,
            phone:        phone || null,
            email:        email || null,
            customerName: name,
            lang:         'en',
        });

        logger.info(`[Portal] Ticket #${conv.id} created for ${client.name} — branch: ${branch}`);
        res.json({ success: true, ticketId: conv.id });

    } catch (err) {
        logger.error(`[Portal] Ticket creation failed: ${err.message}`);
        res.status(500).json({ error: 'Failed to create support ticket. Please try again.' });
    }
});

// ── HTML builder ──────────────────────────────────────────────────────────────
function buildPortalHTML(client, logoUrl, branchOptions, slug) {
    const color = client.primaryColor || '#0057A8';
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${_esc(client.name)} — Support Portal</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f7fa;color:#333;min-height:100vh}
  header{background:${color};color:#fff;padding:1.2rem 2rem;display:flex;align-items:center;gap:1.5rem;box-shadow:0 2px 8px rgba(0,0,0,.15)}
  header img{height:52px;object-fit:contain;background:#fff;border-radius:6px;padding:4px 8px}
  header h1{font-size:1.3rem;font-weight:600;line-height:1.3}
  .container{max-width:640px;margin:3rem auto;padding:0 1rem}
  .card{background:#fff;border-radius:12px;box-shadow:0 2px 16px rgba(0,0,0,.08);padding:2.5rem}
  h2{font-size:1.15rem;margin-bottom:1.5rem;color:#444;font-weight:500}
  label{display:block;font-size:.85rem;font-weight:600;margin-bottom:.35rem;color:#555}
  input,select,textarea{width:100%;padding:.7rem .9rem;border:1.5px solid #dde;border-radius:8px;font-size:.95rem;transition:border .2s}
  input:focus,select:focus,textarea:focus{outline:none;border-color:${color}}
  .field{margin-bottom:1.2rem}
  .required::after{content:' *';color:#e53;font-size:.8rem}
  textarea{min-height:120px;resize:vertical}
  button[type=submit]{width:100%;padding:.85rem;background:${color};color:#fff;border:none;border-radius:8px;font-size:1rem;font-weight:600;cursor:pointer;transition:opacity .2s;margin-top:.5rem}
  button[type=submit]:hover{opacity:.88}
  button[type=submit]:disabled{opacity:.5;cursor:not-allowed}
  .success-msg{display:none;background:#e8f5e9;border:1.5px solid #4caf50;border-radius:8px;padding:1.2rem;margin-top:1rem;color:#2e7d32;text-align:center;font-weight:500}
  .error-msg{display:none;background:#fdecea;border:1.5px solid #f44336;border-radius:8px;padding:1rem;margin-top:1rem;color:#b71c1c;font-size:.9rem}
  footer{text-align:center;padding:2rem;color:#aaa;font-size:.8rem}
</style>
</head>
<body>
<header>
  <img src="${logoUrl}" alt="${_esc(client.name)} logo" onerror="this.style.display='none'"/>
  <h1>${_esc(client.welcomeText || client.name + ' — Support Portal')}</h1>
</header>

<div class="container">
  <div class="card">
    <h2>Open a Support Ticket</h2>
    <form id="portalForm">
      <div class="field">
        <label class="required" for="name">Full Name</label>
        <input type="text" id="name" name="name" placeholder="Your full name" required/>
      </div>
      <div class="field">
        <label class="required" for="branch">Branch / Location</label>
        <select id="branch" name="branch" required>
          <option value="">— Select your branch —</option>
          ${branchOptions}
        </select>
      </div>
      <div class="field">
        <label for="email">Email Address</label>
        <input type="email" id="email" name="email" placeholder="your@email.com"/>
      </div>
      <div class="field">
        <label for="phone">Phone / WhatsApp</label>
        <input type="tel" id="phone" name="phone" placeholder="+972 50 000 0000"/>
      </div>
      <div class="field">
        <label for="subject">Subject</label>
        <input type="text" id="subject" name="subject" placeholder="Brief summary of the issue"/>
      </div>
      <div class="field">
        <label class="required" for="description">Description</label>
        <textarea id="description" name="description" placeholder="Please describe the issue in detail…" required></textarea>
      </div>
      <button type="submit" id="submitBtn">Submit Support Request</button>
    </form>
    <div class="success-msg" id="successMsg">
      ✅ Your ticket has been submitted! A member of our team will contact you shortly.<br/>
      <small id="ticketRef"></small>
    </div>
    <div class="error-msg" id="errorMsg"></div>
  </div>
</div>
<footer>Powered by Bar-Tech Support Platform</footer>

<script>
  document.getElementById('portalForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const btn  = document.getElementById('submitBtn');
    const errDiv = document.getElementById('errorMsg');
    const sucDiv = document.getElementById('successMsg');
    btn.disabled = true;
    btn.textContent = 'Submitting…';
    errDiv.style.display = 'none';

    const payload = {
      name:        document.getElementById('name').value.trim(),
      branch:      document.getElementById('branch').value,
      email:       document.getElementById('email').value.trim(),
      phone:       document.getElementById('phone').value.trim(),
      subject:     document.getElementById('subject').value.trim(),
      description: document.getElementById('description').value.trim(),
    };

    try {
      const resp = await fetch('/portal/${slug}/ticket', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
      const data = await resp.json();

      if (resp.ok && data.success) {
        this.style.display = 'none';
        document.getElementById('ticketRef').textContent = 'Ticket ID: #' + data.ticketId;
        sucDiv.style.display = 'block';
      } else {
        errDiv.textContent  = data.error || 'An error occurred. Please try again.';
        errDiv.style.display = 'block';
        btn.disabled        = false;
        btn.textContent     = 'Submit Support Request';
      }
    } catch {
      errDiv.textContent  = 'Network error — please check your connection and try again.';
      errDiv.style.display = 'block';
      btn.disabled        = false;
      btn.textContent     = 'Submit Support Request';
    }
  });
</script>
</body>
</html>`;
}

function _esc(str) {
    return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

module.exports = router;
