module.exports = {
  apps: [
    {
      name: "axon-api",
      script: "./backend/pm2-start.sh",
      interpreter: "/bin/bash",
      cwd: process.env.PWD || __dirname + "/..",
      env: {
        // Put non-secret defaults here or rely on .env loaded by pm2-start.sh
        PORT: process.env.PORT || "8002",
        WORKERS: process.env.WORKERS || "2",
      },
      autorestart: true,
      max_restarts: 10,
      time: true,
      // watch: false, // enable only for dev
    },
  ],
};
