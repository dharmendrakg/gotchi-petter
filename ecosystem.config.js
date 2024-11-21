// configuration for running in production with PM2
module.exports = {
  apps: [{
    name: "gotchi-petter",
    script: "./app.js",
    restart_delay: 900000, // 15 minutes
    max_restarts: 5,       // Prevent infinite restarts if there's a critical issue
    env: {
      NODE_ENV: "production"
    },
    log_date_format: "YYYY-MM-DD HH:mm:ss Z", // Standardized timestamp format
    exp_backoff_restart_delay: 100 // Gradually increase delay between restarts if failing
  }]
}
