# SmartShelf Device Setup Guide

> **Who is this for?**
> Anyone setting up a SmartShelf device for the first time — no technical knowledge required.

---

## Before you start

Have these ready:

- The SmartShelf device (green circuit board)
- A phone, tablet, or laptop
- The **WiFi name** (SSID) and **WiFi password** for this location
- A **unique name** for this device — for example `shelf-01`, `shelf-02`  
  *(Ask your supervisor if you are not sure what name to use)*

---

## Setup steps

### Step 1 — Plug in the device

Connect the SmartShelf device to a USB power source or power bank.

Wait about **5 seconds**.

> The LED on the device will blink **orange** — this means it is in setup mode and ready to be configured.

---

### Step 2 — Connect your phone to the SmartShelf WiFi

1. Open **WiFi Settings** on your phone or tablet.
2. Look for a network that starts with **`SmartShelf-`** followed by four letters or numbers.  
   For example: `SmartShelf-A3F2`
3. Tap it to connect.

**No password is needed.**

---

### Step 3 — Open the setup page

After connecting, your phone may show a notification:  
**"Sign in to network"** or **"Open login page"** — tap it.

If no notification appears:

1. Open your browser (Safari or Chrome).
2. In the address bar, type exactly:

   ```
   192.168.4.1
   ```

3. Tap **Go**.

---

### Step 4 — Fill in the details

A setup form will appear. Fill in the following fields:

| Field | What to enter |
|---|---|
| **SSID** | The WiFi name for this location |
| **Password** | The WiFi password for this location |
| **Device ID** | A unique name for this device (e.g. `shelf-01`) |

> **Leave all other fields as they are** unless your supervisor has told you to change them.

---

### Step 5 — Tap "Save & Connect"

Scroll to the bottom of the form and tap the blue **"Save & Connect"** button.

The device will save the settings and **restart automatically**. This takes about 10 seconds.

---

### Step 6 — Done!

Once the device restarts, it joins the location WiFi. The orange blinking light will stop.

You can now reconnect your phone to the normal WiFi and move on to the next device.

---

## LED indicator light

| Light | Meaning |
|---|---|
| Blinking **orange** | Device is in setup mode, waiting to be configured |
| Brief solid **white** (startup flash) | Device is booting normally |
| **No light** | Device is working normally and connected to WiFi |

---

## Something went wrong?

### Reset and try again

1. Find the button labelled **BOOT** (or **IO0**) on the circuit board.
2. Hold it down for **5 seconds**.
3. The LED will flash red, then the device restarts in setup mode.
4. Go back to **Step 2** and try again.

### Common problems

| Problem | What to do |
|---|---|
| Can't find `SmartShelf-XXXX` WiFi | Make sure the device is plugged in and the LED is blinking orange. Try moving closer to the device. |
| Setup page doesn't open | Open your browser and type `192.168.4.1` manually. |
| Device doesn't join store WiFi after saving | Double-check the WiFi name and password — they are case-sensitive. Reset the device and try again. |
| Orange light keeps blinking after setup | The device could not connect to the WiFi. Reset and re-enter the credentials. |

---

## Re-provisioning (changing WiFi credentials later)

If the store WiFi changes or you need to move the device to a different location:

1. Hold the **BOOT** button for **5 seconds** while the device is running normally.
2. The device will clear its saved WiFi and restart in setup mode (orange blink).
3. Follow the setup steps above from Step 2.

---

## Quick reference card

```
┌─────────────────────────────────────────────────────┐
│            SmartShelf Device Setup                  │
│                                                     │
│  1. Plug in → wait for orange blink                 │
│  2. Connect phone to WiFi: SmartShelf-XXXX          │
│  3. Open browser → 192.168.4.1                      │
│  4. Enter WiFi name, password, device ID            │
│  5. Tap Save & Connect                              │
│  6. Done — orange blink stops                       │
│                                                     │
│  RESET: Hold BOOT button 5 seconds                  │
└─────────────────────────────────────────────────────┘
```
