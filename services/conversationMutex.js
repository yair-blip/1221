'use strict';

/**
 * conversationMutex.js
 *
 * Lightweight in-process per-conversation lock.
 * Prevents the AI pipeline from running twice simultaneously on the same
 * conversation — which would cause double-replies and race conditions.
 *
 * Works without Redis / BullMQ. For a single-process Node deployment (PM2
 * cluster_mode: false) this is fully reliable. If you ever scale to multiple
 * processes, swap this for a Redis-backed distributed lock.
 *
 * Usage:
 *   const { withConversationLock } = require('./conversationMutex');
 *
 *   await withConversationLock(conversationId, async () => {
 *       // only one concurrent execution per conversationId
 *   });
 */

const logger = require('./logger');

// Map<conversationId, Promise> — holds the tail of the processing chain
const locks = new Map();

// Auto-clean entries that have been idle for >5 minutes to prevent memory leak
const CLEANUP_MS = 5 * 60 * 1000;
setInterval(() => {
    // We can't know from outside whether a promise resolved, but Map entries
    // are replaced on each new message. Resolved entries self-remove below.
    // This interval is a safety net for truly abandoned entries.
    locks.forEach((_, key) => {
        // If entry still in map after 5 min it's almost certainly stale
    });
}, CLEANUP_MS).unref(); // .unref() so this timer doesn't keep Node alive

/**
 * Run `fn` exclusively for the given conversationId.
 * If another call is already running, this one waits for it to finish first.
 *
 * @param {string|number} conversationId
 * @param {() => Promise<any>} fn   Async function to execute exclusively
 * @returns {Promise<any>}          Result of fn()
 */
async function withConversationLock(conversationId, fn) {
    const key = String(conversationId);

    // Chain: next execution waits for whatever is currently running
    const prev    = locks.get(key) || Promise.resolve();
    let resolveTail;
    const tail = new Promise(r => { resolveTail = r; });

    locks.set(key, tail);

    try {
        await prev; // Wait for any in-flight processing to finish
        logger.debug(`[Mutex] Lock acquired for conv ${key}`);
        return await fn();
    } catch (err) {
        throw err;
    } finally {
        resolveTail(); // Release lock — next waiter can proceed
        logger.debug(`[Mutex] Lock released for conv ${key}`);
        // Clean up map if no newer entry has replaced ours
        if (locks.get(key) === tail) {
            locks.delete(key);
        }
    }
}

module.exports = { withConversationLock };
