/*
  server.js
  
  Marantz SR7400 web service
  
  AppVersion 1.1
  
  TTDs
    Jun a macro
    Option for the request to return a JSON response (?return=json) rather than a simple text response
    Automated service discovery for OpenHAB2
    View command and result history/log
  
  Changes from 1.0
    Added service discovery via zeroconf module
    Ability to request configuration information (returns json)
    Some refactoring


  API
    /api/requesttpe/requeststring               --> returns a string
    (Not yet implemented) /api/requesttpe/requeststring?return=json   --> returns json (optional)
  
  Device commands and status requests
    /api/command/turn_power_on
    /api/command/get_volume_level
  
  Macros
    /api/macro/watch_tv_with_surround_sound
    /api/macro/run/commands   (Not yet implemented)- commands is a list of commands
    
  Config
    /api/config/settings
    /api/config/macros
    /api/config/protocol
    /api/config/mappings
    /api/config/help

  Logs (all commands return the log)
    /api/logs/get
    /api/log/get
    /api/history/get

*/

"use strict";

// Import libraries
var http = require('http');
var url = require("url");

// Import App modules
var sr7400 = require('./sr7400');       // SR7400 driver
var zeroconf = require('./zeroconf');   // SR7400 driver
var macro = require('./macro');         // Macro module
var volume = require('./volume');       // Volume module dor setting volume to a specific value
var help = require('./help');           // API help

// Configuration
var mappings = require('./mappings');       // e.g. DSS -> TBOX
var valid_commandmappings = Object.keys(mappings.commandmappings);
var valid_statusmappings = Object.keys(mappings.statusmappings);
var macros = require('./macros.json');
var valid_macros = Object.keys(macros.macros);

// Load settings
var settings = require('./settings.json');

// Create and start the HTTP server for receiving command requests
var server = http.createServer();
server.listen(settings.httpserver.port, settings.httpserver.ip, 511, function() {
  // Now that the server has started listening for HTTP requests start zero conf advertising
  zeroconf.advertise();
  console.log('HTTP server running at http://' + settings.httpserver.ip + ":" + settings.httpserver.port);
});
console.log("\n\n---------------------- Marantz SR7400 Web Service---------------------- \n");

