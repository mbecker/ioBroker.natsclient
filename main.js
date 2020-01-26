"use strict";

/*
 * Created with @iobroker/create-adapter v1.20.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");
const NATS = require("nats");

// Load your modules here, e.g.:
// const fs = require("fs");

/* Option parameters in admin
 *
 * this.config.natsconnection;
 * this.config.shouldUsePrefixForChannelName;
 */

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
    this.subscribedDevices = {};
    this.adaptername = "natsclient"; // TODO: Replace with option for enum[this.option("enumname")]
  }

  /**
   * Publis state to NATS channel
   * @param {string} device
   * @param {ioBroker.Object | null | undefined} state
   */
  publishToNatsChannel(device, state) {
    device = this.config.shouldUsePrefixForChannelName + device;
    // Publish to nats channel
    if (this.nc === null) {
      this.log.warn("nats client connection is null");
    } else {
      this.log.info(`Publish state of object to nats channel: ${device} - ${JSON.stringify(state)}`);
      this.nc.publish(device, state, () => {
        this.log.info("Publish messages confirmed by nats server");
      });
    }
  }

  /**
   * Get all deives from enum.antsclient to subscribe to
   */
  async getSubscribedStates() {
    return new Promise(resolve => {
      // Get all states from "enum.adaptername"
      this.getEnum(this.adaptername, (err, result, _enum) => {
        // this.log.info("--- getEnum ROOMS ---");
        // this.log.info(JSON.stringify(err));
        // this.log.info(JSON.stringify(result));
        // this.log.info(JSON.stringify(_enum));
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
        for (const _key in result) {
          // this.log.info("-----");
          // this.log.info(JSON.stringify(result[_key]["common"]));

          // Create key in object subscribed devices and initialie an empty array
          // The string "enum.adaptername." is removed (replaced with ""); keyName is then for example "room1" and not "enum.adaptername.room1"
          const _keyName = _key.replace("enum." + this.adaptername + ".", "");
          this.subscribedDevices[_keyName] = [];

          const _enum = result[_key]; // Temporary variable for enum object in enum.natsclient
          if (
            typeof _enum["common"] !== "undefined" &&
            typeof _enum["common"]["members"] !== "undefined" &&
            _enum["common"]["members"].length > 0
          ) {
            // this.log.info("Devices: " + _enum["common"]["members"]);
            const devices = _enum["common"]["members"];
            devices.forEach(_device => {
              this.subscribedDevices[_keyName].push(_device);
              
              this.getForeignStateAsync(_device).then(obj => {
                if (obj === null) {
                  throw new Error("obj is null");
                }
                this.log.info(JSON.stringify(obj));
              }).catch(err => {
                this.log.warn("Error getObject info: " + _device + " - Error: " + err);
              });
            

              

              // this.getForeignObject(_device, (err, obj) => {
                
              //   this.log.info("getForeignObject: " + _device);
              //   if (err !== null) {
              //     this.log.warn("Error getObject info: " + _device + " - Error: " + err);
              //     return;
              //   }
              //   if (obj === null) {
              //     this.log.warn("Error getObject object is null");
              //     return;
              //   }
              //   this.log.info(JSON.stringify(obj));
              // });


            });
          }
        }
        resolve();
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
    await this.getSubscribedStates();

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
    // Subscribe to state changes
    this.log.info("--- subscribed devices ---");
    for (const _key in this.subscribedDevices) {
      this.log.info("- " + _key);
      this.subscribedDevices[_key].forEach(_device => {
        this.log.info("-- " + _device);

        // Get initial state of _device
        this.getForeignState(_device, (err, state) => {
          if (err !== null) {
            this.log.warn("Error get foreign state " + _device + ": " + err);
            return;
          }

          this.publishToNatsChannel(_device, state);
        });

        this.getForeignStateAsync(_device).then(obj => {
          if (obj === null) {
            throw new Error("obj is null");
          }
          this.nc.publish("iobroker.objects." + device, obj, () => {
            this.log.info("Publish obj confirmed by nats server");
          });
        }).catch(err => {
          this.log.warn("Error getObject info: " + _device + " - Error: " + err);
        });

        // ioBroker.adapater subscribe to _device updates
        this.subscribeForeignStates(_device);
      });
    }

    // Publish: (2) stateChange
    // this.on("stateChange", (id, state) => {
    // TODO: Use existing stateChange class func
    // TODO: Loop throug this.subscribedDevices and sent message to channel to all matched devices in rooms as follows for example:
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
    await this.setObjectAsync("testVariable", {
      type: "state",
      common: {
        name: "testVariable",
        type: "boolean",
        role: "indicator",
        read: true,
        write: true
      },
      native: {}
    });

    // in this template all states changes inside the adapters namespace are subscribed
    this.subscribeStates("*");

    /*
		setState examples
		you will notice that each setState will cause the stateChange event to fire (because of above subscribeStates cmd)
		*/
    // the variable testVariable is set to true as command (ack=false)
    await this.setStateAsync("testVariable", true);

    // same thing, but the value is flagged "ack"
    // ack should be always set to true if the value is received from or acknowledged from the target system
    await this.setStateAsync("testVariable", { val: true, ack: true });

    // same thing, but the state is deleted after 30s (getState will return null afterwards)
    // await this.setStateAsync("testVariable", { val: true, ack: true, expire: 30 });

    // examples for the checkPassword/checkGroup functions
    let result = await this.checkPasswordAsync("admin", "iobroker");
    this.log.info("check user admin pw iobroker: " + result);

    result = await this.checkGroupAsync("admin", "admin");
    this.log.info("check group user admin group admin: " + result);
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
      // The object was changed
      this.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
    } else {
      // The object was deleted
      this.log.info(`object ${id} deleted`);
    }
  }

  /**
   * Is called if a subscribed state changes
   * @param {string} id
   * @param {ioBroker.State | null | undefined} state
   */
  onStateChange(id, state) {
    this.getObject(id, (err, obj) => {
      if (err !== null) {
        this.log.warn("Error getObject info: " + id + " - Error: " + err);
        return;
      }
      if (obj === null) {
        this.log.warn("Error getObject object is null");
        return;
      }
      this.log.info(JSON.stringify(obj));
    });

    if (state) {
      // The state was changed
      this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
    } else {
      // The state was deleted
      this.log.info(`state ${id} deleted`);
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
