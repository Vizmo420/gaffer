#!/usr/bin/env bash
# Instaluje autostart Gaffera na Pi (systemd --user, bez roota).
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
UNITS="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
CONF="${XDG_CONFIG_HOME:-$HOME/.config}/gaffer"
mkdir -p "$UNITS" "$CONF"
cp "$HERE"/gaffer-web.service "$HERE"/gaffer-obecnosc.service "$HERE"/gaffer-obecnosc.timer "$HERE"/gaffer-notify.service "$HERE"/gaffer-notify.timer "$UNITS"/
[ -f "$CONF/obecnosc.env" ] || printf 'PHONE_MAC=\nABSENT_MINUTES=10\n' > "$CONF/obecnosc.env"
[ -f "$CONF/ai.env" ] || { printf '%s\n' \
  '# Doradca AI przez lokalny OmniRoute (OpenAI-compatible). Uzupełnij sam.' \
  'AI_GATEWAY_URL=http://127.0.0.1:20128/v1' \
  'AI_GATEWAY_KEY=' \
  'AI_GATEWAY_MODEL=gemini/gemini-2.5-flash' > "$CONF/ai.env"; chmod 600 "$CONF/ai.env"; }
[ -f "$CONF/ntfy.env" ] || { ( umask 077; printf 'NTFY_SERVER=https://ntfy.sh\nNTFY_TOPIC=gaffer-%s\nGAFFER_URL=http://%s:5173/v2/\n' "$(head -c 12 /dev/urandom | base32 | tr -d '=' | tr 'A-Z' 'a-z')" "$(hostname -I | awk '{print $1}')" > "$CONF/ntfy.env" ); }
systemctl --user daemon-reload
systemctl --user enable --now gaffer-obecnosc.timer gaffer-notify.timer
echo "Gotowe. Uzupełnij PHONE_MAC w $CONF/obecnosc.env (pomoc: $HERE/gaffer-obecnosc.sh urzadzenia)"
echo "oraz AI_GATEWAY_KEY w $CONF/ai.env, potem: systemctl --user restart gaffer-web"
