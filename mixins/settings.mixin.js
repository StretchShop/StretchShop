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


module.exports = {
  getSiteSettings(type, internal) {
    internal = (typeof internal !== "undefined" && internal === true) ? internal : false;
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
          if (!internal) { 
            delete result.editableSettings;
          }
          break;
      }

      return result;
    }
    
    return null;
  }
}