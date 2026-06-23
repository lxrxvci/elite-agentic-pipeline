#!/bin/sh
set -e

sed 's#\${SLACK_WEBHOOK_URL}#'"${SLACK_WEBHOOK_URL}"'#g' \
  < /etc/alertmanager/alertmanager.yml.template \
  > /tmp/alertmanager.yml

exec alertmanager \
  --config.file=/tmp/alertmanager.yml \
  --storage.path=/alertmanager \
  --log.level=info
