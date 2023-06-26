/*
 * Copyright 2019-2021 Ilker Temir <ilker@ilkertemir.com>
 * Copyright 2021-2023 Francois Lacroix <xbgmsharp@gmail.com>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const POLL_INTERVAL = 15            // Poll every N seconds
const SUBMIT_INTERVAL = 10         // Submit to API every N minutes Prod
//const SUBMIT_INTERVAL = 3         // Submit to API every N minutes Dev
const SEND_METADATA_INTERVAL = 1   // Submit to API every N hours
const MIN_DISTANCE = 0.50          // Update database if moved X miles
//const DB_UPDATE_MINUTES = 2       // Update database every N minutes (worst case) Dev
const DB_UPDATE_MINUTES = 5       // Update database every N minutes (worst case) Prod
const DB_UPDATE_MINUTES_MOVING = 1 // Update database every N minutes while moving
const SPEED_THRESHOLD = 1          // Speed threshold for moving (knots)
const MINIMUM_TURN_DEGREES = 25    // Update database if turned more than N degrees
const BUFFER_LIMIT = 31           // Submit only X buffer entries at a time Prod
//const BUFFER_LIMIT = 2           // Submit only X buffer entries at a time Dev

//const fs = require('fs');
const filePath = require('path');
const axios = require('axios');
const sqlite3 = require('sqlite3');
const zlib = require('zlib');
const moment = require('moment');
const https = require('https');
const mypackage = require('./package.json');

module.exports = function(app) {
  var plugin = {};
  var unsubscribes = [];
  var submitProcess;
  var sendMetadataProcess;
  var statusProcess;
  var db;
  var API;
  var host;
  var token;
  var gpsSource;
  var status = null;
  var metrics = {};

  var updateLastCalled = Date.now();
  var lastSuccessfulUpdate;
  var position = null;
  var speedOverGround;
  var courseOverGroundTrue;
  var windSpeedApparent = 0;
  var angleSpeedApparent = 0;
  var previousSpeeds = [];
  var previousCOGs = [];

  var metadata = {
    name: app.getSelfPath('name'),
    mmsi: app.getSelfPath('mmsi'),
    // urn:mrn:signalk:uuid:
    client_id: 'vessels.urn:mrn:imo:mmsi:'+ app.getSelfPath('mmsi') || 'vessels.'+app.selfId,
    length: app.getSelfPath('design.length.value.overall'),
    beam: app.getSelfPath('design.beam.value'),
    height: app.getSelfPath('design.airHeight.value'),
    ship_type: app.getSelfPath('design.aisShipType.value.id'),
    plugin_version: mypackage.version,
    signalk_version: app.config.version,
    time: new Date().toISOString()
  };

  plugin.id = "signalk-postgsail";
  plugin.name = "SignalK PostgSail";
  plugin.description = "PostgSail plugin for Signal K";

  plugin.start = function(options) {

    if (!options.token) {
      app.error('Token is required');
      return
    }

    host = options.host;
    token = options.token;
    gpsSource = options.source;

    app.setPluginStatus('PostgSail started. Please wait for a status update.');

    API = axios.create({
      baseURL: host,
      timeout: 40000,
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': `postgsail.signalk v${metadata.plugin_version}`
       },
       httpsAgent: new https.Agent({KeepAlive: true})
    });
    sendMetadata();

    let dbFile = filePath.join(app.getDataDirPath(), 'postgsail.sqlite3');
    db = new sqlite3.Database(dbFile);
    db.run('CREATE TABLE IF NOT EXISTS buffer(time REAL,' +
           '                                 client_id TEXT,' +
           '                                 latitude REAL,' +
           '                                 longitude REAL,' +
           '                                 speedoverground REAL,' +
           '                                 courseovergroundtrue REAL,' +
           '                                 windspeedapparent REAL,' +
           '                                 anglespeedapparent REAL,' +
           '                                 status TEXT,' +
           '                                 metrics JSON)');

    let subscription = {
      context: 'vessels.self',
      subscribe: [{
        path: '*',
        period: POLL_INTERVAL * 1000
      }]
    };

    app.subscriptionmanager.subscribe(subscription, unsubscribes, function() {
      app.error('Subscription error');
    }, data => processDelta(data));

    sendMetadataProcess = setInterval( function() {
      sendMetadata();
    }, SEND_METADATA_INTERVAL * 60 * 60 * 1000);

    submitProcess = setInterval( function() {
      submitDataToServer();
    }, SUBMIT_INTERVAL * 60 * 1000);

    statusProcess = setInterval( function() {
      db.all('SELECT * FROM buffer ORDER BY time', function(err, data) {
        let message;
        if (data.length == 1) {
          message = `${data.length} entry in the queue,`;
        } else {
          message = `${data.length} entries in the queue,`;
        }
        if (lastSuccessfulUpdate) {
          let since = timeSince(lastSuccessfulUpdate);
          message += ` last connection to the server was ${since} ago.`;
        } else {
          message += ` no successful connection to the server since restart.`;
        }
        app.setPluginStatus(message);
      })
    }, 31*1000);
  }

  plugin.stop =  function() {
    clearInterval(sendMetadataProcess);
    clearInterval(submitProcess);
    clearInterval(statusProcess);
    if (db) {
      db.close();
    }
  };

  plugin.schema = {
    type: 'object',
    required: ['token'],
    properties: {
      host: {
        type: "string",
        title: "Host (Optional - default to cloud PostgSail https://iot.openplotter.cloud/)",
        default: "https://api.openplotter.cloud/"
      },
      token: {
        type: "string",
        title: "Token (obtain free from https://iot.openplotter.cloud/)"
      },
      source: {
        type: "string",
        title: "GPS source (Optional - only if you have multiple GPS sources and you want to use an explicit source)"
      }
    }
  }

  function sendMetadata() {
    // Update metadata time
    metadata.time = new Date().toISOString();
    app.debug(`DEBUG: metadata: ${metadata.toString()}`);
    API.post('/metadata?on_conflict=vessel_id', metadata,
        {
          headers: {
            'Prefer': 'return=headers-only,resolution=merge-duplicates'
          }
        }
    )
    .then(function (response) {
      //console.log(response);
      if (response && response.status == 201){
        app.debug('Successfully sent metadata to the server');
        //app.debug(response);
        lastSuccessfulUpdate = Date.now();
        submitDataToServer();
      }
    })
    .catch(function (error) {
      app.debug('Metadata submission to the server failed');
      console.log('signalk-postgsail - Metadata submission to the server failed');
      if (error.response) {
          // The request was made and the server responded with a status code
          // that falls out of the range of 2xx
          console.log(error.response);
          console.log('signalk-postgsail - Error the server responded with non 2xx a status code');
      } else if (error.request) {
          // The request was made but no response was received
          // `error.request` is an instance of http.ClientRequest in node.js
          //console.log(error.request);
          console.log('signalk-postgsail - Error no response was received');
      } else {
          // Something happened in setting up the request that triggered an Error
          console.log('signalk-postgsail - Error', error.message);
      }
      //console.log('signalk-postgsail - Error', error.config);
    });
  }

  function updateDatabase() {
    app.debug('updateDatabase');
    let ts = Date.now();
    updateLastCalled = ts;

    if ((!position) || (!position.changedOn)) {
      return
    }

    let values = [new Date().toISOString(), metadata.client_id, position.latitude, position.longitude,
                  speedOverGround, courseOverGroundTrue, windSpeedApparent,
                  angleSpeedApparent, status, JSON.stringify(metrics)];

    db.run('INSERT INTO buffer VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', values, function(err) {
      windSpeedApparent = 0;
    });
    position.changedOn = null;
  }

  function submitDataToServer() {
    app.debug('submitDataToServer');
    // Limit the numbers of entries for slow connection, 1 entry/row a minutes submit every 10min
    // and reduce memory usage
    db.all(`SELECT * FROM buffer ORDER BY time LIMIT ${BUFFER_LIMIT}`, function(err, data) {
    //db.all('SELECT * FROM buffer ORDER BY time LIMIT 2', function(err, data) {
    //db.all('SELECT * FROM buffer ORDER BY time', function(err, data) {
      if (!data || data.length == 0) {
        app.debug('Nothing to send to the server, skipping');
        return
      }
      app.debug(`DEBUG: metrics sending ${data.length} row(s)`);
      //app.debug(JSON.stringify(data));
      let i;
      for (i = 0; i < data.length; i++) {
        data[i].metrics = JSON.parse(data[i].metrics);
      }
      app.debug('DEBUG: metrics lastTime:' + data[data.length-1].time);
      //console.log(`signalk-postgsail - metrics sending ${data.length} row(s), lastTime:` + data[data.length-1].time);
      /* *
      * TODO ADD compression GZIP
      * https://www.geeksforgeeks.org/node-js-zlib-gzipsync-method/
      * https://www.stedi.com/docs/edi-core/compression
      * */
      API.post('/metrics?select=time', data,
      //API.post('/metrics?select=time', zlib.gzipSync(data),
        {
          headers: {
            'Prefer': 'return=representation',
            'Content-Type': 'application/json'
            //'content-type': 'application/gzip',
            //'accept-encoding': 'gzip'
          }
        }
      )
      .then(function (response) {
        //console.log(response);
        if (response && response.status == 201 && response.data){
          app.debug(response.data);
          let lastTs = null;
          if (response.data.length > 0) {
            // response exclude timezone and trim 0 and it is UTC.
            //lastTs = response.data[response.data.length-1].time+'Z';
            //lastTs = new Date(response.data[response.data.length-1].time).toISOString();
            lastTs = moment.utc(response.data[response.data.length-1].time).toISOString();
            app.debug(`Response metrics lastTime <=${lastTs}`);
          }
          if (response.data.length != data.length) {
            // If duplicated time might be ignored
            app.debug(`Ignored metrics from buffer, sent:${data.length}, got:${response.data.length}`);
            lastTs = data[data.length-1].time;
          }
          app.debug(`Successfully sent ${data.length} record(s) to the server`);
          app.debug(`Removing from buffer <=${lastTs}`);
          db.run('DELETE FROM buffer where time <= ?', lastTs, function cb(err) {
            if(err) {
              app.debug(`Failed to delete metrics from buffer`);
            } else {
              app.debug(`Buffer row(s) deleted: ${this.changes}`);
              if (this.changes && this.changes > 0) {
                app.debug(`Deleted metrics from buffer, req:${data.length}, got:${this.changes}`);
                // Wait and send new metrics data
                app.debug('Successfully deleted metrics from buffer, will continue sending metrics to the server');
                lastSuccessfulUpdate = Date.now();
                // Avoid conflict between setInterval data process and SetTimeout data process??
                setTimeout(function(){
                  app.debug('setTimeout, SubmitDataToServer, submitting next metrics batch');
                  submitDataToServer();
                }, 19*1000); // In 8 seconds
              } else {
                app.debug(`No operations runned on metrics from buffer: ${this.changes}`);
                console.log('signalk-postgsail - warning removing metrics from buffer');
              }
            }
          });

        }
      })
      .catch(function (error) {
        app.debug(`Connection to the server failed, retry in ${SUBMIT_INTERVAL} min`);
        console.log(`signalk-postgsail - connection to the server failed, retry in ${SUBMIT_INTERVAL} min`);
        if (error.response) {
          // The request was made and the server responded with a status code
          // that falls out of the range of 2xx
          console.log(error.response);
          console.log('signalk-postgsail - Error the server responded with non 2xx a status code');
        } else if (error.request) {
            // The request was made but no response was received
            // `error.request` is an instance of http.ClientRequest in node.js
            //console.log(error.request);
            console.log('signalk-postgsail - Error no response was received');
        } else {
            // Something happened in setting up the request that triggered an Error
            console.log('signalk-postgsail - Error', error.message);
        }
        //console.log('signalk-postgsail - Error', error.config);
      });

    });
  }

  function getKeyValue(key, maxAge) {
    let data = app.getSelfPath(key);
    if (!data) {
      return null;
    }
    let now = new Date();
    let ts = new Date(data.timestamp);
    let age = (now - ts) / 1000;
    if (age <= maxAge) {
      return data.value
    } else {
      return null;
    }
  }

  function timeSince(date) {
    var seconds = Math.floor((new Date() - date) / 1000);
    var interval = seconds / 31536000;
    if (interval > 1) {
      return Math.floor(interval) + " years";
    }
    interval = seconds / 2592000;
    if (interval > 1) {
      return Math.floor(interval) + " months";
    }
    interval = seconds / 86400;
    if (interval > 1) {
      return Math.floor(interval) + " days";
    }
    interval = seconds / 3600;
    if (interval > 1) {
      return Math.floor(interval) + " hours";
    }
    interval = seconds / 60;
    if (interval > 1) {
      return Math.floor(interval) + " minutes";
    }
    return Math.floor(seconds) + " seconds";
  }

  function radiantToDegrees(rad) {
    if (rad == null) {
      return null;
    }
    return Math.round(rad * 57.2958 * 10) / 10;
  }

  function metersPerSecondToKnots(ms) {
    if (ms == null) {
      return null;
    }
    return Math.round(ms * 1.94384 * 10) / 10;
  }

  function kelvinToCelsius(deg) {
    if (deg == null) {
      return null;
    }
    return Math.round((deg - 273.15) * 10) / 10;
  }

  function floatToPercentage(val) {
    if (val == null) {
      return null;
    }
    return val * 100;
  }

  function pascalToHectoPascal(pa) {
    if (pa == null) {
      return null;
    }
    return Math.round(pa/100*10)/10;
  }

  function calculateDistance(lat1, lon1, lat2, lon2) {
    if ((lat1 == lat2) && (lon1 == lon2)) {
      return 0;
    }
    else {
      var radlat1 = Math.PI * lat1/180;
      var radlat2 = Math.PI * lat2/180;
      var theta = lon1-lon2;
      var radtheta = Math.PI * theta/180;
      var dist = Math.sin(radlat1) * Math.sin(radlat2) + Math.cos(radlat1) * Math.cos(radlat2) * Math.cos(radtheta);
      if (dist > 1) {
          dist = 1;
      }
      dist = Math.acos(dist);
      dist = dist * 180/Math.PI;
      dist = dist * 60 * 1.1515;
      dist = dist * 0.8684; // Convert to Nautical miles
      return dist;
    }
  }

  function vesselMadeSignificantTurn() {
    /*
      Returns true if vessel has made a significant turn
    */

    if (previousCOGs.length < 6) {
      return (false);
    }
    let delta = previousCOGs[5] - previousCOGs[0];
    if (Math.abs(delta) > MINIMUM_TURN_DEGREES) {
      app.debug(`Updating database, vessel turned ${delta} degrees`);
      return (true);
    } else {
      return (false);
    }
  }

  function vesselSlowedDownOrSpeededUp(threshold) {
    /*
      Returns true if vessel has gone above or below a speed threshold
    */

    if ((speedOverGround <= threshold) &&
        (previousSpeeds.every(el => el > threshold)))  {
      app.debug(`Updating database, vessel slowed down to ${speedOverGround} kt`);
      return (true);
    }
    if ((speedOverGround > threshold) &&
        (previousSpeeds.every(el => el <= threshold))) {
      app.debug(`Updating database, vessel speeded up to ${speedOverGround} kt`);
      return (true);
    }
    return (false);
  }

  function processDelta(data) {
    if (!data.updates || !data.updates.length || !data.updates[0].values || !data.updates[0].values.length) {
      return;
    }
    let dict = data.updates[0].values[0];
    let path = dict.path;
    let value = dict.value;
    let timePassed = Date.now() - updateLastCalled;

    switch (path) {
      case 'navigation.position':
        app.debug('Save: ' + path);
        let source = data.updates[0]['$source'];
        if ((gpsSource) && (source != gpsSource)) {
          app.debug(`Skipping position from GPS resource ${source}`);
          break;
        }
        if (position) {
          let distance = calculateDistance(position.latitude,
                                           position.longitude,
                                           value.latitude,
                                           value.longitude);
          let timeBetweenPositions = Date.now() - position.changedOn;
          if ((timeBetweenPositions <= 2 * 60 * 1000) && (distance >= 5)) {
                  app.error(`Erroneous position reading. ` +
                      `Moved ${distance} miles in ${timeBetweenPositions/1000} seconds. ` +
                            `Ignoring the position: ${position.latitude}, ${position.longitude}`);
            return;
          }

          position.changedOn = Date.now();
     
          // Don't push updates more than once every 1 minute
          if (timePassed >= 60 * 1000) {
            // updateDatabase() is split to multiple if conditions for better debug messages

            // Want submissions every DB_UPDATE_MINUTES at the very least
            // todo only if not moving?
	          if (timePassed >= DB_UPDATE_MINUTES * 60 * 1000) {
              app.debug(`Updating database, ${DB_UPDATE_MINUTES} min passed since last update`);
              position = value;
              position.changedOn = Date.now();
              updateDatabase();
            }

            // Or a meaningful time passed while moving
            else if (
              (speedOverGround >= SPEED_THRESHOLD) &&
              (timePassed >= DB_UPDATE_MINUTES_MOVING * 60 * 1000)
            ) {
              app.debug(`Updating database, ${DB_UPDATE_MINUTES_MOVING} min passed while moving`);
              position = value;
              position.changedOn = Date.now();
              // Force status while moving
              if (status != "sailing" || status != "motoring") {
                status = 'sailing';
              }
              updateDatabase();
            }

            // Or we moved a meaningful distance
            else if (distance >= MIN_DISTANCE) {
              app.debug(`Updating database, moved ${distance} miles`);
              position = value;
              position.changedOn = Date.now();
              // Force status while moving
              if (status != "sailing" || status != "motoring") {
                status = 'sailing';
              }
              updateDatabase();
            }

            // Or we made a meaningful change of course while moving
            else if (
              (speedOverGround >= SPEED_THRESHOLD) && (vesselMadeSignificantTurn())
            ) {
              position = value;
              position.changedOn = Date.now();
              // Force status while moving
              if (status != "sailing" || status != "motoring") {
                status = 'sailing';
              }
              updateDatabase();
            }

            // Or the boat has slowed down or speeded up
            else if (
                 (vesselSlowedDownOrSpeededUp(SPEED_THRESHOLD)) ||
                 (vesselSlowedDownOrSpeededUp(SPEED_THRESHOLD*2)) ||
                 (vesselSlowedDownOrSpeededUp(SPEED_THRESHOLD*3))
               ) {
              position = value;
              position.changedOn = Date.now();
              updateDatabase();
            }

            
          }
        } else {
          position = value;
          position.changedOn = Date.now();
        }
        break;
      case 'navigation.speedOverGround':
        app.debug('Save: ' + path);
        let sogsource = data.updates[0]['$source'];
        if ((gpsSource) && (sogsource != gpsSource)) {
          app.debug(`Skipping speedOverGround from resource ${sogsource}`);
          break;
        }
        // Keep the previous 3 values
        speedOverGround = metersPerSecondToKnots(value);
        previousSpeeds.unshift(speedOverGround);
        previousSpeeds = previousSpeeds.slice(0, 3);
        break;
      case 'navigation.courseOverGroundTrue':
        app.debug('Save: ' + path);
        // Keep the previous 3 values
        courseOverGroundTrue = radiantToDegrees(value);
        previousCOGs.unshift(courseOverGroundTrue);
        previousCOGs = previousCOGs.slice(0, 6);
        break;
      case 'environment.wind.speedApparent':
        app.debug('Save: ' + path);
        windSpeedApparent = Math.max(windSpeedApparent, metersPerSecondToKnots(value));
        break;
      case 'environment.wind.angleApparent':
        app.debug('Save: ' + path);
        angleSpeedApparent = radiantToDegrees(value);
        break;
      /*
      * Try to detect ourself??
      * https://github.com/meri-imperiumi/signalk-autostate
      */
      case 'navigation.state':
        // Wait for a valid status before sending data ?
        if (path) {
          app.debug(`Save: ${path} with value ${value}`);
          status = value;
        }
        break;
      case 'navigation.altitude':
        app.debug(`Add to metrics path: '${path}'`);
        metrics[path] = value;
        break;
      default:
        /* Skip String, Object (typeof?) or skip Moon, Sun, Course */
        // environment.moon.*
        // environment.sunlight.*
        // navigation.courseGreatCircle.*
        // design.*
        if (path === '') {
          app.debug(`Skipping path '${path}' because is invalid, '${value}'`);
        } else if ( isNaN(value) || !isfloatField(value) || !isFinite(value) ) {
          app.debug(`Skipping path '${path}' because value is invalid, '${value}'`);
        } else {
          //app.debug(`Add to metrics path: '${path}'`);
          metrics[path] = value;
        }
    }
  }

  let isfloatField = function(n) {
    return Number(n) === n;   
  }

  return plugin;
}
