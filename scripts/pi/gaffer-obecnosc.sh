#!/usr/bin/env bash
# Sprawdza, czy telefon jest w domowym Wi-Fi, i włącza / wyłącza Gaffera.
# Odpalany co minutę przez gaffer-obecnosc.timer (systemd --user). Bez roota:
# ping + tablica sąsiadów ARP (telefon odpowiada na ARP nawet uśpiony).
#
# Konfiguracja: ~/.config/gaffer/obecnosc.env
#   PHONE_MAC=aa:bb:cc:dd:ee:ff   # „Prywatny adres Wi-Fi" z iPhone'a (ustaw „Stały")
#   ABSENT_MINUTES=10             # ile minut bez telefonu, zanim wyłączy
#
#   gaffer-obecnosc.sh            jedno sprawdzenie (tak woła timer)
#   gaffer-obecnosc.sh status     co widzi teraz
#   gaffer-obecnosc.sh urzadzenia lista urządzeń w sieci (żeby znaleźć telefon)
set -u
CONF="${XDG_CONFIG_HOME:-$HOME/.config}/gaffer/obecnosc.env"
[ -f "$CONF" ] && . "$CONF"
PHONE_MAC="$(echo "${PHONE_MAC:-}" | tr 'A-F' 'a-f')"
ABSENT_MINUTES="${ABSENT_MINUTES:-10}"
SERVICE=gaffer-web.service
STATE="${XDG_RUNTIME_DIR:-/tmp}/gaffer-obecnosc"
IFACE="$(ip route show default | awk '{print $5; exit}')"
SUBNET="$(ip -4 -o addr show "$IFACE" | awk '{print $4; exit}')"   # np. 192.168.1.79/24
BASE="${SUBNET%.*}"

sweep() {   # ~3 s: pinguje całą /24, żeby odświeżyć tablicę ARP
  seq 1 254 | xargs -P 64 -I{} ping -c1 -W1 "$BASE.{}" >/dev/null 2>&1
}

phone_ip() { ip neigh show dev "$IFACE" | awk -v m="$PHONE_MAC" '$3==m {print $1; exit}'; }

present() {
  local ip st
  ip="$(phone_ip)"
  [ -z "$ip" ] && { sweep; ip="$(phone_ip)"; }
  [ -z "$ip" ] && return 1
  ping -c2 -W1 "$ip" >/dev/null 2>&1 && return 0
  # iPhone często ignoruje ping, ale odpowiada na ARP: po DELAY (5 s) jądro
  # sonduje ARP (3 s) i wpis kończy jako REACHABLE albo FAILED.
  sleep 9
  st="$(ip neigh show "$ip" dev "$IFACE" | awk '{print $NF}')"
  [ "$st" = REACHABLE ]
}

case "${1:-check}" in
  urzadzenia)
    sweep
    ip neigh show dev "$IFACE" | awk '$3 ~ /:/ && $NF != "FAILED" {print $1, $3, $NF}' | sort -t. -k4 -n
    echo "Telefon: Ustawienia → Wi-Fi → (i) przy sieci → „Prywatny adres Wi-Fi” (ustaw „Stały”)."
    exit 0 ;;
  status)
    [ -z "$PHONE_MAC" ] && { echo "Brak PHONE_MAC w $CONF"; exit 1; }
    if present; then echo "telefon: W DOMU ($(phone_ip))"; else echo "telefon: poza domem"; fi
    echo "aplikacja: $(systemctl --user is-active $SERVICE)"
    exit 0 ;;
esac

[ -z "$PHONE_MAC" ] && { echo "gaffer-obecnosc: ustaw PHONE_MAC w $CONF" >&2; exit 0; }

if present; then
  echo 0 > "$STATE"
  systemctl --user is-active -q $SERVICE || { systemctl --user start $SERVICE; echo "telefon w domu → start"; }
else
  n=$(( $(cat "$STATE" 2>/dev/null || echo 0) + 1 ))
  echo "$n" > "$STATE"
  if [ "$n" -ge "$ABSENT_MINUTES" ] && systemctl --user is-active -q $SERVICE; then
    systemctl --user stop $SERVICE
    echo "telefonu brak od $n min → stop"
  fi
fi
