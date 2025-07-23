

[![Github-sponsors](https://img.shields.io/badge/sponsor-30363D?logo=GitHub-Sponsors&logoColor=#EA4AAA)](https://github.com/sponsors/xbgmsharp)
[![](https://github.com/xbgmsharp/signalk-postgsail/workflows/publish/badge.svg)](https://github.com/xbgmsharp/signalk-postgsail/actions)
[![npm version](https://img.shields.io/npm/v/signalk-postgsail.svg)](https://www.npmjs.com/package/signalk-postgsail)
[![GitHub Repo stars](https://img.shields.io/github/stars/xbgmsharp/postgsail?style=social)](https://github.com/xbgmsharp/postgsail/stargazers)


# Signal K PostgSail plugin
PostgSail effortlessly logs your voyages, automatically capturing your trips, moorages, dockings and anchorages with no additional need to stop/start anything. Built for sailors, motorboats and commercial uses.

Send, monitor, alert, observe all numeric values & positions & status to a self-hosted or cloud instances of [PostgSail](https://github.com/xbgmsharp/postgsail) (PostgreSQL, Grafana).

## Description
Signal K server plugin to send all self SignalK numeric data and navigation entry to a [PostgSail](https://github.com/xbgmsharp/postgsail) server.

## Demo
https://github.com/xbgmsharp/signalk-postgsail/assets/1498985/b2669c39-11ad-4a50-9f91-9397f9057ee8

## Features
- Automatically log your voyages without manually starting or stopping a trip.
- Automatically capture the details of your voyages (boat speed, heading, wind speed, etc).
- Timelapse video your trips, with or without time control.
- Add custom notes to your logs.
- Export to CSV, GPX, GeoJSON, KML and download your logs.
- Export your logs as image (PNG) or video (MP4).
- Aggregate your trip statistics: Longest voyage, time spent at anchorages, home ports etc.
- See your moorages on a global map, with incoming and outgoing voyages from each trip.
- Monitor your boat (position, depth, wind, temperature, battery charge status, etc.) remotely.
- History: view trends.
- Alert monitoring: get notification on low voltage or low fuel remotely.
- Notification via email or PushOver, Telegram.
- Offline mode.
- Low Bandwidth mode.
- Awesome statistics and graphs.
- Create and manage your own dashboards.
- Windy PWS (Personal Weather Station).
- Engine Hours Logger.
- Polar performance.
- Anything missing? just ask!

## Optional dependencies
[signalk-autostate](https://www.npmjs.com/package/@meri-imperiumi/signalk-autostate) by @meri-imperiumi. Used to determine the vessel's state based on sensor values, and updates the `navigation.state` value accordingly.

The [signalk-derived-data](https://github.com/SignalK/signalk-derived-data) and [signalk-path-mapper](https://github.com/sbender9/signalk-path-mapper) plugins are both useful to remap available data to the required canonical paths.

## Source data

The following SignalK paths are used by PostgSail to generate logbook and monitoring.
[SignalK Keys Reference (Vessel)](
http://signalk.org/specification/1.7.0/doc/vesselsBranch.html)

|SignalK path|Timeline name|Notes|
|-|-|-|
|`navigation.state`||use for trip start/end and motoring vs sailing|
|`navigation.courseOverGroundTrue`|Course||
|`navigation.headingTrue`|Heading||
|`navigation.speedThroughWater`|||
|`navigation.speedOverGround`|Speed||
|`environment.wind.directionTrue`|Wind||
|`environment.wind.speedTrue`|Wind||
|`environment.wind.speedOverGround`|Wind|||
|`environment.*.pressure`|Baro|Pressure in zone|
|`environment.*.temperature`|Temp||
|`environment.*.relativeHumidity`|Ratio|1 = 100%|
|`environment.water.swell.state`|Sea||
|`navigation.position`|Coordinates||
|`navigation.log`|Log|If present, used to calculate distance|
|`propulsion.*.runTime`|Engine|If present, used to calculate engine hour usage|
|`steering.autopilot.state`||Autopilot changes are logged.|
|`navigation.state`||If present, used to start and stop automated hourly entries. Changes are logged.|
|`propulsion.*.state`||Propulsion changes are logged.|
|`electrical.batteries.*.voltage`||Voltage measured|
|`electrical.batteries.*.current`||Current measured|
|`electrical.batteries.*.stateOfCharge`|ratio|State of charge, 1 = 100%|
|`electrical.solar.*`||Solar measured|
|`tanks.*.currentLevel`||Level of fluid in tank 0-100%|
|`tanks.*.capacity.*`||Total capacity|

The [signalk-derived-data](https://github.com/sbender9/signalk-derived-data) and [signalk-path-mapper](https://github.com/sbender9/signalk-path-mapper) plugins are both useful to remap available data to the required canonical paths.

## Cloud
Optional, create a free account on [iot.openplotter.cloud](https://iot.openplotter.cloud/).

## Self-hosted
Host your own [PostgSail](https://github.com/xbgmsharp/postgsail) server.

## Development
### Cloud development

A full-featured development environment ready to test and code.

#### With DevPod

- [![Open in DevPod!](https://devpod.sh/assets/open-in-devpod.svg)](https://devpod.sh/open#https://github.com/xbgmsharp/signalk-postgsail&workspace=signalk-postgsail&provider=docker&ide=openvscode)
  - or via [direct link](https://devpod.sh/open#https://github.com/xbgmsharp/signalk-postgsail&workspace=signalk-postgsail&provider=docker&ide=openvscode)