// Listen for HTTP requests
server.on('request', function (request, response) {
  /*
    request = {
      socket: { … },
      connection: { … },
      httpVersion: '1.1',
      complete: false,
      headers:
        {
          host: 'localhost:8080',
          connection: 'keep-alive',
          'cache-control': 'max-age=0',
          'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) ...',
          accept: 'application/xml,application/xhtml+xml ...',
          'accept-encoding': 'gzip,deflate,sdch',
          'accept-language': 'en-US,en;q=0.8',
          'accept-charset': 'ISO-8859-1,utf-8;q=0.7,*;q=0.3'
         },
      trailers: {},
      readable: true,
      url: '/',
      method: 'GET',
      statusCode: null,
      client:  { … },
      httpVersionMajor: 1,
      httpVersionMinor: 1,
      upgrade: false
    }
  */

  var err = false;
  
  // Confirm a GET request, otherwise return an error
  if (request.method != 'GET' ) {
    err = "Invalid http method: " + request.method;
    errorresponse(500, err,response);
    return;
  }
  
  // Find parts of the URL path of the request
  var url_parts = url.parse(request.url, true);
  /*
    e.g.
    request.url = 'http://user:pass@host.com:8080/p/a/t/h?query=string#hash'
    url_parts = {
      href: 'http://user:pass@host.com:8080/p/a/t/h?query=string#hash',
      protocol: 'http:',
      host: 'user:pass@host.com:8080',
      auth: 'user:pass',
      hostname: 'host.com',
      port: '8080',
      pathname: '/p/a/t/h',
      search: '?query=string',
      query: { query: 'string' },
      hash: '#hash',
      slashes: true
    }
    
    pathname = /api/requesttype/requeststring
      requesttype = 'command|macro|config'
      e.g. /api/command/get_volume_level
            /api/config/protocol
  */
  // Extract the command
  var requesttype = "";
  var requeststring = "";
  var leadin = "";
  var args = url_parts.pathname.split("/");
  //console.log("Arguments: " + args + " (" + args.length + ")" );
  
  // Check for correct number of api arguments
  if (args.length == 4) {
    leadin = args[1].toLowerCase();
    requesttype = args[2].toLowerCase();
    requeststring = args[3].toLowerCase();
  } else {
      err = "Invalid request. Incorrect number of arguments: " + request.url;
      errorresponse(500, err,response);
      return;
  }

  // Check the api leadin
  if (leadin != settings.api.leadin) {
      // invalid leadin to the the api (e.g. must be /api)
      err = "Invalid request (api leadin): " + request.url;
      errorresponse(500, err,response);
      return;
  }

  if (requesttype == 'command') {
    // Send the command to the SR7400 and wait for a response
    if (requeststring.substr(0,14) == 'set_volume_to_') {
      // Set to specific volume command (not supported by the reciver so use teh workaround)
      var requestedvolume = parseInt(requeststring.substring(14), 10);
      volume.setTo(requestedvolume)       // Promise
        .then(function(result){
          // Volume command completed OK
          response.writeHead(200, {'Content-Type': 'text/plain'});
          response.write("ACK");
          response.end();
          // Save the result to the log
          console.log('\n**** SR7400 Command: ' + requeststring + ', SR7400 Response: ' + result + ' ****\n');
        })
        .fail(function(err){
          // Error processing the volume command
          response.writeHead(200, {'Content-Type': 'text/plain'});
          response.write(err);
          response.end();
          // Save the result to the log
          console.log('\n**** SR7400 Command: ' + requeststring + ', SR7400 Response: ' + err + ' ****\n');
        })
        .done();
    } else {
      // Normal command that is in the protocol
      
      requeststring = requeststring.toUpperCase();  // interim until we make all commands lower case

      // Apply any command mappings e.g. SELECT_INPUT_TBOX -> SELECT_INPUT_DSS
      if (valid_commandmappings.indexOf(requeststring) >= 0) {
          // A mapping exists so apply it
          requeststring = mappings.commandmappings[requeststring];
      }

      // Now send the command to the SR7400 (Uses promises)
      sr7400.p_send(requeststring)
        .then(function(result){
          // Valid response from the SR7400
          // Ensure it is a sting (esp for volume levels etc)
          result = result.toString();
          
          // Apply any mappings to the response // e.g. DSS -> TBOX
          if (valid_statusmappings.indexOf(result) >= 0) {
              result = mappings.statusmappings[result];
          }
          
          response.writeHead(200, {'Content-Type': 'text/plain'});
          response.write(result);
          response.end();
          
          // Save the result to the log
          console.log('\n**** SR7400 Command: ' + requeststring + ', SR7400 Response: ' + result + ' ****\n');
        })
        .fail(function(err){
          errorresponse(500, err, response);
          // Save the result to the log
          console.log('\n**** SR7400 Command: ' + requeststring + ', SR7400 Response: ' + err + ' ****\n');
        })
        .done();
    }
  } else if (requesttype == 'macro') {
    // Use the promise version of Macro
      if (valid_macros.indexOf(requeststring) >= 0) {
          // valid macro
          var commandlist = macros.macros[requeststring].commands;
          // Run the macros (Note: macro is a Promise
          macro.run(commandlist)
            .then(function(result){
              // All macro commands completed OK
              response.writeHead(200, {'Content-Type': 'text/plain'});
              response.write("ACK");
              response.end();
              // Save the result to the log
              console.log('\n**** SR7400 Command: ' + requeststring + ', SR7400 Response: ' + result + ' ****\n');
            })
            .fail(function(err){
              // One or more macros commands had an error
              response.writeHead(200, {'Content-Type': 'text/plain'});
              response.write(err);
              response.end();
              // Save the result to the log
              console.log('\n**** SR7400 Command: ' + requeststring + ', SR7400 Response: ' + err + ' ****\n');
            })
            .done();
      } else {
          // The macro does not exist in the protocol
          err = "Error - macro not found in the SR7400 protocol: " + requeststring;
          errorresponse(500, err, response);
          // Save the result to the log
          console.log('\n**** SR7400 Command: ' + requeststring + ', SR7400 Response: ' + err + ' ****\n');
          return;
      }
  } else if (requesttype == 'config') {
    // Request to provide configuration information (assume json response)
    var configitem = {};
    
    switch(requeststring) {
      case 'settings':
        configitem = settings;
        break;
      case 'protocol':
        configitem = sr7400.protocol;
        break;
      case 'macros':
        configitem = macros;
        break;
      case 'mappings':
        configitem = mappings;
        break;
      case 'help':
        configitem = help;
        break;
      default:
        configitem = {"error" : "Unknown configuration item requested", "request" : request.url};
    }
    response.writeHead(200, {'Content-Type': 'application/json'});
    response.write(JSON.stringify(configitem));
    response.end();
  }
});

server.on('close', function (request, response) {
  // Do nothing at this stage
});

function errorresponse(code, err, resp) {
  // Return an HTTP error response
  resp.writeHead(code, {"Content-Type": "text/plain"});
  resp.end(err + "\n");
}

