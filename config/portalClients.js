/**
 * portalClients.js
 * ────────────────────────────────────────────────────────────────────────────
 * Configuration-only file for Enterprise Portals (Group B — custom client pages).
 *
 * HOW TO ADD A NEW CLIENT:
 *   1. Add an entry to the CLIENTS object below.
 *   2. Place the client's logo at: public/portals/logos/<slug>.png
 *   3. Restart the server.  That's it — no other code changes needed.
 *
 * The portal will be accessible at: https://yourdomain.com/portal/<slug>
 *
 * Each conversation opened via the portal will have the selected branch
 * automatically set as a Custom Attribute in Chatwoot so agents can see it.
 * ────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const CLIENTS = {

    // ── Example: Acme Corporation ─────────────────────────────────────────
    'acme': {
        name:          'Acme Corporation',          // Display name in portal header
        slug:          'acme',                      // Must match the key above (URL slug)
        logoFile:      'acme.png',                  // File in public/portals/logos/
        primaryColor:  '#0057A8',                   // Hex colour for header/button
        chatwootInboxId: process.env.CHATWOOT_SUPPORT_INBOX_ID, // which inbox to open tickets in
        welcomeText:   'Welcome to Acme Corporation Technical Support',
        branches: [
            'Headquarters — Tel Aviv',
            'Northern Branch — Haifa',
            'Southern Branch — Beer Sheva',
            'Eilat Office',
        ],
    },

    // ── Example: Beta Tech ────────────────────────────────────────────────
    'beta-tech': {
        name:          'Beta Tech Ltd',
        slug:          'beta-tech',
        logoFile:      'beta-tech.png',
        primaryColor:  '#2E7D32',
        chatwootInboxId: process.env.CHATWOOT_SUPPORT_INBOX_ID,
        welcomeText:   'Beta Tech — IT Support Portal',
        branches: [
            'Main Office — Jerusalem',
            'R&D Center — Herzliya',
            'Remote Workers',
        ],
    },

    // ── Add more clients below following the same pattern ─────────────────
    // 'client-slug': {
    //     name:          'Client Name',
    //     slug:          'client-slug',
    //     logoFile:      'client-slug.png',
    //     primaryColor:  '#HEXCOLOR',
    //     chatwootInboxId: process.env.CHATWOOT_SUPPORT_INBOX_ID,
    //     welcomeText:   'Welcome message shown on portal',
    //     branches: ['Branch A', 'Branch B'],
    // },
};

module.exports = CLIENTS;
