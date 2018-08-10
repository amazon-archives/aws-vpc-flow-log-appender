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
const SSM = require('aws-sdk/clients/ssm');
const axios = require('axios');

const serviceHost = 'api.ipstack.com';

let ssm = null;
let apiKey = null;

/**
 * 
 */
const getApiKey = async() => {
  if (!ssm) { ssm = new SSM({ region: process.env.AWS_REGION }) }

  const params = {
    Name: process.env.GEOLOCATION_API_KEY_NAME,
    WithDecryption: true
  }

  let result = await ssm.getParameter(params).promise()
  if (result && result.Parameter) {
    return result.Parameter.Value
  } else {
    throw Error(`API key not found in SSM (${process.env.GEOLOCATION_API_KEY_NAME})`)
  }
}

/**
 * 
 * @param {String} ipAddress 
 */
module.exports = async (ipAddress) => {
  if (!apiKey) { apiKey = await getApiKey() }

  let response = await axios.get(`http://${serviceHost}/${ipAddress}?access_key=${apiKey}`)
  console.log(JSON.stringify(response.data))
  if (response.status !== 200 || !response.data.success) {
    console.warn('[geocode] received bad response: ' +response.statusText);
    return Promise.reject(`ipstack - ${response.statusText} - ${JSON.stringify(response.data.error)}`);
  } else {
    return Promise.resolve(response.data);
  }
}