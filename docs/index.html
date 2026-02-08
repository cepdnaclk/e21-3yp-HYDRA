---
layout: home
permalink: index.html

repository-name: e21-3yp-smart-traffic-control-system
title: "HYDRA: HYbrid Dynamic Realtime Automation"
---

# HYDRA: HYbrid Dynamic Realtime Automation

---

## Team
- e21289, Samadhini Perera, [e21289@eng.pdn.ac.lk](mailto:e21289@eng.pdn.ac.lk)
- e21196, Diwyanjali Jayasooriya, [e21196@eng.pdn.ac.lk](mailto:e21196@eng.pdn.ac.lk)
- e21193, Vedangi Nadeeshani, [e21193@eng.pdn.ac.lk](mailto:e21193@eng.pdn.ac.lk)

---

#### Table of Contents
1. [Introduction](#introduction)
2. [Solution Architecture](#solution-architecture)
3. [Hardware & Software Designs](#hardware--software-designs)
4. [Testing](#testing)
5. [Detailed Budget](#detailed-budget)
6. [Commercialization Plans](#commercialization-plans)
7. [Conclusion](#conclusion)
8. [Links](#links)

---

## Introduction

### The Real-World Problem

Urban congestion is one of the defining challenges of modern cities. Traditional traffic control systems rely on **static, fixed-timer logic** that is blind to real-world conditions. A traffic light stays red even when the road is empty, while kilometers of cars sit idling on the cross-street. This inefficiency leads to billions of dollars in wasted fuel, increased carbon emissions, and severe delays for emergency services.

Furthermore, standard systems fail to account for **environmental factors** and **vehicle classification**. Heavy vehicles take longer to accelerate, and wet roads increase braking distances, yet traffic lights treat every vehicle and every weather condition exactly the same. This "one-size-fits-all" approach compromises both road efficiency and public safety.

---

## The Solution

**HYDRA (HYbrid Dynamic Realtime Automation)** is an intelligent, adaptive traffic management system designed to replace static timers with **dynamic, sensor-driven logic**.

HYDRA transforms isolated intersections into a **connected neural network**. By utilizing a "Green Wave" algorithm, it coordinates multiple intersections to allow platoons of vehicles to pass through without stopping. The system uniquely integrates **heavy vehicle detection** to extend green times for trucks and **rain sensors** to increase yellow light safety margins during bad weather.

For the prototype demonstration, HYDRA implements a **fully automated kinetic model**. Unlike standard static models, our system uses a **gravity-fed servo-barrier mechanism** to physically drive vehicle queues automatically when the light turns green, providing a realistic simulation of traffic flow dynamics.

---

## Solution Architecture

### High-Level Overview

HYDRA follows a **Centralized-Edge Topology** to ensure synchronized decision-making:

- **The Physical Layer (Kinetic Model)**
  - Dual-intersection road network with 4 paths each.
  - **Gravity-Assist Drive:** Sloped roads utilize physics to move vehicles.
  - **Servo-Actuated Barriers:** Automatically release vehicle queues when Green signal is active.

- **Edge Node Layer (The Limbs)**
  - **ESP32 Microcontrollers** at each intersection.
  - localized sensor processing (IR, Ultrasonic, Piezo, Rain).
  - Real-time actuation of Traffic LEDs and Servo Barriers.

- **Central Intelligence Layer (The Brain)**
  - **Raspberry Pi / MQTT Broker** acting as the central coordinator.
  - Runs the **"Green Wave" Algorithm** to calculate travel time between nodes.
  - Orchestrates signal timing updates based on total network load.

---

## Hardware & Software Designs

### Hardware Components

| Component | Description |
|--------|------------|
| Raspberry Pi 4 | Central MQTT Broker & Coordination Server |
| ESP32 Dev Kit v1 (x2) | Edge Nodes for Intersection A & B |
| Ultrasonic Sensors (HC-SR04) | Incoming vehicle detection |
| IR Break-Beam Array | Exact queue length counting |
| Piezo Vibration Sensors | Heavy vehicle (Truck/Bus) classification |
| Rain Sensor Module | Environmental monitoring for safety overrides |
| SG90 / MG996R Servos | **Automated Traffic Barrier Mechanism** |
| Traffic Light LED Modules | Visual signaling |
| L298N / Ext Power Module | Power distribution for kinetic mechanisms |

---

### Software Components

- **Edge Firmware (C++)**
  - Runs on ESP32.
  - Interrupt-based sensor reading for zero-latency detection.
  - Servo control logic synchronized with State Machine.

- **Central Logic (Python)**
  - Impact-weighted traffic algorithm.
  - **Green Wave Calculator:** `T_arrival = T_start + Distance/AvgSpeed`.
  - MQTT Client for bi-directional communication.

- **Communication Protocols**
  - **MQTT (Message Queuing Telemetry Transport):** Lightweight protocol for machine-to-machine communication over WiFi.
  - JSON payloads for sensor data transmission.

---

## Testing

### Functionality Testing
- **The "Green Wave" Test:** Verifying that a platoon released from Intersection A arrives at Intersection B exactly as the light turns Green.
- **Heavy Vehicle Override:** Dropping a weighted model car over the Piezo sensor to trigger extended Green time.
- **Safety Mode:** Spraying water on the Rain Sensor to verify the automatic increase in Yellow Light duration (Stopping Distance Compensation).
- **Kinetic Mechanism:** Ensuring Servo Barriers hold traffic at Red and release smoothly at Green without jamming.

---

## Detailed Budget

| Item | Status | Cost (Rs.) |
|------|--------|-----------|
| Raspberry Pi 4 | Available | 26,000 |
| ESP32 Dev Module (x2) | - | 2,600 |
| SG90 Servo Motors (x4) | - | 1,800 |
| Ultrasonic Sensors (x4) | - | 1,200 |
| IR Break Beam Sensors (x8) | - | 2,400 |
| Piezo Vibration Sensors (x2) | - | 600 |
| Rain Sensor Module | - | 350 |
| Plywood/MDF for Model Base | - | 3,500 |
| Model Cars (Die-cast) | - | 2,500 |
| Power Supply (5V 2A) | - | 1,500 |
| Wires, Breadboards, PCBs | - | 2,000 |
| **Total Estimated Cost** | | **44,450** |
| **Excluding Available Items** | | **18,450** |

---

## Commercialization Plans

- **Smart City Infrastructure**
  - Licensing the "Green Wave" algorithm to municipal councils.

- **Industrial Logistics**
  - Private traffic management for large ports and factories where heavy vehicles dominate.

- **Emergency Response Integration**
  - A premium module allowing ambulances to trigger a "Flush Mode" via RF signals.

- **Educational STEM Kits**
  - Selling the "Gravity & Servo" model design as a kit for schools to teach logic and physics.

---

## Conclusion

HYDRA proves that traffic control does not need to be expensive or complex to be smart. By combining **simple physics** for the model with **sophisticated logic** for the controller, we have demonstrated a scalable solution to urban congestion. The integration of environmental awareness and vehicle classification marks a significant step forward from the "blind" timers of the past to the **responsive, organic traffic flow** of the future.

---

## Links

- [Project Repository](https://github.com/cepdnaclk/{{ page.repository-name }}){:target="_blank"}
- [Project Page](https://cepdnaclk.github.io/{{ page.repository-name}}){:target="_blank"}
- [Department of Computer Engineering](http://www.ce.pdn.ac.lk/)
- [University of Peradeniya](https://eng.pdn.ac.lk/)