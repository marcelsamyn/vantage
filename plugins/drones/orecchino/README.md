# Orecchino receiver for VANTAGE

This folder builds firmware for an always-on drone Remote ID receiver. It runs [Orecchino](https://github.com/isaacbentley/orecchino-esp32)'s receiver core on a Seeed XIAO ESP32-S3, joins your home Wi-Fi, and serves what it hears at:

- `http://orecchino.local/data/remoteid.json`: the [dump3411 schema-v1 feed](https://github.com/ifnull/dump3411/blob/main/FEED.md). VANTAGE reads this URL when `VANTAGE_DRONE_RECEIVER_URL` is not set.
- `http://orecchino.local/status`: uptime, messages per transport, the router channel, and Wi-Fi frames heard on channels 1, 6 and 11.

The board hears Remote ID over Wi-Fi beacons, Wi-Fi NAN, Bluetooth 4 and Bluetooth 5 long range. The same JSON lines that Orecchino's desktop and phone apps read also go out over USB and Bluetooth LE.

## Build and flash

You need `arduino-cli`. The script installs the ESP32 core and NimBLE versions that Orecchino's CI uses.

1. Copy `orecchino_http/wifi_secrets.example.h` to `orecchino_http/wifi_secrets.h` and fill in your network. Git ignores this file. The ESP32 can join only a 2.4 GHz network.
2. Connect the board over USB, then run:

   ```bash
   plugins/drones/orecchino/flash.sh --port /dev/cu.usbmodem101
   ```

   The script fetches the pinned Orecchino commit into `.cache/orecchino/` and applies `rx-hook-decoded.patch`. The patch adds one hook that gives this sketch each decoded message. Then the script builds and flashes. Leave out `--port` to build only.
3. Power the board anywhere on your network. After about 10 seconds, `curl http://orecchino.local/status` answers.

The feed answers HTTP 503 `clock_not_set` until the board has reached a time server. VANTAGE dates every report from the board's clock.

## Wi-Fi reception while joined to your router

The ESP32 has one Wi-Fi radio. While it is joined to your router, it stays on the router's 2.4 GHz channel. To keep hearing Wi-Fi Remote ID on other channels, the board makes short passive scans of channels 6, 1 and 11, using Orecchino's dwell times (600 ms on channel 6, 200 ms on 1 and 11). Between scans it spends at least 400 ms on the router's channel, so the feed keeps answering. Bluetooth reception does not change.

Wi-Fi NAN Remote ID is always on channel 6, and most beacon Remote ID is on channel 6 too. If your router's 2.4 GHz band uses a fixed channel 6, the board spends the most time where most drones broadcast. `/status` shows the router channel (`network.channel`) and the frames heard on each channel.

## Licence

Orecchino is GPL-3.0-or-later. The sketch and patch in this folder are derived from it and use the same licence.
