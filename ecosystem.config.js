module.exports = {
  apps: [
    {
      name:             'bar-tech-ai',
      script:           'index.js',
      instances:        1,          // Keep at 1 — SQLite doesn't support multi-process writes
      exec_mode:        'fork',
      watch:            false,
      max_memory_restart: '512M',

      // Restart policy
      restart_delay:    5000,       // Wait 5s before restarting on crash
      max_restarts:     10,
      min_uptime:       '30s',

      // Logging
      out_file:         './logs/pm2-out.log',
      error_file:       './logs/pm2-error.log',
      merge_logs:       true,
      log_date_format:  'YYYY-MM-DD HH:mm:ss',

      // Environment
      env: {
        NODE_ENV: 'production',
        PORT:     3000,
      },
    },
  ],
};
