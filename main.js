"use strict";

/*
 * Created with @iobroker/create-adapter v1.20.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");
const NATS = require("nats");
const async = require("async");

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
    this.publishToNatsChannel(id, state);
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
   * @param {string} id The id of the state
   * @param {ioBroker.State} state The state object
   */
  publishToNatsChannel(id, state) {
    // The nats chanel with prefix
    const channel = this.config.shouldUsePrefixForChannelName + id;
    // Publish to nats channel
    if (this.nc === null) {
      this.log.warn("nats client connection is null");
    } else {
      this.nc.publish(channel, state, () => {
        this.log.info(`Publish state to nats channel confirmed: ${channel} - ${JSON.stringify(state)}`);
      });
    }
  }

  // async asyncForEach(array, callback) {
  //   for (let index = 0; index < array.length; index++) {
  //     await callback(array[index], index, array);
  //   }
  // }

  async getObjectsEachOf() {
    const enums = await this.getEnumAsync(this.adaptername);
    if (typeof enums.result === "undefined" || enums.result.length === 0) {
      return;
    }
    await async.forEachOf(
      enums.result,
      (element, _key, callback) => {
        const _keyName = _key.replace("enum." + this.adaptername + ".", "");
        this.subscribedObjects[_keyName] = {};
        if (
          typeof element["common"] !== "undefined" &&
          typeof element["common"]["members"] !== "undefined" &&
          element["common"]["members"].length > 0
        ) {
          const elementMembers = element["common"]["members"];
          for (const _memberKey in elementMembers) {
            const _state = elementMembers[_memberKey];
            this.subscribedStates.push(_state);
            this.subscribeForeignStates(_state);

            // Assign the the object info to the key as "enum.apternamer.room1.object1 = object1.info"
            // Subscribe to object changes

            this.subscribedObjects[_keyName][_state] = null;
            this.getForeignObjectAsync(_state)
              .then(obj => {
                if (obj === null) {
                  throw new Error("obj is null");
                }
                this.log.info("add foreign objects to json: " + _keyName + " - " + _state);
                this.subscribedObjects[_keyName][_state] = obj;
                this.log.info(JSON.stringify(this.subscribedObjects[_keyName][_state]));
                this.subscribeForeignObjects(_state);
              })
              .catch(err => {
                this.log.warn("Error getObject info: " + _state + " - Error: " + err);
              });
            callback();
          }
          
        }
      },
      (err) => {
        if (err) this.log.warn(err.message);
      }
    );
    this.log.info("---- DONE getObjectsEachOf ---");
  }

  getObjectsNotAsync() {
    return new Promise((resolve, reject) => {
      this.getEnumAsync(this.adaptername)
        .then(_value => {
          // this.log.info("--- getObjects ---");
          // this.log.info(JSON.stringify(_value.result)); //  {"result":{"enum.natsclient.room1":{"_id":"enum.natsclient.room1","common":{"name":"room1","members":["deconz.0.Lights.1.on","zwave.0.NODE4.SWITCH_BINARY.Switch_1"],"icon":"","color":false},"t
          // this.log.info(JSON.stringify(_value.requestEnum)); // "enum.natsclient"

          for (const _key in _value.result) {
            // JSON key: _key
            // JSON value: result[_key]
            const element = _value.result[_key];

            // Create key in object subscribed devices and initialie an empty array
            // The string "enum.adaptername." is removed (replaced with ""); keyName is then for example "room1" and not "enum.adaptername.room1"
            const _keyName = _key.replace("enum." + this.adaptername + ".", "");
            this.subscribedObjects[_keyName] = {};

            if (
              typeof element["common"] !== "undefined" &&
              typeof element["common"]["members"] !== "undefined" &&
              element["common"]["members"].length > 0
            ) {
              const elementMembers = element["common"]["members"];
              for (const _state in elementMembers) {
                this.subscribedStates.push(_state);
                this.subscribeForeignStates(_state);

                // Assign the the object info to the key as "enum.apternamer.room1.object1 = object1.info"
                // Subscribe to object changes

                this.subscribedObjects[_keyName][_state] = null;
                this.getForeignObjectAsync(_state)
                  .then(obj => {
                    if (obj === null) {
                      throw new Error("obj is null");
                    }
                    this.log.info("add foreign objects to json: " + _keyName + " - " + _state);
                    this.subscribedObjects[_keyName][_state] = obj;
                    this.log.info(JSON.stringify(this.subscribedObjects[_keyName][_state]));
                    this.subscribeForeignObjects(_state);
                  })
                  .catch(err => {
                    this.log.warn("Error getObject info: " + _state + " - Error: " + err);
                  });
              }
            }
          }
          resolve(this.subscribedObjects);
        })
        .catch(err => {
          this.log.warn("Error getEnum for adapter name: " + this.adaptername + " - Error: " + err);
          reject(err);
        });
    });
  }

  getObjectsAsync() {
    return new Promise((resolve, reject) => {
      this.getEnumAsync(this.adaptername)
        .then(_value => {
          // this.log.info("--- getObjects ---");
          // this.log.info(JSON.stringify(_value.result)); //  {"result":{"enum.natsclient.room1":{"_id":"enum.natsclient.room1","common":{"name":"room1","members":["deconz.0.Lights.1.on","zwave.0.NODE4.SWITCH_BINARY.Switch_1"],"icon":"","color":false},"t
          // this.log.info(JSON.stringify(_value.requestEnum)); // "enum.natsclient"
          const keys = Object.keys(_value.result);
          let keysCount = 0;
          asyncForEach(keys, async _key => {
            // JSON key: _key
            // JSON value: result[_key]
            const element = _value.result[_key];

            // Create key in object subscribed devices and initialie an empty array
            // The string "enum.adaptername." is removed (replaced with ""); keyName is then for example "room1" and not "enum.adaptername.room1"
            const _keyName = _key.replace("enum." + this.adaptername + ".", "");
            this.subscribedObjects[_keyName] = {};

            if (
              typeof element["common"] !== "undefined" &&
              typeof element["common"]["members"] !== "undefined" &&
              element["common"]["members"].length > 0
            ) {
              const elementMembers = element["common"]["members"];
              asyncForEach(elementMembers, async _state => {
                // Add _state to list of subscribed states and subscribe to state changes
                this.subscribedStates.push(_state);
                this.subscribeForeignStates(_state);

                // Assign the the object info to the key as "enum.apternamer.room1.object1 = object1.info"
                // Subscribe to object changes

                this.subscribedObjects[_keyName][_state] = null;
                await this.getForeignObjectAsync(_state)
                  .then(obj => {
                    if (obj === null) {
                      throw new Error("obj is null");
                    }
                    this.log.info("add foreign objects to json: " + _keyName + " - " + _state);
                    this.subscribedObjects[_keyName][_state] = obj;
                    this.log.info(JSON.stringify(this.subscribedObjects[_keyName][_state]));
                    this.subscribeForeignObjects(_state);
                  })
                  .catch(err => {
                    this.log.warn("Error getObject info: " + _state + " - Error: " + err);
                  });
              });
              keysCount = keysCount + 1;
              if (keys.length === keysCount) {
                resolve(this.subscribedObjects);
              }
            }
          });
        })
        .catch(err => {
          this.log.warn("Error getEnum for adapter name: " + this.adaptername + " - Error: " + err);
          reject(err);
        });
    });
  }

  async getObjects() {
    this.getEnumAsync(this.adaptername)
      .then(_value => {
        // this.log.info("--- getObjects ---");
        // this.log.info(JSON.stringify(_value.result)); //  {"result":{"enum.natsclient.room1":{"_id":"enum.natsclient.room1","common":{"name":"room1","members":["deconz.0.Lights.1.on","zwave.0.NODE4.SWITCH_BINARY.Switch_1"],"icon":"","color":false},"t
        // this.log.info(JSON.stringify(_value.requestEnum)); // "enum.natsclient"
        return asyncForEach(Object.keys(_value.result), async _key => {
          // JSON key: _key
          // JSON value: result[_key]
          const element = _value.result[_key];

          // Create key in object subscribed devices and initialie an empty array
          // The string "enum.adaptername." is removed (replaced with ""); keyName is then for example "room1" and not "enum.adaptername.room1"
          const _keyName = _key.replace("enum." + this.adaptername + ".", "");
          this.subscribedObjects[_keyName] = {};

          if (
            typeof element["common"] !== "undefined" &&
            typeof element["common"]["members"] !== "undefined" &&
            element["common"]["members"].length > 0
          ) {
            const elementMembers = element["common"]["members"];
            return asyncForEach(elementMembers, async _state => {
              // Add _state to list of subscribed states and subscribe to state changes
              this.subscribedStates.push(_state);
              this.subscribeForeignStates(_state);

              // Assign the the object info to the key as "enum.apternamer.room1.object1 = object1.info"
              // Subscribe to object changes

              this.subscribedObjects[_keyName][_state] = null;
              return this.getForeignObjectAsync(_state)
                .then(obj => {
                  if (obj === null) {
                    throw new Error("obj is null");
                  }
                  this.log.info("add foreign objects to json: " + _keyName + " - " + _state);
                  this.subscribedObjects[_keyName][_state] = obj;
                  this.log.info(JSON.stringify(this.subscribedObjects[_keyName][_state]));
                  this.subscribeForeignObjects(_state);
                })
                .catch(err => {
                  this.log.warn("Error getObject info: " + _state + " - Error: " + err);
                });
            });
          }
        });
      })
      .catch(err => {
        this.log.warn("Error getEnum for adapter name: " + this.adaptername + " - Error: " + err);
      });
  }

  /**
   * Get all deives from enum.antsclient to subscribe to
   */
  async getSubscribedObjectsAndStates() {
    return new Promise(resolve => {
      // Get all states from "enum.adaptername"
      // The enum object has only 2 levels (no sub-sub-...-level object); The "enum.adaptername" does not allow to have an iterative object like: room1 -> ( state1, state2, room3 -> ( state5, state 6 ) ), room2 -> state 3, ...

      this.getEnum(this.adaptername, (err, result, _enum) => {
        this.log.info("--- getEnum ROOMS ---");
        // this.log.info("--- get getSubscribedStates ---");
        // this.log.info(JSON.stringify(err));
        // this.log.info(JSON.stringify(result));
        // this.log.info(JSON.stringify(_enum)); // "enum.natsclient"
        // this.log.info("--- end getSubscribedStates ---");
        if (err !== null) {
          return this.log.warn("getEnum('" + this.adaptername + "') error: " + err);
        }
        if (result === null || result.length === 0) {
          return this.log.warn("getEnum('" + this.adaptername + "') result: " + result);
        }

        /* Loop throug the list of "enum.adaptername":
         * enum.adaptername (result) {
         *  room1: {
         *    state1,
         *    state2,
         *    state3
         *  },
         *  room2: {
         *    state2,
         *    state4,
         *    state5
         *  }
         * }
         */
        let resolveCounter = 0;
        for (const _key in result) {
          // this.log.info("-----");
          // this.log.info(JSON.stringify(result[_key]["common"]));

          // Create key in object subscribed devices and initialie an empty array
          // The string "enum.adaptername." is removed (replaced with ""); keyName is then for example "room1" and not "enum.adaptername.room1"
          const _keyName = _key.replace("enum." + this.adaptername + ".", "");
          this.subscribedObjects[_keyName] = {};

          // Temporary variable for enum object in enum.natsclient;
          // const _enum = result["room1"];
          const _enum = result[_key];
          if (
            typeof _enum["common"] !== "undefined" &&
            typeof _enum["common"]["members"] !== "undefined" &&
            _enum["common"]["members"].length > 0
          ) {
            // this.log.info("Devices: " + _enum["common"]["members"]);
            const devices = _enum["common"]["members"];

            // Iterate each "member" of enum.adapternamer.level1 (like "enum.apatername.room1")
            devices.forEach(_state => {
              // Add _state to list of subscribed states and subscribe to state changes
              this.subscribedStates.push(_state);
              this.subscribeForeignStates(_state);

              // Assign the the object info to the key as "enum.apternamer.room1.object1 = object1.info"
              // Subscribe to object changes
              this.getForeignObjectAsync(_state)
                .then(obj => {
                  if (obj === null) {
                    throw new Error("obj is null");
                  }
                  this.log.info("add foreign obecjt to json: " + _keyName + " - " + _state);
                  this.subscribedObjects[_keyName][_state] = obj;
                  this.log.info(JSON.stringify(this.subscribedObjects[_keyName][_state]));
                  this.subscribeForeignObjects(_state);
                })
                .catch(err => {
                  this.log.warn("Error getObject info: " + _state + " - Error: " + err);
                  this.subscribedObjects[_keyName][_state] = null;
                });
            });
          }
          resolveCounter = resolveCounter + 1;
        }
        if (resolveCounter === result.length) {
          resolve();
        }
      });
    });
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
    this.log.info("config option1: " + this.config.option1);
    this.log.info("config option2: " + this.config.option2);
    this.log.info("config natsconnection: " + this.config.natsconnection);

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
    this.getObjectsEachOf();

    // const natsServers = []; // TODO: Create array string in optopns to have multiple nats connection string adresses
    this.nc = NATS.connect({ url: this.config.natsconnection, json: true }); // TODO: json bool value as option
    // currentServer is the URL of the connected server.

    this.nc.on("connect", nc => {
      this.log.info("Connected to " + nc.currentServer.url.host);
      this.setState("info.connection", true, true);
      this.setState("info.server", nc.currentServer.url.host, true);
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
     * Publish:
     * (1) Inital State
     * (2) stateChange
     *
     */

    // Publish: (1) Inital State
    // Get the initale state status and publish it to the nats channels

    this.log.info("--- subscribed objects / states ---");
    // TODO: Check if initial message should be sent; check which channel should be used (prefix as well)
    this.nc.publish("iobroker.objects.initial", this.subscribedObjects, () => {
      this.log.info(
        "Initial messages confirmed; subscribed objects send as message to the nats cchannel: " +
          "iobroker.objects.initial"
      );
    });

    // Publish: (2) stateChange
    // this.on("stateChange", (id, state) => {
    // TODO: Use existing stateChange class func
    // TODO: Loop throug this.subscribedStates and sent message to channel to all matched devices in rooms as follows for example:
    // room1.deconz.light1
    // directoryXYZ.deconz.light1
    // Just add the name of the directory / room to the name of the device after looping throug the list of subscribed devices
    // this.log.info("stateChange " + id + " " + JSON.stringify(state));

    // you can use the ack flag to detect if state is command(false) or status(true)
    //   if (!state.ack) {
    //     this.log.info("ack is not set!");
    //   }
    //   this.publishToNatsChannel(id, state);
    // });

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
