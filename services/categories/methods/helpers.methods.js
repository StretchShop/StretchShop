"use strict";

const slug = require("slug");

module.exports = {

	/**
	 * Methods
	 */

	methods: {

    fixEntityDates(entity) {
      if ( entity.dates ) {
        Object.keys(entity.dates).forEach(function(key) {
          let date = entity.dates[key];
          if ( date && date!=null && date.trim()!="" ) {
            entity.dates[key] = new Date(entity.dates[key]);
          }
        });
      }
      if ( entity.activity ) {
        Object.keys(entity.activity).forEach(function(key) {
          let date = entity.activity[key];
          if ( date && date!=null && date.trim()!="" ) {
            entity.activity[key] = new Date(entity.activity[key]);
          }
        });
      }

      return entity;
    }

  }
}
