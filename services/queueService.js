'use strict';
const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');
const logger = require('./logger');

const redisConnection = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', { maxRetriesPerRequest: null });
const messageQueue = new Queue('messageQueue', { connection: redisConnection });

async function addJob(payload) {
    await messageQueue.add('process_webhook', payload, { removeOnComplete: true });
}

function initWorker(processFn) {
    new Worker('messageQueue', async (job) => {
        try { await processFn(job.data); } catch (err) { logger.error(`[Queue] Job ${job.id} failed`, { error: err.message }); }
    }, { connection: redisConnection, concurrency: 1 });
}

module.exports = { addJob, initWorker };
