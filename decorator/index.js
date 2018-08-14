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
 * This function receives flow log data from Kinesis Firehose and "decorates"
 * or enriches that data with additional information. For each flow log entry,
 * the function attempts to append the Security Group IDs associated with
 * the Elastic Network Interface (ENI) associated with the record as well
 * as the location (e.g. country, region) of the requestor.
 * 
 * This function must be deployed before creating the Kinesis Firehose
 * instance as part of Elasticsearch Service setup.
 * 
 *   VPC --> CloudWatch  --> Lambda#ingestor --> Kinesis --> Elasticsearch
 *           (Flow Logs)                         Firehose
 *                                                  +
 *                                           Lambda#decorator
 * 
 */

const find = require('lodash.find');
const EC2 = require('aws-sdk/clients/ec2');
const jmespath = require('jmespath');
const geocode = require('./geocode');

/**
 * Regular expression to parse VPC Flow Log format.
 */
const parser = /^(\d) (\d+) (eni-\w+) (\d{1,3}.\d{1,3}.\d{1,3}.\d{1,3}) (\d{1,3}.\d{1,3}.\d{1,3}.\d{1,3}) (\d+) (\d+) (\d+) (\d+) (\d+) (\d+) (\d+) (ACCEPT|REJECT) (OK|NODATA|SKIPDATA)/

let ec2 = null;

/**
 * Describes the Network Interfaces associated with this account.
 * 
 * @return `Promise` for async processing
 */
const listNetworkInterfaces = async () => {
  if (!ec2) { ec2 = new EC2({ region: process.env.AWS_REGION }) }
  return ec2.describeNetworkInterfaces().promise();
};

/**
 * Builds a listing of Elastic Network Interfaces (ENI) associated with this account and
 * returns an Object representing that ENI, specifically its unique identifier, associated
 * security groups, and primary private IP address.
 * 
 * Per AWS documentation, we only capture the primary, private IPv4 address of the ENI:
 * 
 * - If your network interface has multiple IPv4 addresses and traffic is sent to a secondary private IPv4
 *   address, the flow log displays the primary private IPv4 address in the destination IP address field.
 * - In the case of both `srcaddr` and `dstaddr` in VPC Flow Logs: the IPv4 address of the network interface
 *   is always its private IPv4 address.
 * 
 * @see http://docs.aws.amazon.com/AmazonVPC/latest/UserGuide/flow-logs.html
 * 
 * Returns structure like:
 *  [
 *    { interfaceId: 'eni-c1a7da8c',
 *      securityGroupIds: [ 'sg-b2b454d4' ],
 *      ipAddress: '10.0.1.24' },
 *    { interfaceId: 'eni-03cbb94e',
 *      securityGroupIds: [ 'sg-a3b252c5' ]
 *      ipAddress: '10.0.2.33'}
 *    ...
 *  ]
 */
const buildEniToSecurityGroupMapping = async () => {
  let interfaces = await listNetworkInterfaces()
    
  let mapping = jmespath.search(interfaces,
    `NetworkInterfaces[].{
      interfaceId: NetworkInterfaceId,
      securityGroupIds: Groups[].GroupId,
      ipAddress: PrivateIpAddresses[?Primary].PrivateIpAddress
    }`);
  
  return Promise.resolve(mapping);
}

/**
 * Extracts records from the VPC Flow Log entries passed to the function from
 * Kinesis Firehose. Records are matched against expected format of Flow Log
 * data and wrapped in an object that indicates whether processing of the
 * record was erroneous for future use.
 * 
 * @param oRecords - records from Kinesis Firehose to be processed
 */
const extractRecords = async (records) => {
  let result = []
  for(let record of records) {
    let flowLogData = Buffer.from(record.data, 'base64').toString('utf8')
    let match = parser.exec(flowLogData)
    if (match) {
      let matched = {
        // default vpc flow log data
        '@timestamp':    new Date(),
        'version':       Number(match[1]),
        'account-id':    Number(match[2]),
        'interface-id':  match[3],
        'srcaddr':       match[4],
        'destaddr':      match[5],
        'srcport':       Number(match[6]),
        'dstport':       Number(match[7]),
        'protocol':      Number(match[8]),
        'packets':       Number(match[9]),
        'bytes':         Number(match[10]),
        'start':         Number(match[11]),
        'end':           Number(match[12]),
        'action':        match[13],
        'log-status':    match[14]
      }

      result.push({
        id: record.recordId,
        data: matched,
        error: false
      })
    } else {
      result.push({
        id: record.recordId,
        data: record.data,
        error: true
      })
    }
  }

  return Promise.resolve(result)
}

