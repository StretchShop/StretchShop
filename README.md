![](public/assets/_site/StretchShop-1800-whitebg.png)

# StretchShop
StretchShop is something most would call e-shop. It's created with simple goal - bring free but smart tool for someone, who wants to bring business online.

It's fast & scalable e-business REST API backend (with compiled frontend included) based on node.js [Moleculer framework](https://moleculer.services/), which makes it easy to run as monolithic or microservices application.

See https://stretchshop.app/ for working online demo with almost 100k of generated demo products in categories and cart, with simple price and name filter. Hosted on a commercial cloud, running as docker microservices application without caching results to test the clean performance.

## Quick start
There are 3 instalation options:

  1. [npm](#quick-guide-to-run-with-npm) - quick and easy.
  2. [Docker](#quick-guide-to-run-with-docker) - for bigger load and more serious usage.
  3. [Git](#quick-guide-for-developers) - for contributors and developers.

### Quick guide to run with **npm**

Before trying to run app using npm, make sure you have:
1. **Node.js** with **npm** installed
2. **MongoDB** running and listening on default port 27017 (if you have docker, you can get it running using this `docker container run -d --name mongo mongo`)

### Once you have all that's required
- in terminal simply run `npm i stretchshop`

For other options visit Stretchshop Wiki https://github.com/Wradgio/StretchShop/wiki/Installation


## API documentation
See https://app.swaggerhub.com/apis/marcelzubrik/StretchShop_Front/1.0.0-oas3 for API documentation of StretchShop REST calls - in progress.
