# Unitree B2 Simulator UI

Desktop UI for the Unitree B2 Gazebo simulation, built with Electron and [roslib](https://github.com/RobotWebTools/roslibjs). It connects to ROS 2 through **rosbridge** and provides camera feeds, lidar visualization, robot control, and simulation reset in a single workspace.

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

The main window shows a 2×2 panel grid. Each panel can be maximized with the button in its top-right corner.

| Panel | Content |
| --- | --- |
| 1 | Front/back cameras, crosshair overlay, robot controls |
| 2 | 3D lidar point cloud viewer |
| 3 | Third-person front/back cameras |
| 4 | Placeholder (reserved) |

The title bar shows the current date/time and a **Reset Simulation** button.

## Robot controls

Controls are in panel 1 (bottom overlay).

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
| **Select** | Lock movement (joystick/keyboard disabled, zero velocity sent) |
| **Start** | Unlock movement |
| **Stand Up** | Publish `/cmd_ctl` `{data: 10001}` |
| **Stand Down** | Publish `/cmd_ctl` `{data: 10002}` |

### Reset simulation

**Reset Simulation** (title bar) publishes two one-shot messages on `/cmd_ctl`:

1. `{data: 10004}` immediately
2. `{data: 10003}` after 1 second

Equivalent CLI:

```bash
ros2 topic pub --once /cmd_ctl std_msgs/msg/Int32 "{data: 10004}"
sleep 1
ros2 topic pub --once /cmd_ctl std_msgs/msg/Int32 "{data: 10003}"
```

## ROS topics

### Subscribed

| Topic | Type | Panel |
| --- | --- | --- |
| `/camera_front/camera_sensor/image_raw/compressed` | `sensor_msgs/msg/CompressedImage` | 1 |
| `/camera_back/camera_sensor/image_raw/compressed` | `sensor_msgs/msg/CompressedImage` | 1 |
| `/camera_third_front/camera_sensor/image_raw/compressed` | `sensor_msgs/msg/CompressedImage` | 3 |
| `/camera_third_back/camera_sensor/image_raw/compressed` | `sensor_msgs/msg/CompressedImage` | 3 |
| `/rslidar_points` | `sensor_msgs/msg/PointCloud2` | 2 |

### Published

| Topic | Type | Purpose |
| --- | --- | --- |
| `/cmd_vel` | `geometry_msgs/msg/Twist` | Robot velocity |
| `/cmd_ctl` | `std_msgs/msg/Int32` | Stand up/down, reset, etc. |

## Lidar viewer

- **Left drag** — orbit / rotate view
- **Right drag (up/down)** — zoom

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
| `src/main/ros-shared.js` | Shared rosbridge connection for sensors |
| `src/main/camera.js` | Camera panel rendering and swap |
| `src/main/lidar.js` | WebGL lidar point cloud viewer |
| `src/main/robot-control.js` | Joystick, keyboard, `/cmd_vel`, `/cmd_ctl` |
| `src/main/renderer.js` | Panel maximize, title bar clock, reset button |

## License

MIT
