"use strict"

const fs = require("fs-extra");

// settings
const sppf = require("../mixins/subproject.helper");
const resourcesDirectory = process.env.PATH_RESOURCES || sppf.subprojectPathFix(__dirname, "/../resources");
const settingsOrders = require(resourcesDirectory+"/settings/orders");
const settingsLocals = require(resourcesDirectory+"/settings/locals");
const settingsBusiness = require( resourcesDirectory+"/settings/business");
const navigationMain = require(resourcesDirectory+"/navigation/navigation-main");
const navigationFooter = require(resourcesDirectory+"/navigation/navigation-footer");

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



  getOriginalSiteSettings(type) {
    if (validSettingTypes.indexOf(type) > -1) {
      let result = {};

      switch (type) {
        case 'orders':
          result = {...settingsOrders};
          break;
        case 'locals':
          result = {...settingsLocals};
          break;
        case 'navigation-main':
          result = {...navigationMain};
          break;
        case 'navigation-footer':
          result = {...navigationFooter};
          break;
        default: // aka 'business'
          result = {...settingsBusiness};
          break;
      }

      return result;
    }
    
    return null;
  }
}