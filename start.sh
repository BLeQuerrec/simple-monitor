#!/bin/bash
set -eo pipefail

if [[ ! -L "$PWD/assets/css/bootstrap.css" ]]; then
	ln -s "$PWD/node_modules/bootstrap/dist/css/bootstrap.min.css" "$PWD/assets/css/bootstrap.css"
fi

if [[ "$NODE_ENV" == "production" ]]; then
	forever --spinSleepTime=10000 --minUptime=10000 start app.js
else
	node ./app.js
fi