/**
 * Tests if the passed IP address meets RFC1918 guidelines, e.g. private ip address.
 * @param {*} ipAddress 
 */
const isRfc1918Address = (ipAddress) => {
  let re = /(^127\.)|(^10\.)|(^172\.1[6-9]\.)|(^172\.2[0-9]\.)|(^172\.3[0-1]\.)|(^192\.168\.)/;

  return (ipAddress.match(re) !== null);
}

/**
 * Decorates passed VPC Flow Log records with additional data, including security
 * group IDs and geolocation of source IP address.
 * 
 * @param records - array of records to be processed
 * @param mapping - mapping of ENIs to additional data
 * @return `Promise` for async processing
 */
const decorateRecords = async (records, mapping) => {
  console.log(`Decorating ${records.length} records`)

  for(let record of records) {
    let eniData = find(mapping, { 'interfaceId': record.data['interface-id'] });
    if (eniData) {
      record.data['security-group-ids'] = eniData.securityGroupIds;
      record.data['direction'] = (record.data['destaddr'] == eniData.ipAddress) ? 'inbound' : 'outbound';
    } else {
      console.log(`No ENI data found for interface ${record.data['interface-id']}`);
    }

    let srcaddr = record.data['srcaddr'];
    let geo = process.env.GEOLOCATION_ENABLED === 'false'
                || isRfc1918Address(srcaddr) ? null : await geocode(srcaddr)

    if (geo) console.log(JSON.stringify(geo))

    // append geo data to existing record
    record.data['source-country-code'] = geo ? geo.country_code : ''
    record.data['source-country-name'] = geo ? geo.country_name : ''
    record.data['source-region-code']  = geo ? geo.region_code : ''
    record.data['source-region-name']  = geo ? geo.region_name : ''
    record.data['source-city']         = geo ? geo.city : ''
    record.data['source-location']     = {
      lat: geo ? Number(geo.latitude) : 0,
      lon: geo ? Number(geo.longitude) : 0
    }
    
    console.log(JSON.stringify(record))
  }

  console.log(`Finished with ${records.length} records`)
  return Promise.resolve(records)
};

/**
 * Called after decoration is complete, packages the records to be passed
 * to Elasticsearch. Record payload is compressed and tagged as appropriate
 * (ok or error) for Kinesis Firehose to complete its work.
 * 
 * @param records - records to be packaged
 */
const packageRecords = async (records) => {
  let result = []
  let success = 0
  let failure = 0

  console.log(`Packaging ${records.length} records`)

  for(let record of records) {
    if (record.error) {
      result.push({
        recordId: record.id,
        result: 'ProcessingFailed',
        data: record.data
      })
      failure++
    } else {
      let payload = Buffer.from(JSON.stringify(record.data), 'utf8').toString('base64')
      result.push({
        recordId: record.id,
        result: 'Ok',
        data: payload
      })
      success++
    }
  }

  console.log(`Processing completed.  Successful records ${success}, Failed records ${failure}.`);
  return Promise.resolve(result)
}


/**
 * 
 * Main Lambda handler -- builds the ENI mapping and then decorates VPC flow log
 * records passed from Firehose.
 * 
 */
exports.handler = (event, context, callback) => {
  console.log(`Received ${event.records.length} records for processing`);

  Promise.all([ buildEniToSecurityGroupMapping(), extractRecords(event.records) ])
    .then( (results) => {
      console.log('Finished building ENI to Security Group Mappig and Extracting Records');
      return decorateRecords(results[1], results[0])
    })
    .then( (records) => {
      return packageRecords(records)
    })
    .then( (records) => {
      console.log(`Finished processing records, pushing ${records.length} records to Elasticsearch...`);
      callback(null, { records: records });
    })
    .catch( (error) => {
      console.error('[ERROR] ' +error);
      callback(error);
    })
};