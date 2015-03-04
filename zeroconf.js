// Service discovery

var mdns = require('mdns');
var settings = require("./settings");

var text_record = {
  "url" : settings.api.url,
  "version" : settings.api.version,
  json : false,
  text : true,
  author : "Andrew Cuddon"
};

var options = {
    name : "Marantz SR7400 web service",
    txtRecord : text_record
};

var port = settings.httpserver.port;
var servicetype = mdns.tcp('http');     // http service over tcp (_http._tcp)

function createAdvertisement(servicetype, port, options) {
  try {
    var adv = mdns.createAdvertisement(servicetype, port, options);
    adv.on('error', handleError);
    adv.start();
  } catch (ex) {
    handleError(ex);
  }
}

function handleError(error) {
    /*
        Automatically restart the advertisement when an unknown error occurs.
        This happens for example when the systems mdns daemon is currently down.
        All other errors, like bad parameters, ctrl-c. are treated as fatal.
    */
  switch (error.errorCode) {
    case mdns.kDNSServiceErr_Unknown:
      console.warn(error);
      setTimeout(createAdvertisement(servicetype, port, options), 10000);
      break;
    default:
      throw error;
  } 
}

function advertise() {
  createAdvertisement(servicetype, port, options);
}

// Expose key functions and variables to other modules
exports.advertise = advertise;
exports.createAdvertisement = createAdvertisement;


// Test
//createAdvertisement(servicetype, port, options);
// or
//advertise();
