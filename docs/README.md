---
layout: home
permalink: index.html

# Please update this with your repository name and project title
repository-name: eYY-3yp-project-template
title: Project Template
---

[comment]: # "This is the standard layout for the project, but you can clean this and use your own template"

# HYDRA: HYbrid Dynamic Realtime Automation

---

## Team
-  e21196, Diwyanjali Jayasooriya, [e21196@eng.pdn.ac.lk](mailto:e21196@eng.pdn.ac.lk)
-  e21289, Samadhini Perera, [e21289@eng.pdn.ac.lk](mailto:e21289@eng.pdn.ac.lk)
-  e21193, Vedangi Nadeeshani, [e21193@eng.pdn.ac.lk](mailto:e21193@eng.pdn.ac.lk)

<!-- Image (photo/drawing of the final hardware) should be here -->

<!-- This is a sample image, to show how to add images to your page. To learn more options, please refer [this](https://projects.ce.pdn.ac.lk/docs/faq/how-to-add-an-image/) -->

<!-- ![Sample Image](./images/sample.png) -->

#### Table of Contents
1. [Introduction](#introduction)
2. [Solution Architecture](#solution-architecture )
3. [Hardware & Software Designs](#hardware-and-software-designs)
4. [Testing](#testing)
5. [Detailed budget](#detailed-budget)
6. [Conclusion](#conclusion)
7. [Links](#links)

---

## Introduction

Urban congestion is one of the defining challenges of modern cities. Traditional traffic control systems rely on **static, fixed-timer logic** that is blind to real-world conditions. A traffic light stays red even when the road is empty, while kilometers of cars sit idling on the cross-street. This inefficiency leads to billions of dollars in wasted fuel, increased carbon emissions, and severe delays.

**HYDRA (HYbrid Dynamic Realtime Automation)** is an intelligent traffic management system that replaces static timers with dynamic, sensor-driven logic. It integrates **Heavy Vehicle Detection** (to extend green times for trucks) and **Rain Sensors** (to increase safety margins), creating a responsive, organic traffic flow.

---

## Solution Architecture

High level diagram 

HYDRA follows a **Centralized-Edge Topology**:
* **The Physical Layer:** A dual-intersection kinetic model using **Gravity-Fed Servo Barriers** to physically drive toy cars automatically when the light turns Green.
* **The Edge Layer:** **ESP32 Microcontrollers** at each intersection handle real-time sensing (IR, Ultrasonic, Piezo, Rain).
* **The Cloud Layer:** A **Raspberry Pi (MQTT Broker)** acts as the central brain, running the "Green Wave" algorithm.

---

## Hardware and Software Designs

### Hardware Components
* **Raspberry Pi 4:** Central Server & MQTT Broker.
* **ESP32 Dev Kit v1:** Edge computing nodes.
* **Sensors:** HC-SR04 (Ultrasonic), IR Break-Beam, Piezo Vibration, Rain Sensor.
* **Actuators:** SG90 Servo Motors (Barrier Mechanism), Traffic LEDs.

### Software Components
* **Firmware:** C++ (Arduino) for ESP32.
* **Backend:** Python script for "Green Wave" logic ($T = D/V$) and heavy vehicle compensation.
* **Protocol:** MQTT (Message Queuing Telemetry Transport) over WiFi.

---

## Testing

We validated the system through three core scenarios:
1.  **Green Wave:** A platoon released from Intersection A arrived at B exactly as the light turned Green.
2.  **Heavy Vehicle Override:** Dropping a weighted model car over the Piezo sensor successfully triggered an extended Green time.
3.  **Safety Mode:** Spraying water on the rain sensor successfully increased the Yellow Light duration.

---

## Detailed budget

All items and costs

| Item | Quantity | Unit Cost | Total |
| :--- | :---: | :---: | ---: |
| **Raspberry Pi 4 Model B** (Central Brain & MQTT Broker) | 1 | 24,000 LKR | 24,000 LKR |
| **SD Card 32GB** (Required for OS) | 1 | 1,500 LKR | 1,500 LKR |
| **ESP32 DevKit V1** (Edge Nodes - N, S, E, W) | 4 | 1,450 LKR | 5,800 LKR |
| **LEDs 5mm** (4 Red, 4 Yellow, 4 Green) | 12 | 10 LKR | 120 LKR |
| **Resistors 220Ω** (LED Protection) | 12 | 5 LKR | 60 LKR |
| **Project Boxes - Small** (Housing for LEDs) | 4 | 250 LKR | 1,000 LKR |
| **PVC Pipes / Dowels 2ft** (Signal Poles) | 4 | 150 LKR | 600 LKR |
| **Ultrasonic Sensor HC-SR04** (Vehicle Detection) | 4 | 350 LKR | 1,400 LKR |
| **IR Break Beam Sensors** (Queue Length Detection) | 16 | 150 LKR | 2,400 LKR |
| **Piezo Vibration Sensor** (Heavy Vehicle Detection) | 4 | 200 LKR | 800 LKR |
| **Rain Sensor Module** (Weather Detection) | 4 | 250 LKR | 1,000 LKR |
| **Capacitive Touch TTP223** (Pedestrian Button) | 4 | 100 LKR | 400 LKR |
| **5V 5A Power Adapter** (Centralized Power) | 1 | 2,500 LKR | 2,500 LKR |
| **Power Distribution Board/Rails** | 1 | 500 LKR | 500 LKR |
| **Portable WiFi Router** (Dedicated MQTT Network) | 1 | 4,500 LKR | 4,500 LKR |
| **Plywood Board 4ft x 3ft** (Structure Base) | 1 | 1,500 LKR | 1,500 LKR |
| **Control Boxes - Base** (Enclosures for ESP32s) | 4 | 350 LKR | 1,400 LKR |
| **Wires & Consumables** (Jumper wires, solder, tape) | 1 | 2,000 LKR | 2,000 LKR |
| **TOTAL ESTIMATED BUDGET** | **-** | **-** | **49,980 LKR** |

## Conclusion

HYDRA demonstrates how **adaptive algorithms and IoT connectivity** can solve the persistent problem of traffic congestion. By prioritizing **real-time responsiveness and emergency transit**, HYDRA not only improves daily commute efficiency but also saves lives—making our roads **safer, smarter, and more efficient**.
## Links

- [Project Repository](https://github.com/cepdnaclk/e21-3yp-smart-traffic-control-system){:target="_blank"}
- [Project Page](https://cepdnaclk.github.io/e21-3yp-smart-traffic-control-system){:target="_blank"}
- [Department of Computer Engineering](http://www.ce.pdn.ac.lk/)
- [University of Peradeniya](https://eng.pdn.ac.lk/)

[//]: # (Please refer this to learn more about Markdown syntax)
[//]: # (https://github.com/adam-p/markdown-here/wiki/Markdown-Cheatsheet)
