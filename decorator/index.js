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

const _ = require('lodash');
const AWS = require('aws-sdk');
const jmespath = require('jmespath');
const geocode = require('./geocode');

AWS.config.update({ region: process.env.AWS_REGION });

/**
 * Regular expression to parse VPC Flow Log format.
 */
const parser = /^(\d) (\d+) (eni-\w+) (\d{1,3}.\d{1,3}.\d{1,3}.\d{1,3}) (\d{1,3}.\d{1,3}.\d{1,3}.\d{1,3}) (\d+) (\d+) (\d+) (\d+) (\d+) (\d+) (\d+) (ACCEPT|REJECT) (OK|NODATA|SKIPDATA)/

/**
 * Describes the Network Interfaces associated with this account.
 * 
 * @return `Promise` for async processing
 */
const listNetworkInterfaces = () => {
  const ec2 = new AWS.EC2()
  return ec2.describeNetworkInterfaces().promise()
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
const buildEniToSecurityGroupMapping = () => {
  return listNetworkInterfaces()
    .then( (interfaces) => {
      return new Promise( (resolve, reject) => {
        let mapping = jmespath.search(interfaces,
            `NetworkInterfaces[].{
              interfaceId: NetworkInterfaceId,
              securityGroupIds: Groups[].GroupId,
              ipAddress: PrivateIpAddresses[?Primary].PrivateIpAddress
            }`)
        resolve(mapping)
      });
    })
}

/**
 * Extracts records from the VPC Flow Log entries passed to the function from
 * Kinesis Firehose. Records are matched against expected format of Flow Log
 * data and wrapped in an object that indicates whether processing of the
 * record was erroneous for future use.
 * 
 * @param oRecords - records from Kinesis Firehose to be processed
 */
const extractRecords = (oRecords) => {
  let records = []
  oRecords.forEach( (record) => {
    let flowLogData = Buffer.from(record.data, 'base64').toString('utf8')
    let match = parser.exec(flowLogData)
    if (match) {
      let result = {
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

      records.push({
        id: record.recordId,
        data: result,
        error: false
      })
    } else {
      records.push({
        id: record.recordId,
        data: record.data,
        error: true
      })
    }
  }, this)

  return Promise.resolve(records)
}

/**
 * Decorates passed VPC Flow Log records with additional data, including security
 * group IDs and geolocation of source IP address.
 * 
 * @param records - array of records to be processed
 * @param mapping - mapping of ENIs to additional data
 * @return `Promise` for async processing
 */
const decorateRecords = (records, mapping) => {
  let promises = [];

  console.log(`Decorating ${records.length} records`)

  records.forEach( (record) => {
    let eniData = _.find(mapping, { 'interfaceId': record.data['interface-id'] });
    if (eniData) {
      record.data['security-group-ids'] = eniData.securityGroupIds;
      record.data['direction'] = (record.data['destaddr'] == eniData.ipAddress) ? 'inbound' : 'outbound';
    } else {
      console.log(`No ENI data found for interface ${record.data['interface-id']}`);
    }

    // TODO: add switch for geocode or no
    promises.push(
      geocode(record.data['srcaddr'])
        .then( (geo) => {
          record.data['source-country-code'] = geo ? geo.country_code : ''
          record.data['source-country-name'] = geo ? geo.country_name : ''
          record.data['source-region-code']  = geo ? geo.region_code : ''
          record.data['source-region-name']  = geo ? geo.region_name : ''
          record.data['source-city']         = geo ? geo.city : ''
          record.data['source-location']     = {
            lat: geo ? Number(geo.latitude) : 0,
            lon: geo ? Number(geo.longitude) : 0
          }

          return Promise.resolve(record)
        })
        .catch( () => {
          // If geocoder fails, return record itself
          return Promise.resolve(record)
        })
    )     
  }, this)

  return Promise.all(promises)
    .then( (results) => {
      console.log(`Finished with ${results.length} records`)
      return Promise.resolve(results)
    });
};

/**
 * Called after decoration is complete, packages the records to be passed
 * to Elasticsearch. Record payload is compressed and tagged as appropriate
 * (ok or error) for Kinesis Firehose to complete its work.
 * 
 * @param records - records to be packaged
 */
const packageRecords = (records) => {
  let result = []
  let success = 0
  let failure = 0

  console.log(`packaging ${records.length} records`)

  records.forEach( (record) => {

    console.log(record)

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
  })

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