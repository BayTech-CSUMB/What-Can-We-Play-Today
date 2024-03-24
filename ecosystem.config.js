module.exports = {
  apps : [{
    name   : "WhatCanWePlay.Today",
    script : "./index.js",
    env: {
      ENVIRO: "prod",
      NODE_ENV: "production"
    },
  }]
}
