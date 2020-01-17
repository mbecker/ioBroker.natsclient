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
    this.subscribedDevices = {};
    this.adaptername = "natsclient"; // TODO: Replace with option for enum[this.option("enumname")]
  }

  /**
   * Get all deives from enum.antsclient to subscribe to
   * @returns {JSON}
   */
  async getSubscribedDevices() {
    return new Promise(resolve => {
      this.getEnum(this.adaptername, (err, result, _enum) => {
        // this.log.info("--- getEnum ROOMS ---");
        // this.log.info(JSON.stringify(err));
        // this.log.info(JSON.stringify(result));
        // this.log.info(JSON.stringify(_enum));
        if (err !== null) {
          return this.log.warn("getEnum('" + this.adaptername + "') error: " + err);
        }

        // const _result = result["enum.natsclient"]; // Getting the enum "enum.natsclient"; creating temp variable _result to loop throug
        for (const _key in result) {
          // this.log.info("-----");
          // this.log.info(JSON.stringify(result[_key]["common"]));

          // Create key in object subscribed devices and initialie ezmpty array
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
            devices.forEach(_device => this.subscribedDevices[_keyName].push(_device));
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
    await this.getSubscribedDevices();
    this.log.info("--- subscribed devices ---");
    for (const _key in this.subscribedDevices) {
      this.log.info("- " + _key);
      this.subscribedDevices[_key].forEach(_device => this.log.info("-- " + _device));
    }

    // const natsServers = []; // TODO: Create array string in optopns to have multiple nats connection string adresses
    let nc = NATS.connect({ url: this.config.natsconnection, json: true }); // TODO: json bool value as option
    // currentServer is the URL of the connected server.

    nc.on("connect", () => {
      this.log.info("Connected to " + nc.currentServer.url.host);
      this.setState("info.connection", true);

      nc.on("error", err => {
        this.log.warn(err);
        this.setState("info.connection", false);
        this.setState("info.server", "");
      });
    });

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
