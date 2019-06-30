# StretchShop
Fast &amp; scalable e-business REST API backend based on [Moleculer framework](https://moleculer.services/), which makes it easy to run as monolithic or microservices application.

Try https://stretchshop.app/ for online demo with almost 100k of generated products in categories and cart, with simple price and name filter. Hosted on a commercial cloud, running as docker microservices application without caching results to test the clean performance.

## Installation
It's a node.js application based on Moleculer so same rules apply:
* For development, just run ```npm install``` - after dependecies are downloaded, run ```npm run dev``` and you are ready to play on http://localhost:8080/ . 
* For production you can build your own docker image or you can download existing from https://hub.docker.com/r/wradgio/stretchshop . Please keep in mind, that included frontend application is just production build of stretchshop.app demo and you may need to build your own, or contact me for more options.

## API documentation
See https://app.swaggerhub.com/apis/marcelzubrik/StretchShop_Front/1.0.0-oas3 for API documentation of StretchShop REST calls - still in progress.
