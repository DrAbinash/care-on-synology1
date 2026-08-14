# Emergency LAN (CARE-EMERGENCY)

This document is **configuration guidance only**. Do not run scripts that change the current DS225+ or DS1522+ network automatically.

## Goal

Reception PCs can reach Emergency Billing when the **main clinic LAN and internet are dead**.

```text
Reception PC 1 ──┐
Reception PC 2 ──┤  Emergency router/switch ── DS225+  192.168.50.10
Receipt printer ─┘         192.168.50.1
```

## Suggested addresses (example only)

| Device | Address |
| --- | --- |
| Emergency router LAN | 192.168.50.1 |
| DS225+ on that LAN | 192.168.50.10 (static) |
| Reception | DHCP 192.168.50.x |
| Wi‑Fi SSID | `CARE-EMERGENCY` |

Pick a subnet that does **not** collide with the clinic LAN. If 192.168.50.0/24 is already in use, choose another (e.g. 192.168.60.0/24) and print the URL on the SOP.

## Safe NAS setup (manual in DSM)

1. Add a **second** NIC / VLAN / USB Ethernet **or** a dedicated SSID on a travel router whose LAN port is plugged only into DS225+ and reception.
2. Give DS225+ a **static** IP on that interface. Do not replace the existing DSM LAN used for Hyper Backup / DS1522+ replication.
3. Firewall: allow TCP 80 (Emergency web) from the emergency subnet. Do **not** expose PostgreSQL (`5410`) beyond loopback.
4. Leave Hyper Backup, Snapshot Replication, and the DS1522+ backup destination on the **existing** interfaces and shares.

## Reception procedure

1. Disconnect or ignore the dead clinic Wi‑Fi.
2. Join `CARE-EMERGENCY`.
3. Open `http://192.168.50.10` (bookmark).
4. When CARE returns, leave this SSID and return to the clinic LAN.

## What this network must work without

Internet, main clinic LAN, PACS, Orthanc, WhatsApp, cloud DNS. Local HTTP to the NAS is enough.

## Rollback

Unplug the travel router. DS225+ continues its normal DSM LAN and backup jobs unchanged.
