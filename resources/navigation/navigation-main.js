"use strict";

module.exports = {
  main: {
    items: [
      {
        codename: "home",
        typeName: "--link",
        slugParams: "/",
        langs: {
          sk: {
            name: "Home"
          }, 
          en: {
            name: "Domov",
          }
        }
      }, 
      {
        codename: "info",
        typeName: "pageDetailShort",
        slugParams: {
          slug: "info"
        },
        langs: {
          sk: {
            name: "Info"
          }, 
          en: {
            name: "Info",
          }
        }
      }, 
      {
        codename: "products",
        typeName: "productsHome",
        slugParams: null,
        langs: {
          sk: {
            name: "Produkty"
          }, 
          en: {
            name: "Products",
          }
        }
      }, 
      {
        codename: "services",
        typeName: "servicesHome",
        slugParams: "services",
        langs: {
          sk: {
            name: "Služby"
          }, 
          en: {
            name: "Services",
          }
        }
      }
    ]
  }
};
