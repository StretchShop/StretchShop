"use strict"

const fs = require("fs-extra");

// settings
const sppf = require("../mixins/subproject.helper");
const resourcesDirectory = process.env.PATH_RESOURCES || sppf.subprojectPathFix(__dirname, "/../resources");

const validSettingTypes = [
  "business", 
  "orders", 
  "locals",
  "navigation-main", 
  "navigation-footer"
];

let settings = {
  orders: null,
  locals: null,
  business: null
};
let navigation = {
  main: null,
  footer: null
}
let settingsMixinContext = null;


module.exports = {

  setContext(ctx) {
    settingsMixinContext = ctx;
  },

  clearCachedSettings() {
    settings = {
      orders: null,
      locals: null,
      business: null
    };
    navigation = {
      main: null,
      footer: null
    };
  },
  
  /**
   * Defines and returns group for passed type
   * 
   * @param {String} type 
   * @returns {String}
   */
   getTypeGroup(type) {
    let result = "settings"; // aka "business"
    switch (type) {
      case "orders":
        result = "settings";
        break;
      case "locals":
        result = "settings";
        break;
      case "navigation-main":
        result = "navigation";
        break;
      case "navigation-footer":
        result = "navigation";
        break;
      default: 
        result = "settings";
        break;
    }
    return result;
  },


  /**
   * 
   * @param {String} type 
   * @param {Boolean} internal 
   * @param {String} extraPath
   * @returns {Object|null}
   */
  getSiteSettings(type, internal, extraPath) {
    internal = (typeof internal !== "undefined" && internal === true) ? internal : false;
    extraPath = (typeof extraPath !== "undefined" && extraPath !== "") ? extraPath : "";
    if (extraPath === "" && settingsMixinContext?.meta?.extraPath !== "") {
      extraPath = settingsMixinContext?.meta?.extraPath;
    }
    if (validSettingTypes.indexOf(type) > -1) {
      let result = {};

      switch (type) {
        case "orders":
          result = this.getLatestData(type, "settings", extraPath);
          break;
        case "locals":
          result = this.getLatestData(type, "settings", extraPath);
          break;
        case "navigation-main":
          result = this.getLatestData(type, "navigation", extraPath);
          break;
        case "navigation-footer":
          result = this.getLatestData(type, "navigation", extraPath);
          break;
        default: // aka "business"
          result = this.getLatestData(type, "settings", extraPath);
          result = {...result};
          if (!internal) { 
            delete result.editableSettings;
          }
          break;
      }

      if (!internal) {
        result = this.removeDynamicData(type, result);
      }

      return result;
    }
    
    return null;
  },


  /**
   * 
   * @param {String} type 
   * @param {String} group 
   * @param {String} extraPath
   * @returns {Object}
   */
  getLatestData(type, group, extraPath) {
    let result = null;

    let settingsTemp = settings;
    if (group === "navigation") {
      settingsTemp = navigation;
    }

    if ( typeof settingsTemp[type] !== "undefined" && settingsTemp[type] !== null) {
      // loading CACHED settings
      result = {...settingsTemp[type]};
    } else {
      // loading ORIG settings
      settingsTemp[type] = this.getOriginalSiteSettings(type, extraPath);
      result = settingsTemp[type];
    }

    return result;
  },


  /**
   * 
   * @param {String} type 
   * @param {String} extraPath
   * @returns {Promise}
   */
  readSettingFileSync(type, extraPath) {
    extraPath = (typeof internal !== "undefined" && extraPath !== "") ? extraPath + "/" : "";

    const path = resourcesDirectory + "/" + extraPath + this.getTypeGroup(type) + "/" + type + ".json"

    try {
      // read json file into string
      let data = fs.readFileSync(path).toString();
      // replace comments
      data = data.replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, g) => g ? "" : m);
      // parse string
      data = JSON.parse(data);
      return data;
    } catch (err) {
      console.error("settings.mixin readSettingFileSync readFileSync error: ", err);
    }
    
  },


  /**
   * 
   * @param {String} type 
   * @returns {Object}
   */
  getOriginalSiteSettings(type) {
    if (validSettingTypes.indexOf(type) > -1) {
      return this.readSettingFileSync(type);
    }
    
    return null;
  },

  
  /**
   * 
   * @param {String} type 
   * @param {Object} data 
   * @returns {Promise}
   */
  setSiteSettings(type, data) {
    if (validSettingTypes.indexOf(type) > -1) {
      try {
        data = JSON.parse(JSON.stringify(data));
      } catch (e) {
        console.error("settings.mixin setSiteSettings JSON error: ", e);
      }

      return this.updateSettings(type, this.getTypeGroup(type), data);
    }
    
    return false;
  },


  /**
   * Update variables and file with new data
   * 
   * @param {String} type 
   * @param {String} group 
   * @param {Object} data 
   * @returns {Promise}
   */
  updateSettings(type, group, data) {
    // update variable
    if (group === "navigation") {
      navigation[type] = {...navigation[type], ...data};
      return this.updateSettingsFile(type, group, navigation[type]);
    }
    settings[type] = {...settings[type], ...data};
    return this.updateSettingsFile(type, group, settings[type]);
  },


  /**
   * Update file with new data
   * 
   * @param {String} type 
   * @param {String} group 
   * @param {Object} data 
   * @returns {Promise}
   */
  updateSettingsFile(type, group, data) {
    data = this.addDynamicData(type, data);
    const path = resourcesDirectory + "/" + group + "/" + type + ".json"
    console.log("settings.mixin updateSettingsFile path:", path);
    console.log("settings.mixin updateSettingsFile data:", data);

    return fs.writeJson(path, data, { spaces: 2 })
    .then(() => {
      return this.removeDynamicData(type, data);
    })
    .catch(err => {
      console.error("settings.mixin updateSettingsFile write error: ", err);
    });
  },


  /**
   * Add dynamic data to selected setting types
   * 
   * @param {String} type 
   * @param {Object} data 
   * @returns {Object}
   */
  addDynamicData(type, data) {
    if (type === "orders") {
      data.sendingOrder = {
        "url": process.env.SENDING_ORDER_URL,
        "port": process.env.SENDING_ORDER_PORT,
        "login": process.env.SENDING_ORDER_LOGIN,
        "password": process.env.SENDING_ORDER_PWD
      };
      data.availablePaymentActions = [
        "paypalOrderGeturl",
        "paypalResult",
        "paypalWebhook",
        "stripeOrderPaymentintent",
        "stripeOrderSubscription",
        "stripeWebhook"
      ];
    }
    return data;
  },
  /**
   * Remove dynamic data from selected setting types
   * 
   * @param {String} type 
   * @param {Object} data 
   * @returns {Object}
   */
  removeDynamicData(type, data) {
    if (type === "orders") {
      if (data.sendingOrder) {
        delete data.sendingOrder;
      }
      if (data.availablePaymentActions) {
        delete data.availablePaymentActions;
      }
    }
    return data;
  }

}