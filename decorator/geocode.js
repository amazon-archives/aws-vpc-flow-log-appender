/**
 
Copyright 2017 Amazon.com, Inc. or its affiliates. All Rights Reserved.

Licensed under the Apache License, Version 2.0 (the "License"). You may not use this file
except in compliance with the License. A copy of the License is located at

    http://aws.amazon.com/apache2.0/
 
or in the "license" file accompanying this file. This file is distributed on an "AS IS"
BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
License for the specific language governing permissions and limitations under the License.
 
 */

'use strict'

/**
 * Simple class to help geocode IP addresses using freegeoip.net.
 * 
 * NOTE: this is intended for demo purposes only.
 */

const http = require('http');

const serviceHost = 'freegeoip.net';
const servicePath = '/json';

module.exports = (ipAddress) => {
  let options = {
    hostname: serviceHost,
    path:     `${servicePath}/${ipAddress}`,
    headers:  {
                'Content-Type': 'application/json'
              }
  };

  return new Promise( (resolve, reject) => {

    http.get(options, (res) => {
      /**
       * When the geocoding service returns a 403, we have exceeded the rate
       * limit allowed. Instead of throwing an error, just return a null
       * response here so that execution can continue otherwise.
       */
      if (res.statusCode === 403) {
        console.warn('[geocoder] Exceeded rate limit');
        resolve(null);
        return;
      }
      else if (res.statusCode !== 200) {
        console.error('[geocoder] Received bad error code ' +res.statusCode);
        reject( new Error(`Request failed with status code ${res.statusCode}`) );
        return;
      }

      res.setEncoding('utf8');
      let data = '';
      res.on('data', (chunk) => data += chunk );
      res.on('end',  () => {
        try {
          let json = JSON.parse(data);
          resolve(json);
        } catch(e) {
          reject(e);
        }
      });
    })
    .on('error', (e) => {
      reject(e);
    });

  });
}