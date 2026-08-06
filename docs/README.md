# HYDRA: HYbrid Dynamic Real-time Traffic Automation

---

## Team
-  e21196, Diwyanjali Jayasooriya, [e21196@eng.pdn.ac.lk](mailto:e21196@eng.pdn.ac.lk)
-  e21289, Samadhini Perera, [e21289@eng.pdn.ac.lk](mailto:e21289@eng.pdn.ac.lk)
-  e21193, Vedangi Nadeeshani, [e21193@eng.pdn.ac.lk](mailto:e21193@eng.pdn.ac.lk)

#### Table of Contents
1. [Introduction](#introduction)
2. [Solution Architecture](#solution-architecture)
3. [Hardware & Software Designs](#hardware-and-software-designs)
4. [Key Functionalities & Failsafe](#key-functionalities--failsafe)
5. [Detailed Budget](#detailed-budget)
6. [Conclusion](#conclusion)
7. [Links](#links)

---

## Introduction

Urban congestion is one of the defining challenges of modern cities. Current traffic management infrastructure in Sri Lanka relies almost exclusively on **static, fixed-cycle traffic signals** that operate on predetermined time intervals regardless of actual traffic conditions. This contributes to an estimated **Rs. 70 billion in annual economic losses**. 

**HYDRA (HYbrid Dynamic Real-time Automation)** replaces conventional fixed-cycle traffic signals with a real-time, sensor-driven control system. By combining embedded hardware at the intersection edge with cloud-based intelligence hosted on AWS EC2, HYDRA dynamically adapts signal timing to actual road conditions—incorporating vehicle density, weather-aware extensions, and pedestrian demand.

---

## Solution Architecture

HYDRA is built on a **three-layer cloud-edge architecture**. Each layer has a clearly defined responsibility, and communication between layers is standardized through MQTT and HTTP/WebSocket protocols.

* **The Edge Layer (Hardware Sensing):** **ESP32 Microcontrollers** at each intersection handle continuous real-time sensing (Ultrasonic, Rain, Capacitive Touch). They package readings into JSON and publish to MQTT via Wi-Fi.
* **The Cloud Layer (Intelligence):** Hosted on an **AWS EC2 instance**, a Node.js backend processes sensor data, queries the Google Maps Traffic API for macro-level congestion, calculates optimal green times, logs events to **MongoDB**, and dispatches MQTT commands via a Mosquitto broker.
* **The Client Layer (Dashboard):** A live **React web dashboard** polls the AWS backend to provide operators with real-time visual updates of signal states, sensor readings, and manual overrides.

---

## Hardware and Software Designs

### Hardware Components
* **Edge Compute Nodes:** ESP32 DevKit V1.
* **Sensors:** HC-SR04 (Ultrasonic for queue length), Rain Sensor Module (Weather detection), TTP223 Capacitive Touch (Pedestrian requests).
* **Actuators & Displays:** LED Traffic Light Modules, 7-Segment Displays (Countdown timers).

### Software Components
* **Firmware:** C++ (Arduino) for ESP32.
* **Backend:** Node.js + Express.
* **Database:** MongoDB for persistent storage of sensor data and traffic events.
* **Protocol:** MQTT (Mosquitto) for lightweight pub/sub messaging.
* **External API:** Google Maps Traffic API for congestion enrichment.
* **Frontend:** React.js.

---

## Key Functionalities & Failsafe

HYDRA validates adaptive traffic control through the following core features:

1. **Dynamic Green Time Calculation:** The base green time is dynamically extended based on local queue lengths (detected by dual ultrasonic sensors) and macro-level intersection congestion scores (via Google Maps Traffic API).
2. **Weather-Aware Signal Timing:** When the rain sensor detects wet road conditions, the yellow light duration is automatically extended by a factor of **1.5x** to accommodate for 70% longer braking distances.
3. **Pedestrian Sync:** Capacitive touch buttons queue pedestrian crossing requests. During a RED phase, the request is acknowledged instantly. During a GREEN phase, it is queued and factored into the next available cycle.
4. **Multi-Intersection Green Wave:** For deployments spanning multiple intersections, the cloud backend syncs upstream and downstream timing so vehicles traveling at the speed limit encounter consecutive green lights.
5. **Fail-Safe Local Cycle:** To ensure rigorous resilience, the ESP32 firmware utilizes a watchdog timer to monitor Wi-Fi connectivity. If connection to the AWS cloud is lost, the intersection automatically reverts to a fixed local safety cycle (**3s RED → 3s GREEN → 3s YELLOW**) to prevent junction failure.

---

## Detailed Budget

Hardware budget sized for a full four-road intersection deployment. *(Note: Cloud infrastructure costs for AWS and Google Maps API are handled under a separate cloud budget).*

| Item | Qty | Unit Cost (LKR) | Total (LKR) |
| :--- | :---: | :---: | ---: |
| **ESP32 DevKit V1 (N, S, E, W)** | 4 | 1,650 | 6,600 |
| **LED Traffic Light Module** | 8 | 150 | 1,200 |
| **Rain Sensor Module** | 1 | 250 | 250 |
| **Ultrasonic Sensor HC-SR04** | 8 | 200 | 1,600 |
| **Seven Segment Display** | 4 | 80 | 320 |
| **Capacitive Touch TTP223** | 4 | 100 | 400 |
| **Bread Boards** | 6 | 150 | 900 |
| **3D Printed Enclosures** | - | - | 16,000 |
| **Others (wiring, connectors, misc.)** | - | - | 2,230 |
| **TOTAL BUDGET** | | | **29,500 LKR** |

---

## Conclusion

HYDRA demonstrates how **adaptive algorithms and IoT cloud-edge connectivity** can solve the persistent problem of urban traffic congestion. By prioritizing real-time responsiveness based on actual vehicle density, weather conditions, and pedestrian demand, HYDRA eliminates the fundamental inefficiency of fixed-cycle traffic lights—making our roads safer, smarter, and highly efficient.

## Links

- [Project Repository](https://github.com/cepdnaclk/e21-3yp-HYDRA)
- [Project Page](https://cepdnaclk.github.io/e21-3yp-HYDRA)
- [Department of Computer Engineering](http://www.ce.pdn.ac.lk/)
- [University of Peradeniya](https://eng.pdn.ac.lk/)