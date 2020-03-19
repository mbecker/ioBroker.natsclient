"use strict";

/*
 * Created with @iobroker/create-adapter v1.20.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");
const NATS = require("nats");
const async = require("async");
const _ = require("lodash");
const YAML = require("json-to-pretty-yaml");

// TODO: Replace const with config
const initget = "init.get";
const initsend = "init.send";
const stateupdate = "state.update";
const stateset = "state.set.>";
const stateget = "state.get.>";
const stategetsend = "state.send";
const objectset = "object.set.>";
const objectget = "object.get.>";
const objectgetsend = "object.send";


// Load your modules here, e.g.:
// const fs = require("fs");

/* Option parameters in admin
 *
 * this.config.natsconnection;
 * this.config.shouldUsePrefixForChannelName;
 */

async function asyncForEach(array, callback) {
  for (let index = 0; index < array.length; index++) {
    await callback(array[index], index, array);
  }
}

class Natsclient extends utils.Adapter {
  /**
   * @param {Partial<ioBroker.AdapterOptions>} [options={}]
   */
  constructor(options) {
    super({
      ...options,
      name: "natsclient"
    });
    this.on("ready", this.onReady.bind(this));
    this.on("objectChange", this.onObjectChange.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    // this.on("message", this.onMessage.bind(this));
    this.on("unload", this.onUnload.bind(this));

    // Custom class parmeters
    this.nc = null;
    this.subscribedObjects = {};
    this.subscribedStates = [];
    this.adaptername = "natsclient"; // TODO: Replace with option for enum[this.option("enumname")]
  }

  /**
   * Updated the object (id) in the subscrbed objects
   * @param {string} id
   * @param {ioBroker.Object} object
   */
  updateObject(id, object) {
    // TODO: Publish to nats channel?
    for (const _key in this.subscribedObjects) {
      for (const _object in this.subscribedObjects[_key]) {
        if (_object === id) {
          this.subscribedObjects[_key][_object] = object;
        }
      }
    }
  }

  /**
   * Delete object from subscribed objects
   * @param {string} id
   */
  deleteObject(id) {
    // TODO: Publish to nats channel?
    for (const _key in this.subscribedObjects) {
      for (const _object in this.subscribedObjects[_key]) {
        if (_object === id) {
          delete this.subscribedObjects[_key][_object];
        }
      }
    }
  }

  /**
   * Update state (publish to nats channel)
   * @param {string} id The id of the state
   * @param {ioBroker.State} state The state object
   */
  updateState(id, state) {
    this.publishToNatsChannel(stateupdate + "." + id, null, state, null);
  }

  /**
   * Delete state from subscribed states
   * @param {string} id The id of the state which is deleted
   */
  deleteState(id) {
    // TODO: Publish to nats channel?
    const index = this.subscribedStates.indexOf(id);
    if (index !== -1) this.subscribedStates.splice(index, 1);
  }

  /**
   * Publis state to NATS channel
   * @param {string} subject The subject the message should sent to
   * @param {string | null} reply The reply channel if exists (overwrite subject)
   * @param {object} msg The object which should be sent
   * @param {string | null} err The error sent to subject|reply
   */
  publishToNatsChannel(subject, reply, msg, err) {
    // If reply the use reply as channel; if not then use normal subject with prefix
    subject = reply ? reply : this.config.shouldUsePrefixForChannelName + subject;

    if (err !== null) {
      this.nc.publish(subject, {
        error: err
      }, () => {
        this.log.info(`Publish error to nats channel: ${subject}`);
      });
      return;
    }

    // Publish to nats channel
    if (this.nc === null) {
      this.log.warn("nats client connection is null");
    } else {
      this.nc.publish(subject, msg, () => {
        this.log.info(`Publish msg to nats channel confirmed: ${subject} - ${JSON.stringify(msg)}`);
      });
    }
  }

  /**
   * Get the subscribed states from enum
   * - Add objects and states to list
   * - Subscribe to states and objects
   * - Publishes objects to nats channel
   * @param {string | null} reply The reply channel
   */
  getSubscribedObjectsAndStates(reply) {
    this.getEnumAsync(this.adaptername)
      .then(_value => {
        async.forEachOf(
          _value.result,
          (element, _key, callback) => {
            const _keyName = _key.replace("enum." + this.adaptername + ".", "");
            this.subscribedObjects[_keyName] = {};
            if (
              typeof element["common"] !== "undefined" &&
              typeof element["common"]["members"] !== "undefined" &&
              element["common"]["members"].length > 0
            ) {
              const elementMembers = element["common"]["members"]; // includes the states as follows: element["common"]["members"] = ["deconz.0.Lights.1.bri", "deconz.0.Lights.2.on", ...]
              async.every(
                elementMembers,
                (_state, innerCallback) => {
                  this.getForeignObject(_state, (err, obj) => {
                    if (err !== null) return innerCallback(err, null);
                    // State: Push to internal list; subscribe to changes
                    this.subscribedStates.push(_state);
                    this.subscribeForeignStates(_state);

                    // Object: Push to internal list; subscribe to changes
                    this.subscribedObjects[_keyName][_state] = obj;
                    this.subscribeForeignObjects(_state);

                    // Call for true
                    innerCallback(null, true);
                  });
                },
                err => {
                  if (err !== null) callback(err);
                  callback();
                }
              );
            }
          },
          err => {
            if (err) {
              this.log.warn("getObjectsEachOf: " + err.message);
              return;
            }

            // Publish: Inital State
            // this.nc is not null because the function is initialized in the nc.on listener "connect"
            // TODO: Check config for initial status and inital channel; check for prefix?
            this.publishToNatsChannel(initsend, reply, this.subscribedObjects, null);
          }
        );
      });
  }


  createObject(array, tmpObj) {
    if (
      array[0].toLowerCase() === "configuration"
    ) {
      return;
    }
    if (array.length === 1) {
      const obj = {};
      obj[array[0]] = tmpObj;
      return obj;
    } else {
      const obj = {};
      obj[array[0]] = this.createObject(array.splice(1), tmpObj);
      return obj;
    }
  }

  /**
   * Is called when databases are connected and adapter received configuration.
   */
  async onReady() {
    // Initialize your adapter here

    // Reset the connection indicator during startup
    this.setState("info.connection", false, true);
    this.setState("info.server", "", true);

    // The adapters config (in the instance object everything under the attribute "native") is accessible via
    // this.config:
    this.log.info("config natsconnection: " + this.config.natsconnection);

    const objects = this.config.getobjectsid.split(",");
    const arr = [];
    let objOrigin = {};

    const promises = [];


    for (let index = 0; index < objects.length; index++) {
      const el = objects[index];
      promises.push(this.getForeignObjectsAsync(el)
        .then(obj => {
          this.log.info("--- START GETTING FOREIGNSTATES ---");

          let obj2 = {};


          for (const k in obj) {


            if (typeof obj[k]["common"] === "undefined") continue;
            if (typeof obj[k]["common"]["type"] === "undefined") continue;
            if (typeof obj[k]["common"]["role"] === "undefined") continue;
            let role = obj[k]["common"]["role"].toLowerCase();

            if (!role.includes("switch.") && !role.includes("value.") && !role.includes("sensor.") && !role.includes("indicator.")
              && !k.toLowerCase().includes("temperature")
              && !k.toLowerCase().includes("humidity")
              && !k.toLowerCase().includes("pressure")
              && !k.toLowerCase().includes("open")
              && !k.toLowerCase().includes("reachable")
              && !k.toLowerCase().includes("daylight")
              && !k.toLowerCase().includes("dark")
              && !k.toLowerCase().includes("lux")
              && !k.toLowerCase().includes("lightlevel")
              && !k.toLowerCase().includes("buttonpressed")
              && !k.toLowerCase().includes("switch")
              && !k.toLowerCase().includes("electric_-_w") // zwave.0.NODE4.METER.Electric_-_W_1 : Power for zwave power plug
              && !k.toLowerCase().includes("electric_-_kwh") // zwave.0.NODE4.METER.Electric_-_kWh_1 : Power for zwave power plug
              && !k.toLowerCase().includes("power") // zwave.0.NODE4.SENSOR_MULTILEVEL.Power_1

              || k.toLowerCase().includes("_info") // tado.0.466027._info
            ) continue;

            // Tado

            const splitted = k.toLowerCase().split(".");
            const lastElementSplited = splitted[splitted.length - 1];

            if (role.includes("switch.")) role = role.split("switch.")[1];
            if (role.includes("value.")) role = role.split("value.")[1];
            if (role.includes("sensor.")) role = role.split("sensor.")[1];
            if (role.includes("indicator.")) role = role.split("indicator.")[1];
            if (k.toLowerCase().includes("temperature")) role = "temperature";
            if (k.toLowerCase().includes("humidity")) role = "humidity";
            if (k.toLowerCase().includes("pressure")) role = "pressure";
            if (k.toLowerCase().includes("openwindow")) role = "openWindow";
            if (k.toLowerCase().includes("openwindowdetection")) role = "openwindowdetection";
            if (k.toLowerCase().includes("pushnotifications")) role = "device_setting";
            if (k.toLowerCase().includes("daylight")) role = "daylight";
            if (k.toLowerCase().includes("dark")) role = "dark";
            if (k.toLowerCase().includes("lux")) role = "lux";
            if (k.toLowerCase().includes("lightlevel")) role = "lightlevel";
            if (k.toLowerCase().includes("lastupdated")) role = "lastupdated";
            if (k.toLowerCase().includes("datetime")) role = "lastupdated";
            if (k.toLowerCase().includes("electric_-_w")) role = "electricwatt";
            if (k.toLowerCase().includes("electric_-_kwh")) role = "electrickwh";
            if (k.toLowerCase().includes("power")) role = "power";
            if (k.toLowerCase().includes("buttonpressed")) role = "control";
            if (k.toLowerCase().includes(".info.")) role = "device_info";
            if (lastElementSplited === "alive" || lastElementSplited === "event" || lastElementSplited === "ready" || lastElementSplited === "sleep") role = "device_info"; // zwave.0.NODE7.alive

            if (role.toLowerCase().includes("switch") || k.toLowerCase().includes("switch")) {
              role = "switch";
              // shelly.0.SHSW-1#114418#1
              if (role.toLowerCase().includes("shelley")) role = "light";
            }

            
            obj2[k] = {};
            obj2[k]["id"] = k;
            obj2[k]["field"] = role.replace(".", "_"); // role
            obj2[k]["tags"] = {};
            obj2[k]["tags"]["name"] = splitted[splitted.length - 1];
            obj2[k]["tags"]["type"] = obj[k]["common"]["type"];
            obj2[k]["tags"]["unit"] = "";
            obj2[k]["tags"]["setting"] = false;
            obj2[k]["tags"]["room"] = "-";
            

            // An object like "switch.power" has maybe states like "on", "off"
            // These values could be later used as true/false
            // Chekc that that object has these states and the set the type to "onoff"; the original type is maybe "mixed"

            const addtionalTags = {};
            if (k.toLowerCase().includes("pushnotifications")) {
              
              addtionalTags["shoulduse"] = true;
              addtionalTags["device_setting"] = "pushnotifications";

              addtionalTags["pushnotifications"] = splitted[splitted.length - 1];
              addtionalTags["device"] = splitted[4];
            }

            if (role === "openwindowdetection") {
              if(typeof obj2[k]["additionaltags"] === "undefined") obj2[k]["additionaltags"] = {};
              addtionalTags["shoulduse"] = true;
              addtionalTags["openwindowdetection"] = splitted[splitted.length - 1];
              if (splitted[splitted.length - 1] === "enabled") obj2[k]["tags"]["type"] = "boolean";
            }

            if (role === "openWindow") {
              
              addtionalTags["openwindow"] = splitted[splitted.length - 1].toLowerCase();
            }

            if(Object.keys(addtionalTags).length > 0) {
              if(typeof obj2[k]["additionaltags"] === "undefined") obj2[k]["additionaltags"] = {};
              obj2[k]["additionaltags"] = addtionalTags;
            }
            



            if (k.toLowerCase().includes("detectedtime")) obj2[k]["tags"]["type"] = "datetime";
            if (k.toLowerCase().includes("inseconds")) obj2[k]["tags"]["type"] = "number";
            if (k.toLowerCase().includes("expiry")) obj2[k]["tags"]["type"] = "number";
            if (splitted[splitted.length - 1] === "open") obj2[k]["field"] = "windowdoor";
            if (k.toLowerCase().includes("buttonpressed")) obj2[k]["tags"]["type"] = "number";
            if (role === "daylight") obj2[k]["tags"]["type"] = "boolean";


            if (typeof obj[k]["common"]["states"] !== "undefined" && obj[k]["common"]["type"] !== "boolean") {
              const states = obj[k]["common"]["states"];
              if (typeof obj2[k]["states"] !== "undefined") obj2[k]["states"] = {};
              obj2[k]["states"] = states;

              const objectKeys = Object.keys(states);
              if (objectKeys.length === 2 && (objectKeys[0].toLowerCase() === "on" || objectKeys[1].toLowerCase() === "on")) {
                obj2[k]["tags"]["type"] = "onoff";
              }

              // for (const kstates in states) {
              //   const vstates = states[kstates].toLowerCase();
              //   if (vstates.includes("on")) {
              //     obj2[k]["tags"]["type"] = "onoff";
              //     obj2[k]["tags"]["unit"] = "onoff";
              //   }
              // }
            }
            if (role === "lastupdated") {
              obj2[k]["tags"]["type"] = "datetime";
              obj2[k]["tags"]["unit"] = "datetime";
            }

            // TAGS
            if (obj[k]["common"]["unit"] === "°C") obj2[k]["tags"]["unit"] = "celcius";
            if (obj[k]["common"]["unit"] === "%") obj2[k]["tags"]["unit"] = "percentage";

            if (k.toLowerCase().includes("setting")) {
              obj2[k]["tags"]["setting"] = true;
            } else {
              obj2[k]["tags"]["setting"] = false;
            }
            if (k.toLowerCase().includes("rooms")) {
              const ks = k.toLowerCase().split(".");
              const room = ks[4];
              obj2[k]["tags"]["room"] = room;
            }
            // {"enum.rooms.esszimmer":"Esszimmer"}
            const enums = obj[k].enums;
            for (const enumKey in enums) {
              if (enumKey.toLowerCase().includes("rooms")) obj2[k]["tags"]["room"] = enums[enumKey];
            }
            if (typeof obj2[k]["tags"]["room"] === "object") {
              for (const enumKey in obj2[k]["tags"]["room"]) {
                if (enumKey.toLowerCase().includes("en")) obj2[k]["tags"]["room"] = obj2[k]["tags"]["room"]["en"];
              }
            }

            arr.push(obj2[k]);

            const ks = k.toLowerCase().split(".");
            const ksObj = this.createObject(ks, obj2[k]);
            objOrigin = _.merge(objOrigin, ksObj);




            // this.getForeignStateAsync(k)
            //   .then((state) => {
            //     obj2[k]["value"] = state;



            //     return obj2;
            //   })
            //   .then((obj3) => {
            //     const objs = JSON.stringify(obj3);
            //     this.setState("info.objs", objs);
            //     this.log.info("--- WRITE DONE !!! ---");
            //   })
            //   .catch((err) => {
            //     this.log.error(err);
            //     obj[k]["error"] = err;
            //   });


            // this.getForeignState(k, (err, state) => {
            //   obj2[k] = obj[k];
            //   if(err !== null) {
            //     this.log.error(err);
            //     obj2[k]["error"] = err;
            //   } else {
            //     this.log.info(JSON.stringify(state));
            //     obj2[k]["value"] = state;
            //   }
            //   const objs = JSON.stringify(obj2);
            //   this.setState("info.objs", objs);
            //   this.log.info("--- WRITE DONE !!! ---");
            // });
          }
          this.log.info("--- DONE !!! ---");
        })
        .catch(err => {
          this.log.error(err);
        }));
    }

    Promise.all(promises).then(() => {
      this.log.info("Start writing");
      const objs = JSON.stringify(objOrigin);
      this.setState("info.objs", objs);
      this.log.info("--- WRITE DONE !!! ---");
      this.log.info(__dirname);
      const outputLocation = require("path").resolve(__dirname, "data.json");
      require("fs").writeFile(outputLocation, JSON.stringify(objOrigin, null, 4), (err) => {
        if (err) {
          this.log.error(err);
        } else {
          this.log.info("JSON saved to " + outputLocation);
        }
      });
      const outputLocation2 = require("path").resolve(__dirname, "arr.json");
      require("fs").writeFile(outputLocation2, JSON.stringify(arr, null, 4), (err) => {
        if (err) {
          this.log.error(err);
        } else {
          this.log.info("JSON saved to " + outputLocation);
        }
      });
      const data = YAML.stringify(arr);
      const outputLocation3 = require("path").resolve(__dirname, "arr.yaml");
      require("fs").writeFile(outputLocation3, data, (err) => {
        if (err) {
          this.log.error(err);
        } else {
          this.log.info("JSON saved to " + outputLocation);
        }
      });
    });








    /*
     * NATS Config
     */
    // this.getObjectsNotAsync()
    //   .then(msg => {
    //     this.log.info("getObjectsAsync msg: " + JSON.stringify(msg));
    //   })
    //   .catch(err => {
    //     this.log.warn("getObjectsAsync error: " + err);
    //   });

    // const natsServers = []; // TODO: Create array string in optopns to have multiple nats connection string adresses
    this.nc = NATS.connect({ url: this.config.natsconnection, json: true }); // TODO: json bool value as option
    // currentServer is the URL of the connected server.

    this.nc.on("connect", nc => {
      this.log.info("Connected to " + nc.currentServer.url.host);
      this.setState("info.connection", true, true);
      this.setState("info.server", nc.currentServer.url.host, true);

      // Get objects from enum and subscribe to states
      this.getSubscribedObjectsAndStates(null);


      // Subscribe to receives messages / commands
      nc.subscribe(this.config.shouldUsePrefixForChannelName + stateset, (msg, reply, subject, sid) => {
        // reply is not important because all state changes are handled by listener and sent back to nats
        // subject: iobroker.state.set.zwave.0.NODE4.SWITCH_BINARY.Switch_1

        subject = subject.replace(this.config.shouldUsePrefixForChannelName + stateset.replace(".>", "") + ".", "");
        this.log.info("Subscribe " + subject + "; Subscribe ID: " + sid + "; Channel - " + subject + "; Message: " + JSON.stringify(msg));
        if (this.subscribedStates.indexOf(subject) !== -1) {
          this.setForeignState(subject, msg, (err) => {
            if (err !== null) {
              this.log.warn(err);
              return;
            }
            this.log.info("Subscribe " + stateset + "; Subscribe ID: " + sid + "; setForeignState succesful: " + subject);
          });
        }
      });

      nc.subscribe(this.config.shouldUsePrefixForChannelName + stateget, (msg, reply, subject, sid) => {
        subject = subject.replace(stateget, stategetsend);
        this.log.info("Subscribe " + stateget + "; Subscribe ID: " + sid + "; Channel - " + subject + "; Message: " + JSON.stringify(msg));

        this.getForeignState(subject, (err, state) => {
          if (err !== null) {
            this.log.warn(err);
            this.nc.publish(subject, {
              error: err
            });
            return;
          }
          this.publishToNatsChannel(subject, reply, state, null);
        });
      });

      nc.subscribe(this.config.shouldUsePrefixForChannelName + objectset, (msg, reply, subject, sid) => {
        // reply is not important because all state changes are handled by listener and sent back to nats
        subject = subject.replace(objectset, "");
        this.log.info("Subscribe " + objectset + "; Subscribe ID: " + sid + "; Channel - " + subject + "; Message: " + JSON.stringify(msg));
        // Check tah foreign object is in list of subscribed objects
        for (const _key in this.subscribedObjects) {
          const element = this.subscribedObjects[_key];
          for (const _objKey in element) {
            if (_objKey === objectset) {
              this.setForeignObject(subject, msg, (err) => {
                if (err !== null) {
                  this.log.warn(err);
                  return;
                }
                this.log.info("Subscribe " + objectset + "; Subscribe ID: " + sid + "; setForeignObject succesful: " + subject);
              });
              return;
            }
          }
        }
      });

      nc.subscribe(this.config.shouldUsePrefixForChannelName + objectget, (msg, reply, subject, sid) => {
        subject = subject.replace(objectget, objectgetsend);
        this.log.info("Subscribe " + objectget + "; Subscribe ID: " + sid + "; Channel - " + subject + "; Message: " + JSON.stringify(msg));

        this.getForeignObject(subject, (err, state) => {
          if (err !== null) {
            this.log.warn(err);
            this.nc.publish(subject, {
              error: err
            });
            return;
          }
          this.publishToNatsChannel(subject, reply, state, null);
        });
      });

      nc.subscribe(this.config.shouldUsePrefixForChannelName + initget, (msg, reply, subject, sid) => {
        this.log.info("Subscribe " + initget + "; Subscribe ID: " + sid + "; Channel - " + subject + "; Message: " + JSON.stringify(msg));
        this.getSubscribedObjectsAndStates(reply);
      });


    });

    this.nc.on("error", err => {
      this.log.warn(err);
      // TODO: Check if to set the connetion to false when an erro occurs
      // this.setState("info.connection", false, true);
      // this.setState("info.server", "", true);
    });

    // emitted whenever the client disconnects from a server
    this.nc.on("disconnect", () => {
      this.log.info("natsclient disconnect");
      this.setState("info.connection", false, true);
      this.setState("info.server", "", true);
    });

    // emitted whenever the client is attempting to reconnect
    this.nc.on("reconnecting", () => {
      this.log.info("natsclient reconnecting");
    });

    // emitted whenever the client reconnects
    // reconnect callback provides a reference to the connection as an argument
    this.nc.on("reconnect", nc => {
      this.log.info("natsclient reconnected to " + nc.currentServer.url.host);
      this.setState("info.connection", true, true);
      this.setState("info.server", nc.currentServer.url.host, true);
    });

    // emitted when the connection is closed - once a connection is closed
    // the client has to create a new connection.
    this.nc.on("close", () => {
      this.log.info("natsclient close");
      this.setState("info.connection", false, true);
      this.setState("info.server", "", true);
    });

    // emitted whenever the client unsubscribes
    this.nc.on("unsubscribe", (sid, subject) => {
      this.log.warn("unsubscribed subscription " + sid + " for subject " + subject);
    });

    // emitted whenever the server returns a permission error for
    // a publish/subscription for the current user. This sort of error
    // means that the client cannot subscribe and/or publish/request
    // on the specific subject
    this.nc.on("permission_error", err => {
      this.log.warn("got a permissions error: " + err.message);
    });


    /*
		For every state in the system there has to be also an object of type state
		Here a simple template for a boolean variable named "testVariable"
		Because every adapter instance uses its own unique namespace variable names can't collide with other adapters variables
		*/
    // await this.setObjectAsync("testVariable", {
    //   type: "state",
    //   common: {
    //     name: "testVariable",
    //     type: "boolean",
    //     role: "indicator",
    //     read: true,
    //     write: true
    //   },
    //   native: {}
    // });

    // in this template all states changes inside the adapters namespace are subscribed
    // this.subscribeStates("*");

    /*
		setState examples
		you will notice that each setState will cause the stateChange event to fire (because of above subscribeStates cmd)
		*/
    // the variable testVariable is set to true as command (ack=false)
    // await this.setStateAsync("testVariable", true);

    // same thing, but the value is flagged "ack"
    // ack should be always set to true if the value is received from or acknowledged from the target system
    // await this.setStateAsync("testVariable", { val: true, ack: true });

    // same thing, but the state is deleted after 30s (getState will return null afterwards)
    // await this.setStateAsync("testVariable", { val: true, ack: true, expire: 30 });

    // examples for the checkPassword/checkGroup functions
    // let result = await this.checkPasswordAsync("admin", "iobroker");
    // this.log.info("check user admin pw iobroker: " + result);

    // result = await this.checkGroupAsync("admin", "admin");
    // this.log.info("check group user admin group admin: " + result);
  }

  /**
   * Is called when adapter shuts down - callback has to be called under any circumstances!
   * @param {() => void} callback
   */
  onUnload(callback) {
    try {
      this.log.info("cleaned everything up...");
      callback();
    } catch (e) {
      callback();
    }
  }

  /**
   * Is called if a subscribed object changes
   * @param {string} id
   * @param {ioBroker.Object | null | undefined} obj
   */
  onObjectChange(id, obj) {
    if (obj) {
      // The object was changed; update corresponding object in subscribed objects
      this.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
      this.updateObject(id, obj);
    } else {
      // The object was deleted
      this.log.info(`object ${id} deleted`);
      this.deleteObject(id);
    }
  }

  /**
   * Is called if a subscribed state changes
   * @param {string} id
   * @param {ioBroker.State | null | undefined} state
   */
  onStateChange(id, state) {
    if (state) {
      // The state was changed
      this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
      this.updateState(id, state);
    } else {
      // The state was deleted
      this.log.info(`state ${id} deleted`);
      this.deleteState(id);
    }
  }

  // /**
  //  * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
  //  * Using this method requires "common.message" property to be set to true in io-package.json
  //  * @param {ioBroker.Message} obj
  //  */
  // onMessage(obj) {
  // 	if (typeof obj === "object" && obj.message) {
  // 		if (obj.command === "send") {
  // 			// e.g. send email or pushover or whatever
  // 			this.log.info("send command");

  // 			// Send response in callback if required
  // 			if (obj.callback) this.sendTo(obj.from, obj.command, "Message received", obj.callback);
  // 		}
  // 	}
  // }
}

// @ts-ignore parent is a valid property on module
if (module.parent) {
  // Export the constructor in compact mode
  /**
   * @param {Partial<ioBroker.AdapterOptions>} [options={}]
   */
  module.exports = options => new Natsclient(options);
} else {
  // otherwise start the instance directly
  new Natsclient();
}