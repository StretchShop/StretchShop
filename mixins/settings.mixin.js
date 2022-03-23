"use strict"

const fs = require("fs-extra");

// settings
const sppf = require("../mixins/subproject.helper");
const resourcesDirectory = process.env.PATH_RESOURCES || sppf.subprojectPathFix(__dirname, "/../resources");

const validSettingTypes = [
  'business', 
  'orders', 
  'locals',
  'navigation-main', 
  'navigation-footer'
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


module.exports = {
  
  /**
   * Defines and returns group for passed type
   * 
   * @param {String} type 
   * @returns {String}
   */
   getTypeGroup(type) {
    let result = 'settings'; // aka 'business'
    switch (type) {
      case 'orders':
        result = 'settings';
        break;
      case 'locals':
        result = 'settings';
        break;
      case 'navigation-main':
        result = 'navigation';
        break;
      case 'navigation-footer':
        result = 'navigation';
        break;
      default: 
        result = 'settings';
        break;
    }
    return result;
  },

  
  /**
   * 
   * @param {String} type 
   * @param {Boolean} internal 
   * @returns {Object|null}
   */
  getSiteSettings(type, internal) {
    internal = (typeof internal !== "undefined" && internal === true) ? internal : false;
    if (validSettingTypes.indexOf(type) > -1) {
      let result = {};

      switch (type) {
        case 'orders':
          result = this.getLatestData(type, 'settings');
          break;
        case 'locals':
          result = this.getLatestData(type, 'settings');
          break;
        case 'navigation-main':
          result = this.getLatestData(type, 'navigation');
          break;
        case 'navigation-footer':
          result = this.getLatestData(type, 'navigation');
          break;
        default: // aka 'business'
          result = this.getLatestData(type, 'settings');
          result = {...result};
          if (!internal) { 
            delete result.editableSettings;
          }
          break;
      }

      return result;
    }
    
    return null;
  },


  /**
   * 
   * @param {String} type 
   * @param {String} group 
   * @returns {Object}
   */
  getLatestData(type, group) {
    let result = null;

    let settingsTemp = settings;
    if (group === "navigation") {
      settingsTemp = navigation;
    }

    if ( typeof settingsTemp[type] !== "undefined" && settingsTemp[type] !== null) {
      console.log(" -----> loading CACHED settings");
      result = {...settingsTemp[type]};
    } else {
      console.log(" -----> loading ORIG settings");
      settingsTemp[type] = this.getOriginalSiteSettings(type);
      result = settingsTemp[type];
    }

    return result;
  },


  /**
   * 
   * @param {String} type 
   * @returns {Promise}
   */
  readSettingFileSync(type) {
    const path = resourcesDirectory + "/" + this.getTypeGroup(type) + "/" + type + ".jsonc"

    try {
      console.log('xxxxxx ->>>:', path);
      // read json file into string
      let data = fs.readFileSync(path).toString();
      // replace comments
      data = data.replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, g) => g ? "" : m);
      // parse string
      data = JSON.parse(data);
      return data;
    } catch (err) {
      console.error("readSettingFileSync: ", err);
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
      let result = false;
      try {
        data = JSON.stringify(JSON.parse(data));
      } catch (e) {
        console.error('settings.mixin setSiteSettings JSON error: ', e);
      }

      return this.updateSettings(type, this.getTypeGroup(type), data);
    }
    
    return false;
  },



  updateSettings(type, group, data) {
    if (group === 'settings' && settings[type]) {
      // update variable
      settings[type] = {...settings[type], ...data};
      return this.updateSettingsFile(type, group, settings[type]);
    } else if (group === 'navigation' && navigation[type]) {
      // update variable
      settings[type] = {...settings[type], ...data};
      return this.updateSettingsFile(type, group, settings[type]);
    }
  },


  updateSettingsFile(type, group, data) {
    let dataStringified = JSON.stringify(data, null, 2);
    /* remove double quotes (") from parameters (have colon : after)
    but only if name of parameter doesn't contain dot (.) */
    const dataReady = dataStringified.replace(/"([^".]+)":/g, '$1:');
    const path = resourcesDirectory + "/" + group + "/" + type + ".jsonc"
    console.log("_____ path:", path);

    fs.readFile(path)
    .then(file => {
      file = file.toString();
      console.log("_____ file:", file);
      if (file && file.indexOf("module.exports") > -1) {
        let fileSplit = file.split("module.exports");
        if (fileSplit && fileSplit[0]) {
          return [
            fileSplit[0] + "module.exports = ",
            "",
            ";\n"
          ]
        }
      }
      return null;
    })
    .then(readed => {
      if (readed.constructor === Array && readed.length === 3) {
        readed[1] = dataReady;
        const newContent = readed.join("");
        return fs.writeFile(path, newContent)
        .then(result => {
          return result;
        })
        .catch(err => {
          this.logger.error('settings.mixin updateSettingsFile write error: ', error);
        });
      } else {

      }
    })
    .catch(err => {
      console.error("settings.mixin updateSettingsFile error:", err);
    });
    
  }
}