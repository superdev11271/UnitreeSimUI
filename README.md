# Unitree B2 Simulator UI

Desktop UI for the Unitree B2 Gazebo simulation, built with Electron and [roslib](https://github.com/RobotWebTools/roslibjs). It connects to ROS 2 through **rosbridge** and provides a 3D world viewer, robot control, and simulation reset.

## Prerequisites

- **Node.js** 18+ and npm
- **ROS 2** with the B2 Gazebo simulation running
- **rosbridge** WebSocket server (default: `ws://127.0.0.1:9090`)

Example (adjust for your setup):

```bash
# Terminal 1 — start Gazebo simulation
ros2 launch b2_gazebo b2_fortress_simulation.launch.py

# Terminal 2 — start rosbridge
ros2 launch rosbridge_server rosbridge_websocket_launch.xml
```

## Installation

```bash
npm install
```

## Run

```bash
npm start
```

Development mode (with Electron logging):

```bash
npm run dev
```

## Usage

### Launch window

1. Open the app — the launch window appears first.
2. Click **Settings** to configure the rosbridge **IP** and **port** (default `127.0.0.1:9090`). Settings are saved in `localStorage`.
3. Click **Start** to connect to rosbridge and open the main simulator window.

### Main window

The main window is a full-screen **3D world viewer** with robot pose, model, and on-screen controls. The title bar shows the current date/time.

## Robot controls

Controls are overlaid at the bottom of the world viewer.

### Movement

- **Joystick** — drag to move; forward/back and yaw
- **Keyboard**
  - `W` / `S` — forward / backward
  - `A` / `D` — yaw left / right
  - `Q` / `E` — lateral left / right

Movement commands are published to `/cmd_vel` (`geometry_msgs/msg/Twist`) at 20 Hz while active.

### Command buttons

| Button | Action |
| --- | --- |
| **Select** | Publish `/cmd_ctl_sdk` `{data: 1003}` — Lock joints |
| **Start** | Publish `/cmd_ctl_sdk` `{data: 1004}` — Unlock joints |
| **Normal** | Publish `/cmd_ctl_sdk` `{data: 1008}` — Speed slow (AI mode) |
| **Fast** | Publish `/cmd_ctl_sdk` `{data: 1007}` — Speed fast (AI mode) |
| **Stand Up** | Publish `/cmd_ctl_sdk` `{data: 1001}` — Balance stand |
| **Stand Down** | Publish `/cmd_ctl_sdk` `{data: 1002}` — Stand down |
| **Mode** (toggle) | Shows current motion mode; click to switch AI ↔ Sport |
| **Reset** | Open reset simulation dialog (below mode button) |

On launch the app queries the current mode via `/robot_mode_query`, then listens on `/robot_mode` for the response.

### SDK command codes (`/cmd_ctl_sdk`)

| Code | Action |
| --- | --- |
| 1000 | Damp — StopMove() + Damp() |
| 1001 | Balance stand — BalanceStand() |
| 1002 | Stand down — StopMove() + StandDown() |
| 1003 | Lock joints — StopMove() + SwitchGait(0) |
| 1004 | Unlock joints — SwitchGait(1) |
| 1005 | AI mode |
| 1006 | Sport mode |
| 1007 | Speed fast — SpeedLevel(1), AI mode only |
| 1008 | Speed slow — SpeedLevel(-1), AI mode only |

### Reset simulation

**Reset** (bottom controls, below mode button) opens a dialog to save spawn points and publish a one-shot pose to `/reset` (`geometry_msgs/msg/Pose`).

```bash
ros2 topic pub --once /reset geometry_msgs/msg/Pose \
  "{position: {x: 2.0, y: 1.0, z: 1.55}, orientation: {x: 0.0, y: 0.0, z: 0.0, w: 1.0}}"
```

## ROS topics

### Subscribed

| Topic | Type | Purpose |
| --- | --- | --- |
| `/world_pose` | `nav_msgs/msg/Odometry` | Robot position in world |
| `/joint_states` | `sensor_msgs/msg/JointState` | Leg joint angles |

### Published

| Topic | Type | Purpose |
| --- | --- | --- |
| `/cmd_vel` | `geometry_msgs/msg/Twist` | Robot velocity |
| `/cmd_ctl_sdk` | `std_msgs/msg/Int32` | SDK stand/mode/gait commands |
| `/reset` | `geometry_msgs/msg/Pose` | Reset simulation pose |

### Mode query

| Topic | Type | Purpose |
| --- | --- | --- |
| `/robot_mode_query` | `std_msgs/msg/Int32` | Publish `{data: 0}` to request current mode |
| `/robot_mode` | `std_msgs/msg/Int32` | Response: `1005` AI, `1006` Sport, `0` none, `<0` SDK error |

## Project structure

```
UnitreeSimUI/
├── electron/
│   ├── main.js          # Electron main process, window management
│   └── preload.js       # Secure IPC bridge
├── src/
│   ├── launch/          # Launch / connect window
│   ├── main/            # Main simulator workspace
│   └── assets/          # Static assets (e.g. robot image)
├── package.json
└── README.md
```

### Key files

| File | Role |
| --- | --- |
| `src/launch/renderer.js` | ROS connect on Start, settings dialog |
| `src/main/ros-shared.js` | Shared rosbridge connection |
| `src/main/world-viewer.js` | 3D world model, robot pose, joints |
| `src/main/robot-control.js` | Joystick, keyboard, `/cmd_vel`, `/cmd_ctl_sdk` |
| `src/main/reset-simulation.js` | Reset dialog and `/reset` publish |
| `src/main/renderer.js` | Title bar clock, window controls |

## License

MIT
